// server/services/aiService.js
const db = require('../db/database');
const { calculateSplits } = require('./splitEngine');

const GEMINI_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `You are "EquiShare AI Agent", an advanced autonomous agent for EquiShare.
You have complete app control and direct access to the app's SQLite or PostgreSQL database via tools.
You can view groups, active/removed members, expenses, settlements, user lists, and execute transactions.
Since you are an agent, not just a chatbot, you should perform tasks by running tools sequentially, verifying results, and outputting an execution summary.
Always format currency values using the group's dominant currency or INR (₹) / USD ($) as appropriate.
If the user's intent is ambiguous, ask for clarification.`;

// Expose tools to Gemini LLM (note uppercase types in schema)
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'listUsers',
      description: 'Lists all registered users in the application.',
      parameters: { type: 'OBJECT', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getGroupDetails',
      description: 'Fetch detailed info about a group including members, expenses, settlements, and balances.',
      parameters: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'NUMBER', description: 'ID of the group to fetch details for.' }
        },
        required: ['groupId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createExpense',
      description: 'Create a new expense transaction in a group.',
      parameters: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'NUMBER', description: 'ID of the group.' },
          description: { type: 'STRING', description: 'Description of the expense (e.g. Dinner, Rent).' },
          total: { type: 'NUMBER', description: 'Total expense amount.' },
          paidBy: { type: 'NUMBER', description: 'User ID of the payer.' },
          splitType: { type: 'STRING', enum: ['equal', 'exact', 'percentage', 'shares'], description: 'Split type.' },
          splits: {
            type: 'ARRAY',
            description: 'Optional custom split items (required if splitType is not equal).',
            items: {
              type: 'OBJECT',
              properties: {
                userId: { type: 'NUMBER' },
                amount: { type: 'NUMBER', description: 'Exact amount (for exact type).' },
                percentage: { type: 'NUMBER', description: 'Percentage out of 100 (for percentage type).' },
                shares: { type: 'NUMBER', description: 'Weight shares (for shares type).' }
              },
              required: ['userId']
            }
          }
        },
        required: ['groupId', 'description', 'total', 'paidBy']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recordSettlement',
      description: 'Record a settlement transaction between two members of a group.',
      parameters: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'NUMBER', description: 'ID of the group.' },
          fromUser: { type: 'NUMBER', description: 'User ID of the person paying.' },
          toUser: { type: 'NUMBER', description: 'User ID of the person receiving.' },
          amount: { type: 'NUMBER', description: 'Amount settled.' },
          paymentType: { type: 'STRING', description: 'Settlement type, e.g. manual, razorpay, wallet.' }
        },
        required: ['groupId', 'fromUser', 'toUser', 'amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getSuggestions',
      description: 'Analyze group expenses to give spending breakdown and budget/saving recommendations.',
      parameters: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'NUMBER', description: 'ID of the group to analyze.' }
        },
        required: ['groupId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'inspectDatabaseSchema',
      description: 'Retrieves database schema info (tables and column listings) for diagnostics.',
      parameters: { type: 'OBJECT', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'checkIntegrity',
      description: 'Performs check for database integrity anomalies (orphaned splits, mismatched sums, missing group members).',
      parameters: { type: 'OBJECT', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'runDiagnosticQuery',
      description: 'Run a read-only SELECT query against the database to diagnose database issues.',
      parameters: {
        type: 'OBJECT',
        properties: {
          sql: { type: 'STRING', description: 'SELECT query.' }
        },
        required: ['sql']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'executeCorrectiveAction',
      description: 'Execute a data repair query (INSERT/UPDATE/DELETE) to resolve an identified database integrity issue.',
      parameters: {
        type: 'OBJECT',
        properties: {
          sql: { type: 'STRING', description: 'Repair query.' }
        },
        required: ['sql']
      }
    }
  }
];

// Tool executors
const toolExecutors = {
  listUsers: async () => {
    const users = await db.findAll('users');
    return users.map(u => ({ id: u.id, name: u.name, email: u.email }));
  },

  getGroupDetails: async ({ groupId }) => {
    const group = await db.findOne('groups', g => g.id === Number(groupId));
    if (!group) return { error: 'Group not found' };

    const membersRaw = await db.findAll('group_members', m => m.group_id === Number(groupId));
    const memberPromises = membersRaw.map(async (m) => {
      const u = await db.findOne('users', u => u.id === m.user_id);
      return { id: u?.id, name: u?.name, email: u?.email, left: !!m.left_at };
    });
    const members = (await Promise.all(memberPromises)).filter(Boolean);

    const expenses = await db.findAll('expenses', e => e.group_id === Number(groupId) && e.status !== 'deleted');
    const settlements = await db.findAll('settlements', s => s.group_id === Number(groupId));

    return { id: group.id, name: group.name, members, expenses, settlements };
  },

  createExpense: async ({ groupId, description, total, paidBy, splitType = 'equal', splits }) => {
    const gid = Number(groupId);
    const paid = Number(paidBy);
    const tot = parseFloat(total);
    const type = splitType;

    let effectiveMemberIds;
    if (type === 'equal') {
      const members = await db.findAll('group_members', m => m.group_id === gid && !m.left_at);
      effectiveMemberIds = members.map(m => m.user_id);
    }

    const computedSplits = calculateSplits(type, tot, {
      memberIds: effectiveMemberIds?.map(Number),
      payerId: paid,
      splits: splits,
    });

    const expense = await db.insert('expenses', {
      group_id: gid,
      description: description.trim(),
      total: tot,
      paid_by: paid,
      split_type: type,
      status: 'active',
      lamport_ts: 0,
    });

    for (const s of computedSplits) {
      await db.insert('expense_splits', { expense_id: expense.id, user_id: s.userId, amount_owed: s.amountOwed });
    }

    return { success: true, expenseId: expense.id, message: `Expense "${description}" for ${tot} added successfully.` };
  },

  recordSettlement: async ({ groupId, fromUser, toUser, amount, paymentType = 'manual' }) => {
    const s = await db.insert('settlements', {
      group_id: Number(groupId),
      from_user: Number(fromUser),
      to_user: Number(toUser),
      amount: parseFloat(amount),
      payment_type: paymentType,
    });
    return { success: true, settlementId: s.id, message: `Recorded settlement of ${amount} successfully.` };
  },

  getSuggestions: async ({ groupId }) => {
    const expenses = await db.findAll('expenses', e => e.group_id === Number(groupId) && e.status !== 'deleted');
    if (expenses.length === 0) return { message: 'No expenses logged in this group yet.' };

    const total = expenses.reduce((a, b) => a + b.total, 0);
    const categoryTotals = {};
    expenses.forEach(e => {
      const desc = e.description.toLowerCase();
      let cat = 'Other';
      if (desc.includes('rent') || desc.includes('room') || desc.includes('flat')) cat = 'Rent/Room';
      else if (desc.includes('food') || desc.includes('dinner') || desc.includes('lunch') || desc.includes('grocery')) cat = 'Food/Groceries';
      else if (desc.includes('uber') || desc.includes('taxi') || desc.includes('cab') || desc.includes('travel')) cat = 'Travel';
      else if (desc.includes('power') || desc.includes('electricity') || desc.includes('wifi') || desc.includes('internet')) cat = 'Utilities';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + e.total;
    });

    const payerTotals = {};
    for (const e of expenses) {
      const u = await db.findOne('users', u => u.id === e.paid_by);
      const name = u?.name || 'Unknown';
      payerTotals[name] = (payerTotals[name] || 0) + e.total;
    }

    const topSpender = Object.keys(payerTotals).reduce((a, b) => payerTotals[a] > payerTotals[b] ? a : b, 'None');

    return {
      totalSpend: total,
      categoryBreakdown: categoryTotals,
      payerDistribution: payerTotals,
      insights: [
        `Total spending in this group is ${total.toFixed(2)}.`,
        `Top spender is ${topSpender} who paid a total of ${payerTotals[topSpender]?.toFixed(2) || 0}.`,
        categoryTotals['Food/Groceries'] ? `Food and Groceries account for ${categoryTotals['Food/Groceries'].toFixed(2)} (${Math.round(categoryTotals['Food/Groceries']/total * 100)}% of total).` : null,
        `Consider settling outstanding balances regularly to maintain trust.`
      ].filter(Boolean)
    };
  },

  inspectDatabaseSchema: async () => {
    const tables = ['users', 'groups', 'group_members', 'expenses', 'expense_splits', 'settlements', 'shopping_items', 'import_reports', 'group_wallets', 'offline_vouchers', 'user_wallets', 'wallet_transactions'];
    const schemaInfo = {};
    for (const t of tables) {
      try {
        if (db.isPostgres) {
          const info = await db.rawQuery(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
            [t]
          );
          schemaInfo[t] = info.map(c => `${c.column_name} (${c.data_type})`);
        } else {
          const info = await db.rawQuery(`PRAGMA table_info(${t})`);
          schemaInfo[t] = info.map(c => `${c.name} (${c.type})`);
        }
      } catch (err) {
        schemaInfo[t] = `Error: ${err.message}`;
      }
    }
    return schemaInfo;
  },

  checkIntegrity: async () => {
    const issues = [];
    
    // 1. Orphaned splits
    const orphanedSplits = await db.rawQuery(`
      SELECT es.id, es.expense_id FROM expense_splits es
      LEFT JOIN expenses e ON es.expense_id = e.id
      WHERE e.id IS NULL
    `);
    if (orphanedSplits.length > 0) {
      issues.push({
        type: 'ORPHANED_SPLITS',
        description: 'Splits exist for non-existent expenses',
        details: orphanedSplits
      });
    }

    // 2. Mismatched split sum
    const mismatches = await db.rawQuery(`
      SELECT e.id, e.description, e.total, SUM(es.amount_owed) as splits_sum
      FROM expenses e
      JOIN expense_splits es ON e.id = es.expense_id
      WHERE e.status != 'deleted'
      GROUP BY e.id, e.description, e.total
      HAVING ABS(e.total - SUM(es.amount_owed)) > 0.05
    `);
    if (mismatches.length > 0) {
      issues.push({
        type: 'MISMATCHED_SPLITS_SUM',
        description: 'Sum of splits does not equal total expense amount',
        details: mismatches
      });
    }

    // 3. User is not a member of the group but has splits
    const invalidMembers = await db.rawQuery(`
      SELECT es.id, es.expense_id, es.user_id, e.group_id
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      LEFT JOIN group_members gm ON e.group_id = gm.group_id AND es.user_id = gm.user_id
      WHERE gm.user_id IS NULL
    `);
    if (invalidMembers.length > 0) {
      issues.push({
        type: 'INVALID_MEMBER_SPLITS',
        description: 'Users have splits in groups where they are not members',
        details: invalidMembers
      });
    }

    // 4. Negative balances in user wallets
    const negativeUserWallets = await db.rawQuery(`
      SELECT id, user_id, balance FROM user_wallets WHERE balance < 0
    `);
    if (negativeUserWallets.length > 0) {
      issues.push({
        type: 'NEGATIVE_USER_WALLET',
        description: 'Users have negative wallet balance',
        details: negativeUserWallets
      });
    }

    return { healthy: issues.length === 0, issues };
  },

  runDiagnosticQuery: async ({ sql }) => {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return { error: 'Only SELECT queries are allowed for diagnosis. Use executeCorrectiveAction to modify data.' };
    }
    try {
      const results = await db.rawQuery(sql);
      return { success: true, count: results.length, data: results.slice(0, 50) };
    } catch (err) {
      return { error: err.message };
    }
  },

  executeCorrectiveAction: async ({ sql }) => {
    try {
      const result = await db.rawRun(sql);
      return { success: true, changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    } catch (err) {
      return { error: err.message };
    }
  }
};

// Map OpenAI style messages array to Gemini contents structure
function mapMessagesToGemini(messages) {
  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      continue;
    }
    
    const parts = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: call.function.name,
            args: typeof call.function.arguments === 'string'
              ? JSON.parse(call.function.arguments)
              : call.function.arguments
          }
        });
      }
    }

    if (msg.role === 'tool') {
      let responseObj = {};
      try {
        responseObj = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      } catch {
        responseObj = { result: msg.content };
      }
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name,
              response: responseObj
            }
          }
        ]
      });
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts });
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }
  return contents;
}

async function chatWithAI(messages, currentUserId, activeGroupId, onStep = null, customSystemPrompt = null) {
  if (!GEMINI_KEY) {
    throw new Error("GEMINI_API_KEY is not defined in the environment. Please add GEMINI_API_KEY to your .env file.");
  }

  const systemText = customSystemPrompt || `${SYSTEM_PROMPT}\n[CONTEXT]\nActive User ID: ${currentUserId}\nActive Group ID: ${activeGroupId || 'None'}`;
  
  let contents = mapMessagesToGemini(messages);

  for (let loop = 0; loop < 5; loop++) {
    const payload = {
      contents: contents,
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      tools: [
        {
          functionDeclarations: TOOLS.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
          }))
        }
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO'
        }
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    
    if (onStep) {
      onStep({ type: 'api_request', loop });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${errText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error("No response candidates returned from Gemini API.");
    }

    const modelContent = candidate.content;
    if (!modelContent || !modelContent.parts) {
      throw new Error("Empty model response parts received.");
    }

    contents.push(modelContent);

    const functionCalls = modelContent.parts.filter(p => p.functionCall);
    const textPart = modelContent.parts.find(p => p.text);

    if (functionCalls.length > 0) {
      const functionResponses = [];
      for (const call of functionCalls) {
        const { name, args } = call.functionCall;
        
        if (onStep) {
          onStep({ type: 'tool_call', name, args });
        }

        let result;
        if (toolExecutors[name]) {
          try {
            result = await toolExecutors[name](args);
          } catch (err) {
            result = { error: err.message };
          }
        } else {
          result = { error: `Tool ${name} not implemented.` };
        }

        if (onStep) {
          onStep({ type: 'tool_response', name, result });
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: result
          }
        });
      }

      contents.push({
        role: 'function',
        parts: functionResponses
      });
    } else {
      return textPart ? textPart.text : "Task executed successfully.";
    }
  }

  const lastPart = contents[contents.length - 1]?.parts?.find(p => p.text);
  return lastPart ? lastPart.text : "Execution complete.";
}

async function runAgentCommand(messages, currentUserId, activeGroupId) {
  const trace = [];
  const onStep = (step) => {
    trace.push(step);
  };
  const reply = await chatWithAI(messages, currentUserId, activeGroupId, onStep);
  return { reply, trace };
}

async function diagnoseAndHealError(errorDetails, currentUserId, activeGroupId) {
  const trace = [];
  const onStep = (step) => {
    trace.push(step);
  };

  const diagnosticPrompt = `You are the "Splitwise Pro Self-Healing Agent".
Your task is to analyze a runtime application error, check database schema and integrity using your tools, diagnose the root cause, and either auto-correct the DB state (using executeCorrectiveAction) or provide a precise explanation and a frontend/backend repair plan.
If you find a database integrity issue (e.g. mismatched splits, orphaned splits, negative balances), execute a SQL fix to repair it immediately using executeCorrectiveAction.
Otherwise, explain the error, diagnose what went wrong, and recommend a specific repair block.
Be concise and report exactly what you diagnosed and what healing actions were performed.`;

  const messages = [
    {
      role: 'user',
      content: `An application error was caught!
Error Message: ${errorDetails.message}
Stack Trace: ${errorDetails.stack || 'N/A'}
Component Name: ${errorDetails.component || 'N/A'}
Current Page/Route: ${errorDetails.route || 'N/A'}
Please diagnose and resolve if possible.`
    }
  ];

  const reply = await chatWithAI(messages, currentUserId, activeGroupId, onStep, diagnosticPrompt);
  return { reply, trace };
}

module.exports = {
  chatWithAI,
  runAgentCommand,
  diagnoseAndHealError,
  TOOLS,
  toolExecutors
};

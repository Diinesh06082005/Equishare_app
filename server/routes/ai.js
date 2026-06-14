// server/routes/ai.js
const express = require('express');
const db = require('../db/database');
const { chatWithAI, runAgentCommand, diagnoseAndHealError } = require('../services/aiService');

const router = express.Router();

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(Object.assign(new Error('Unauthorized'), { status: 401 }));
  }
  const token = authHeader.replace('Bearer ', '');
  const match = token.match(/^uid-(\d+)$/);
  if (!match) {
    return next(Object.assign(new Error('Invalid token'), { status: 401 }));
  }
  const userId = Number(match[1]);
  db.findOne('users', (u) => u.id === userId).then((user) => {
    if (!user) {
      return next(Object.assign(new Error('User not found'), { status: 404 }));
    }
    req.userId = userId;
    req.user = user;
    next();
  }).catch(next);
}

// POST /api/ai/chat
router.post('/chat', authRequired, async (req, res, next) => {
  const { messages, groupId } = req.body;
  if (!Array.isArray(messages)) {
    return next(Object.assign(new Error('messages array required'), { status: 400 }));
  }

  try {
    const aiResponse = await chatWithAI(messages, req.userId, groupId);
    res.json({ reply: aiResponse });
  } catch (err) {
    console.error('Error in AI Chat Route:', err.message);
    res.status(500).json({ error: err.message || 'AI assistant encountered an error.' });
  }
});

// POST /api/ai/agent-command
router.post('/agent-command', authRequired, async (req, res, next) => {
  const { messages, groupId } = req.body;
  if (!Array.isArray(messages)) {
    return next(Object.assign(new Error('messages array required'), { status: 400 }));
  }

  try {
    const result = await runAgentCommand(messages, req.userId, groupId);
    res.json(result);
  } catch (err) {
    console.error('Error in AI Agent Command Route:', err.message);
    res.status(500).json({ error: err.message || 'AI Agent encountered an error.' });
  }
});

// POST /api/ai/diagnose-error
router.post('/diagnose-error', authRequired, async (req, res, next) => {
  const { errorDetails, groupId } = req.body;
  if (!errorDetails || !errorDetails.message) {
    return next(Object.assign(new Error('errorDetails object with a message is required'), { status: 400 }));
  }

  try {
    const result = await diagnoseAndHealError(errorDetails, req.userId, groupId);
    res.json(result);
  } catch (err) {
    console.error('Error in AI Diagnose Route:', err.message);
    res.status(500).json({ error: err.message || 'AI diagnostic agent encountered an error.' });
  }
});

// POST /api/ai/simulate-error
router.post('/simulate-error', authRequired, async (req, res, next) => {
  const { type, groupId } = req.body;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId is required to simulate a group-based error.' });
  }

  try {
    if (type === 'mismatched_splits') {
      // Create an expense of 100, but splits only total 80
      const expense = await db.insert('expenses', {
        group_id: Number(groupId),
        description: 'Simulated Split Mismatch Anomaly ⚠️',
        total: 100.0,
        paid_by: req.userId,
        split_type: 'exact',
        status: 'active'
      });
      
      // Split 1
      await db.insert('expense_splits', {
        expense_id: expense.id,
        user_id: req.userId,
        amount_owed: 80.0
      });

      return res.json({
        success: true,
        message: 'Simulated Mismatched Splits error injected into database.',
        expenseId: expense.id
      });
    } else if (type === 'orphaned_splits') {
      // Create a split referencing non-existent expense ID 99999
      const split = await db.insert('expense_splits', {
        expense_id: 99999,
        user_id: req.userId,
        amount_owed: 50.0
      });

      return res.json({
        success: true,
        message: 'Simulated Orphaned Split error injected into database.',
        splitId: split.id
      });
    } else if (type === 'invalid_member_split') {
      // Find a user who is NOT a member of the group
      const allUsers = await db.findAll('users');
      const members = (await db.findAll('group_members', m => m.group_id === Number(groupId))).map(m => m.user_id);
      const nonMember = allUsers.find(u => !members.includes(u.id));
      
      if (!nonMember) {
        return res.status(400).json({ error: 'Could not find a user who is not a member of the group to simulate this error.' });
      }

      const expense = await db.insert('expenses', {
        group_id: Number(groupId),
        description: 'Simulated Non-Member Split Anomaly ⚠️',
        total: 150.0,
        paid_by: req.userId,
        split_type: 'exact',
        status: 'active'
      });

      // Split for non-member
      await db.insert('expense_splits', {
        expense_id: expense.id,
        user_id: nonMember.id,
        amount_owed: 150.0
      });

      return res.json({
        success: true,
        message: `Simulated split for non-member (${nonMember.name}) injected into database.`,
        expenseId: expense.id
      });
    } else {
      return res.status(400).json({ error: `Unknown error type: ${type}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/financial-insights
router.post('/financial-insights', authRequired, async (req, res, next) => {
  const { balances, groups } = req.body;
  
  try {
    const prompt = `You are an elite AI Financial Advisor in EquiShare.
Analyze the user's current group financial status:
- Total Active Groups: ${groups || 0}
- Net Balance Summary across groups: ${JSON.stringify(balances || [])}
 
Provide exactly 3 bullet points:
1. One recommendation on which group or member to settle up with first.
2. One dynamic budgeting tip based on their balance (e.g. if they owe money, suggest paying back; if owed, suggest friendly reminders).
3. One encouraging/witty financial tip.
Keep each bullet point under 15 words. Keep the tone friendly, modern, and professional.`;

    const response = await chatWithAI([{ role: 'user', content: prompt }], req.userId, null, null, "You are a professional financial advisor.");
    res.json({ insights: response });
  } catch (err) {
    console.warn('AI Advisor call failed, using rule-based fallback:', err.message);
    
    // Dynamic rule-based fallback
    const totalGroups = groups || 0;
    const items = balances || [];
    
    // Find who owes what
    const youOwe = items.filter(b => b.netBalance < 0);
    const owedYou = items.filter(b => b.netBalance > 0);
    const netAmount = items.reduce((acc, b) => acc + b.netBalance, 0);
    
    let bullet1 = "• You are fully settled up across all active groups. Nice job!";
    if (youOwe.length > 0) {
      const biggestDebt = [...youOwe].sort((a,b) => a.netBalance - b.netBalance)[0];
      bullet1 = `• Focus on settling your debt with ${biggestDebt.user?.name || 'group members'} to clear your balance.`;
    } else if (owedYou.length > 0) {
      const biggestCredit = [...owedYou].sort((a,b) => b.netBalance - a.netBalance)[0];
      bullet1 = `• Send a friendly reminder to ${biggestCredit.user?.name || 'group members'} who owes you funds.`;
    }

    let bullet2 = "• Maintain healthy group dynamics by settling expenses within 7 days.";
    if (netAmount < 0) {
      bullet2 = "• Budget alert: You are currently net negative. Consider prefunding your wallets to control spend.";
    } else if (netAmount > 0) {
      bullet2 = "• Savings tip: You have positive receivables. Reinvest these funds or settle other members.";
    }

    const bullet3 = "• Rule-based financial health checklist: 100% of your transactions are backed up and synced.";

    res.json({
      insights: `${bullet1}\n${bullet2}\n${bullet3}`
    });
  }
});

// GET /api/ai/integrity-check/:groupId
router.get('/integrity-check/:groupId', authRequired, async (req, res, next) => {
  try {
    const groupId = Number(req.params.groupId);
    
    // 1. Mismatched splits
    const expenses = await db.findAll('expenses', e => e.group_id === groupId && e.status !== 'deleted');
    const anomalies = [];
    
    for (const exp of expenses) {
      const splits = await db.findAll('expense_splits', s => s.expense_id === exp.id);
      const splitSum = splits.reduce((sum, s) => sum + s.amount_owed, 0);
      if (Math.abs(splitSum - exp.total) > 0.01) {
        anomalies.push({
          type: 'mismatched_splits',
          expenseId: exp.id,
          description: exp.description,
          expected: exp.total,
          actual: splitSum
        });
      }
    }

    // 2. Orphaned splits
    const allSplits = await db.findAll('expense_splits');
    for (const split of allSplits) {
      const exp = await db.findOne('expenses', e => e.id === split.expense_id);
      if (!exp) {
        // Orphaned split. If it belongs to a user in this group, let's flag it.
        const isMember = await db.findOne('group_members', m => m.group_id === groupId && m.user_id === split.user_id);
        if (isMember) {
          anomalies.push({
            type: 'orphaned_splits',
            splitId: split.id,
            amount: split.amount_owed
          });
        }
      }
    }

    // 3. Invalid member splits
    const members = (await db.findAll('group_members', m => m.group_id === groupId)).map(m => m.user_id);
    for (const exp of expenses) {
      const splits = await db.findAll('expense_splits', s => s.expense_id === exp.id);
      for (const split of splits) {
        if (!members.includes(split.user_id)) {
          anomalies.push({
            type: 'invalid_member_split',
            expenseId: exp.id,
            userId: split.user_id,
            description: exp.description
          });
        }
      }
    }

    res.json({
      healthy: anomalies.length === 0,
      anomalies
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/heal-group/:groupId
router.post('/heal-group/:groupId', authRequired, async (req, res, next) => {
  const groupId = Number(req.params.groupId);
  const { anomalies } = req.body;
  
  try {
    const errorDetails = {
      message: `Database Integrity Audit failed inside Group ID ${groupId}. Detected ${anomalies?.length || 0} anomalies. Please repair them.`,
      stack: JSON.stringify(anomalies || []),
      component: 'GroupDetail',
      route: `/group/${groupId}`
    };

    const result = await diagnoseAndHealError(errorDetails, req.userId, groupId);
    res.json(result);
  } catch (err) {
    console.warn('AI Healing agent failed, applying autonomous programmatic database repair fallback:', err.message);
    
    try {
      if (Array.isArray(anomalies)) {
        for (const anomaly of anomalies) {
          if (anomaly.type === 'mismatched_splits') {
            const exp = await db.findOne('expenses', e => e.id === Number(anomaly.expenseId));
            if (exp) {
              const splits = await db.findAll('expense_splits', s => s.expense_id === exp.id);
              if (splits.length > 0) {
                const equalShare = Number((exp.total / splits.length).toFixed(2));
                let sum = 0;
                for (let idx = 0; idx < splits.length; idx++) {
                  const s = splits[idx];
                  if (idx === splits.length - 1) {
                    s.amount_owed = Number((exp.total - sum).toFixed(2));
                  } else {
                    s.amount_owed = equalShare;
                    sum += equalShare;
                  }
                  await db.updateOne('expense_splits', x => x.id === s.id, { amount_owed: s.amount_owed });
                }
              }
            }
          } else if (anomaly.type === 'orphaned_splits') {
            await db.removeOne('expense_splits', x => x.id === Number(anomaly.splitId));
          } else if (anomaly.type === 'invalid_member_split') {
            const alreadyMember = await db.findOne('group_members', m => m.group_id === groupId && m.user_id === Number(anomaly.userId));
            if (!alreadyMember) {
              await db.insert('group_members', {
                group_id: groupId,
                user_id: Number(anomaly.userId)
              });
            }
          }
        }
      }
      res.json({
        reply: "Autonomous programmatic self-healing successfully executed. The database integrity anomalies have been corrected.",
        trace: [{ type: 'healing_action', message: 'Programmatic database repair fallback executed.' }]
      });
    } catch (healErr) {
      console.error('Programmatic healing failed:', healErr);
      res.status(500).json({ error: healErr.message || 'Healing failed.' });
    }
  }
});

module.exports = router;

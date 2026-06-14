// server/routes/groups.js
const express = require('express');
const db = require('../db/database');
const { simplifyDebts, aggregateBalances } = require('../services/debtSimplifier');

const router = express.Router();

async function getGroupMembers(groupId) {
  const memberRecs = await db.findAll('group_members', (m) => m.group_id === groupId);
  const memberPromises = memberRecs.map(async (m) => {
    const u = await db.findOne('users', (u) => u.id === m.user_id);
    if (!u) return null;
    return {
      ...u,
      joined_at: m.joined_at,
      left_at: m.left_at,
    };
  });
  return (await Promise.all(memberPromises)).filter(Boolean);
}

async function getGroupExpenses(groupId) {
  const expenses = await db.findAll('expenses', (e) => e.group_id === groupId && e.status !== 'deleted');
  const expensePromises = expenses.map(async (exp) => {
    const splits = await db.findAll('expense_splits', (s) => s.expense_id === exp.id);
    const paidByUser = await db.findOne('users', (u) => u.id === exp.paid_by);
    return { ...exp, paid_by_name: paidByUser?.name, splits };
  });
  return Promise.all(expensePromises);
}

const EXCHANGE_RATE = 83; // 1 USD = 83 INR
function convertCurrency(amount, from, to) {
  if (!from || !to || from === to) return amount;
  if (from === 'USD' && to === 'INR') return amount * EXCHANGE_RATE;
  if (from === 'INR' && to === 'USD') return amount / EXCHANGE_RATE;
  return amount;
}

async function computeBalances(groupId) {
  const activeMembers = await getGroupMembers(groupId);
  const expenses = await getGroupExpenses(groupId);
  const settlements = await db.findAll('settlements', (s) => s.group_id === groupId);

  // Determine dominant currency of the group (default to INR if there is any INR expense, or USD if all are USD)
  let baseCurrency = 'INR';
  const usdCount = expenses.filter(e => e.currency === 'USD').length;
  const inrCount = expenses.filter(e => e.currency === 'INR').length;
  if (usdCount > inrCount) {
    baseCurrency = 'USD';
  }

  const expData = expenses.map((e) => {
    const fromCurr = e.currency || 'USD';
    const totalConverted = convertCurrency(e.total, fromCurr, baseCurrency);
    return {
      paidBy: e.paid_by,
      total: totalConverted,
      splits: e.splits.map((s) => ({
        userId: s.user_id,
        amountOwed: convertCurrency(s.amount_owed, fromCurr, baseCurrency)
      })),
    };
  });

  const aggMap = aggregateBalances(expData);

  for (const s of settlements) {
    const from = aggMap.get(s.from_user) || { totalPaid: 0, totalOwed: 0 };
    const to   = aggMap.get(s.to_user)   || { totalPaid: 0, totalOwed: 0 };
    let settleAmount = s.amount;
    // If settlement was made in INR (e.g. Razorpay/Wallet), convert if baseCurrency is USD
    if (s.payment_type === 'razorpay' || s.payment_type === 'wallet') {
      settleAmount = convertCurrency(s.amount, 'INR', baseCurrency);
    }
    from.totalPaid = (from.totalPaid || 0) + settleAmount;
    to.totalOwed   = (to.totalOwed   || 0) + settleAmount;
    aggMap.set(s.from_user, from);
    aggMap.set(s.to_user, to);
  }

  // Find all unique user IDs that appear in aggMap with non-zero activity, plus active members
  const involvedUserIds = new Set(activeMembers.map(m => m.id));
  for (const [uid, agg] of aggMap.entries()) {
    if (Math.abs(agg.totalPaid - agg.totalOwed) > 0.001) {
      involvedUserIds.add(uid);
    }
  }

  const memberPromises = Array.from(involvedUserIds).map(uid => {
    return db.findOne('users', u => u.id === uid);
  });
  const members = (await Promise.all(memberPromises)).filter(Boolean);

  return { members, aggMap, baseCurrency };
}

// GET /api/groups
router.get('/', async (req, res, next) => {
  try {
    const groups = await db.findAll('groups');
    groups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const resultPromises = groups.map(async (g) => {
      const members = await db.findAll('group_members', (m) => m.group_id === g.id && !m.left_at);
      return {
        ...g,
        member_count: members.length,
      };
    });
    const result = await Promise.all(resultPromises);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id
router.get('/:id', async (req, res, next) => {
  try {
    const group = await db.findOne('groups', (g) => g.id === Number(req.params.id));
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));
    const members = await getGroupMembers(group.id);
    res.json({ ...group, members });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups
router.post('/', async (req, res, next) => {
  try {
    const { name, createdBy, memberIds = [] } = req.body;
    if (!name) return next(Object.assign(new Error('name is required'), { status: 400 }));

    const group = await db.insert('groups', { name: name.trim(), created_by: createdBy || null });
    const gid = group.id;

    const allIds = new Set([...(createdBy ? [Number(createdBy)] : []), ...memberIds.map(Number)]);
    for (const uid of allIds) {
      await db.rawRun(
        'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
        [gid, uid]
      );
    }

    res.status(201).json({ ...group, member_count: allIds.size });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:id/members
router.post('/:id/members', async (req, res, next) => {
  try {
    const gid = Number(req.params.id);
    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    const { userIds = [] } = req.body;
    if (!userIds.length) return next(Object.assign(new Error('userIds required'), { status: 400 }));

    for (const uid of userIds.map(Number)) {
      const existing = await db.rawQuery(
        'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
        [gid, uid]
      );
      if (existing.length > 0) {
        // Re-add: clear the left_at timestamp
        await db.rawRun(
          `UPDATE group_members SET left_at = NULL WHERE group_id = ? AND user_id = ?`,
          [gid, uid]
        );
      } else {
        await db.rawRun(
          'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
          [gid, uid]
        );
      }
    }
    res.json({ message: 'Members added', count: userIds.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id/members/:userId — remove a member (soft: set left_at)
router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const gid = Number(req.params.id);
    const uid = Number(req.params.userId);

    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    const membership = await db.rawQuery(
      'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
      [gid, uid]
    );
    if (!membership.length)
      return next(Object.assign(new Error('Member not in group'), { status: 404 }));

    // Soft delete — keep history intact, just record when they left
    await db.rawRun(
      `UPDATE group_members SET left_at = datetime('now') WHERE group_id = ? AND user_id = ?`,
      [gid, uid]
    );

    res.json({ message: 'Member removed', group_id: gid, user_id: uid });
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id/balances
router.get('/:id/balances', async (req, res, next) => {
  try {
    const gid = Number(req.params.id);
    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    const { members, aggMap, baseCurrency } = await computeBalances(gid);

    const result = members.map((m) => {
      const agg = aggMap.get(m.id) || { totalPaid: 0, totalOwed: 0 };
      const net = Math.round((agg.totalPaid - agg.totalOwed) * 100) / 100;
      return {
        user: m,
        totalPaid: Math.round((agg.totalPaid || 0) * 100) / 100,
        totalOwed: Math.round((agg.totalOwed || 0) * 100) / 100,
        netBalance: net,
        currency: baseCurrency
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id/settlements — simplified debt list
router.get('/:id/settlements', async (req, res, next) => {
  try {
    const gid = Number(req.params.id);
    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    const { members, aggMap, baseCurrency } = await computeBalances(gid);

    const memberBalances = members.map((m) => {
      const agg = aggMap.get(m.id) || { totalPaid: 0, totalOwed: 0 };
      return { userId: m.id, totalPaid: agg.totalPaid || 0, totalOwed: agg.totalOwed || 0 };
    });

    const transactions = simplifyDebts(memberBalances);
    const userMap = Object.fromEntries(members.map((m) => [m.id, m]));

    res.json(transactions.map((t) => ({
      from: userMap[t.from],
      to: userMap[t.to],
      amount: t.amount,
      currency: baseCurrency
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

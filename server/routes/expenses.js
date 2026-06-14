// server/routes/expenses.js
const express = require('express');
const db = require('../db/database');
const { calculateSplits } = require('../services/splitEngine');

const router = express.Router();

// GET /api/expenses?groupId=X
router.get('/', async (req, res, next) => {
  try {
    const { groupId } = req.query;
    if (!groupId) return next(Object.assign(new Error('groupId required'), { status: 400 }));

    const expenses = await db.findAll('expenses', (e) => e.group_id === Number(groupId) && e.status !== 'deleted');
    expenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const resultPromises = expenses.map(async (exp) => {
      const splits = await db.findAll('expense_splits', (s) => s.expense_id === exp.id);
      const enrichedSplitsPromises = splits.map(async (s) => {
        const u = await db.findOne('users', (usr) => usr.id === s.user_id);
        return {
          ...s,
          user_name: u?.name,
        };
      });
      const enrichedSplits = await Promise.all(enrichedSplitsPromises);
      const paidByUser = await db.findOne('users', (u) => u.id === exp.paid_by);
      return { ...exp, paid_by_name: paidByUser?.name, splits: enrichedSplits };
    });

    const result = await Promise.all(resultPromises);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/:id
router.get('/:id', async (req, res, next) => {
  try {
    const expense = await db.findOne('expenses', (e) => e.id === Number(req.params.id));
    if (!expense) return next(Object.assign(new Error('Expense not found'), { status: 404 }));
    const splits = await db.findAll('expense_splits', (s) => s.expense_id === expense.id);
    const enrichedSplitsPromises = splits.map(async (s) => {
      const u = await db.findOne('users', (usr) => usr.id === s.user_id);
      return {
        ...s,
        user_name: u?.name,
      };
    });
    const enrichedSplits = await Promise.all(enrichedSplitsPromises);
    const paidByUser = await db.findOne('users', (u) => u.id === expense.paid_by);
    res.json({ ...expense, paid_by_name: paidByUser?.name, splits: enrichedSplits });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses
router.post('/', async (req, res, next) => {
  try {
    const { groupId, description, total, paidBy, splitType = 'equal', splits, memberIds, isOffline } = req.body;
    if (!groupId || !description || total === undefined || !paidBy)
      return next(Object.assign(new Error('groupId, description, total, paidBy required'), { status: 400 }));

    const group = await db.findOne('groups', (g) => g.id === Number(groupId));
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    // Default memberIds = group members active on expense date for equal split
    let effectiveMemberIds = memberIds;
    if (splitType === 'equal' && !effectiveMemberIds) {
      const expenseDate = req.body.createdAt || req.body.date || new Date().toISOString();
      const allMembers = await db.findAll('group_members', (m) => m.group_id === Number(groupId));
      
      effectiveMemberIds = allMembers
        .filter(m => {
          const expDate = new Date(expenseDate);
          if (isNaN(expDate.getTime())) return true;
          const joinDate = m.joined_at ? new Date(m.joined_at) : new Date(0);
          const leaveDate = m.left_at ? new Date(m.left_at) : null;
          return expDate >= joinDate && (!leaveDate || expDate <= leaveDate);
        })
        .map((m) => m.user_id);
    }

    let computedSplits;
    try {
      computedSplits = calculateSplits(splitType, parseFloat(total), {
        memberIds: effectiveMemberIds?.map(Number),
        payerId: Number(paidBy),
        splits,
      });
    } catch (err) {
      return next(Object.assign(err, { status: 400 }));
    }

    const expense = await db.insert('expenses', {
      group_id: Number(groupId),
      description: description.trim(),
      total: parseFloat(total),
      paid_by: Number(paidBy),
      split_type: splitType,
      status: isOffline ? 'pending_sync' : 'active',
      lamport_ts: 0,
    });

    for (const s of computedSplits) {
      await db.insert('expense_splits', { expense_id: expense.id, user_id: s.userId, amount_owed: s.amountOwed });
    }

    const splits2 = await db.findAll('expense_splits', (s) => s.expense_id === expense.id);
    const enrichedSplits2Promises = splits2.map(async (s) => {
      const u = await db.findOne('users', (usr) => usr.id === s.user_id);
      return {
        ...s,
        user_name: u?.name,
      };
    });
    const enrichedSplits2 = await Promise.all(enrichedSplits2Promises);
    const paidByUser = await db.findOne('users', (u) => u.id === expense.paid_by);
    res.status(201).json({ ...expense, paid_by_name: paidByUser?.name, splits: enrichedSplits2 });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const expense = await db.findOne('expenses', (e) => e.id === Number(req.params.id));
    if (!expense) return next(Object.assign(new Error('Expense not found'), { status: 404 }));
    await db.updateOne('expenses', (e) => e.id === Number(req.params.id), { status: 'deleted' });
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/settlements — record a settlement
router.post('/settlements', async (req, res, next) => {
  try {
    const { groupId, fromUser, toUser, amount, paymentType = 'manual' } = req.body;
    if (!groupId || !fromUser || !toUser || !amount)
      return next(Object.assign(new Error('groupId, fromUser, toUser, amount required'), { status: 400 }));

    const s = await db.insert('settlements', {
      group_id: Number(groupId),
      from_user: Number(fromUser),
      to_user: Number(toUser),
      amount: parseFloat(amount),
      payment_type: paymentType,
    });
    res.status(201).json(s);
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/settlements/history?groupId=X
router.get('/settlements/history', async (req, res, next) => {
  try {
    const { groupId } = req.query;
    if (!groupId) return next(Object.assign(new Error('groupId required'), { status: 400 }));
    const rows = await db.findAll('settlements', (s) => s.group_id === Number(groupId));
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const enrichedRowsPromises = rows.map(async (s) => {
      const fromUser = await db.findOne('users', (u) => u.id === s.from_user);
      const toUser = await db.findOne('users', (u) => u.id === s.to_user);
      return {
        ...s,
        from_name: fromUser?.name,
        to_name: toUser?.name,
      };
    });
    const enrichedRows = await Promise.all(enrichedRowsPromises);
    res.json(enrichedRows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

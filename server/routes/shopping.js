// server/routes/shopping.js
const express = require('express');
const db = require('../db/database');

const router = express.Router();

// GET /api/shopping/:groupId
router.get('/:groupId', async (req, res, next) => {
  try {
    const items = await db.findAll('shopping_items', (s) => s.group_id === Number(req.params.groupId));
    items.sort((a, b) => a.id - b.id);
    const resultPromises = items.map(async (s) => {
      const u = await db.findOne('users', (usr) => usr.id === s.added_by);
      return {
        ...s,
        added_by_name: u?.name
      };
    });
    const result = await Promise.all(resultPromises);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/shopping
router.post('/', async (req, res, next) => {
  try {
    const { groupId, addedBy, name } = req.body;
    if (!groupId || !name) return next(Object.assign(new Error('groupId, name required'), { status: 400 }));
    const item = await db.insert('shopping_items', {
      group_id: Number(groupId),
      added_by: addedBy ? Number(addedBy) : null,
      name: name.trim(),
      checked: 0,
      expense_id: null,
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/shopping/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const item = await db.findOne('shopping_items', (s) => s.id === Number(req.params.id));
    if (!item) return next(Object.assign(new Error('Item not found'), { status: 404 }));
    const { checked, expenseId } = req.body;
    const updated = await db.updateOne('shopping_items', (s) => s.id === Number(req.params.id), {
      checked: checked !== undefined ? (checked ? 1 : 0) : item.checked,
      expense_id: expenseId !== undefined ? expenseId : item.expense_id,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shopping/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const item = await db.findOne('shopping_items', (s) => s.id === Number(req.params.id));
    if (!item) return next(Object.assign(new Error('Item not found'), { status: 404 }));
    await db.removeOne('shopping_items', (s) => s.id === Number(req.params.id));
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

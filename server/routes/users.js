// server/routes/users.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    const users = await db.findAll('users');
    users.sort((a, b) => a.name.localeCompare(b.name));
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = await db.findOne('users', (u) => u.id === Number(req.params.id));
    if (!user) return next(Object.assign(new Error('User not found'), { status: 404 }));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// POST /api/users
router.post('/', async (req, res, next) => {
  try {
    const { name, email, isGuest, upiVpa, venmoHandle } = req.body;
    if (!name || !name.trim()) return next(Object.assign(new Error('name is required'), { status: 400 }));

    // Unique email check
    if (email) {
      const existing = await db.findOne('users', (u) => u.email === email);
      if (existing) {
        return next(Object.assign(new Error('Email already registered'), { status: 409 }));
      }
    }

    const inviteToken = isGuest ? uuidv4() : null;
    const user = await db.insert('users', {
      name: name.trim(),
      email: email || null,
      is_guest: isGuest ? 1 : 0,
      invite_token: inviteToken,
      upi_vpa: upiVpa || null,
      venmo_handle: venmoHandle || null,
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const user = await db.findOne('users', (u) => u.id === Number(req.params.id));
    if (!user) return next(Object.assign(new Error('User not found'), { status: 404 }));
    const { name, upiVpa, venmoHandle } = req.body;
    const updated = await db.updateOne('users', (u) => u.id === Number(req.params.id), {
      name: name || user.name,
      upi_vpa: upiVpa !== undefined ? upiVpa : user.upi_vpa,
      venmo_handle: venmoHandle !== undefined ? venmoHandle : user.venmo_handle,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/guest/:token
router.get('/guest/:token', async (req, res, next) => {
  try {
    const user = await db.findOne('users', (u) => u.invite_token === req.params.token);
    if (!user) return next(Object.assign(new Error('Invalid invite token'), { status: 404 }));
    const memberGroupIds = (await db.findAll('group_members', (m) => m.user_id === user.id)).map((m) => m.group_id);
    const groups = await db.findAll('groups', (g) => memberGroupIds.includes(g.id));
    res.json({ user, groups });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// server/routes/auth.js — Simple email+name auth (no bcrypt, plaintext for demo)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name || !email)
      return next(Object.assign(new Error('name and email are required'), { status: 400 }));

    const existing = await db.findOne('users', (u) => u.email === email);
    if (existing) {
      return next(Object.assign(new Error('Email already registered'), { status: 409 }));
    }

    const user = await db.insert('users', {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      is_guest: 0,
      invite_token: uuidv4(),
      upi_vpa: null,
      venmo_handle: null,
    });

    res.status(201).json({ user, token: `uid-${user.id}` });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email)
      return next(Object.assign(new Error('email is required'), { status: 400 }));

    const user = await db.findOne('users', (u) => u.email === email.toLowerCase().trim());
    if (!user)
      return next(Object.assign(new Error('No account found with that email'), { status: 404 }));

    res.json({ user, token: `uid-${user.id}` });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — validate token
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return next(Object.assign(new Error('Unauthorized'), { status: 401 }));

    const token = authHeader.replace('Bearer ', '');
    const match = token.match(/^uid-(\d+)$/);
    if (!match)
      return next(Object.assign(new Error('Invalid token'), { status: 401 }));

    const user = await db.findOne('users', (u) => u.id === Number(match[1]));
    if (!user)
      return next(Object.assign(new Error('User not found'), { status: 404 }));

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

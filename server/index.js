// server/index.js — Express entry point
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db/database'); // auto-initialises SQLite DB on first import
const errorHandler = require('./middleware/errorHandler');

const authRouter    = require('./routes/auth');
const usersRouter   = require('./routes/users');
const groupsRouter  = require('./routes/groups');
const expensesRouter = require('./routes/expenses');
const shoppingRouter = require('./routes/shopping');
const syncRouter    = require('./routes/sync');
const importRouter  = require('./routes/import');
const walletRouter  = require('./routes/wallet');
const aiRouter      = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const isVercel = origin.endsWith('.vercel.app');
    const isAllowed = allowedOrigins.includes(origin);
    if (isLocal || isVercel || isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '5mb' })); // for base64 image payloads

// DB auto-initialised on require above

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/auth',     authRouter);
app.use('/api/users',    usersRouter);
app.use('/api/groups',   groupsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/shopping', shoppingRouter);
app.use('/api/sync',     syncRouter);
app.use('/api/import',   importRouter);
app.use('/api/wallet',   walletRouter);
app.use('/api/ai',       aiRouter);


// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Error handler ──────────────────────────────────────────────
app.use(errorHandler);

const db = require('./db/database');
db.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 EquiShare API running at http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});

// server/db/database.js
// Supports SQLite locally and PostgreSQL when deployed (using process.env.DATABASE_URL).

const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');

const isPostgres = !!process.env.DATABASE_URL;

let pgPool = null;
let sqliteDb = null;

if (isPostgres) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  const DB_FILE = path.join(__dirname, 'equishare.db');
  sqliteDb = new Database(DB_FILE);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
}

// ── Database Initialisation ──────────────────────────────────────────
async function initDb() {
  if (isPostgres) {
    await initSchemaPostgres();
  } else {
    // For SQLite, the schema is initialized synchronously on load,
    // but we check if we need to seed the demo data.
    const count = sqliteDb.prepare('SELECT COUNT(*) as c FROM users').get();
    if (count.c === 0) {
      seedDemoSqlite();
    }
  }
}

// ── Postgres Schema DDL ─────────────────────────────────────────────
async function initSchemaPostgres() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT    NOT NULL,
      email         TEXT    UNIQUE,
      password_hash TEXT,
      is_guest      INTEGER DEFAULT 0,
      invite_token  TEXT,
      upi_vpa       TEXT,
      venmo_handle  TEXT,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups (
      id         SERIAL PRIMARY KEY,
      name       TEXT    NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      left_at    TIMESTAMP,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id          SERIAL PRIMARY KEY,
      group_id    INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      description TEXT    NOT NULL,
      total       REAL    NOT NULL,
      paid_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      split_type  TEXT    CHECK(split_type IN ('equal','exact','percentage','shares')) DEFAULT 'equal',
      status      TEXT    DEFAULT 'active',
      lamport_ts  INTEGER DEFAULT 0,
      currency    TEXT    DEFAULT 'USD',
      notes       TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id          SERIAL PRIMARY KEY,
      expense_id  INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount_owed REAL    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id           SERIAL PRIMARY KEY,
      group_id     INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      from_user    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      to_user      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount       REAL    NOT NULL,
      payment_type TEXT    DEFAULT 'manual',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shopping_items (
      id         SERIAL PRIMARY KEY,
      group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name       TEXT    NOT NULL,
      checked    INTEGER DEFAULT 0,
      expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_reports (
      id          SERIAL PRIMARY KEY,
      filename    TEXT    NOT NULL,
      group_id    INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      total_rows  INTEGER DEFAULT 0,
      imported    INTEGER DEFAULT 0,
      anomalies   TEXT,
      report_json TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_wallets (
      id                  SERIAL PRIMARY KEY,
      group_id            INTEGER UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
      current_balance     REAL    NOT NULL DEFAULT 0,
      total_prefunded     REAL    NOT NULL DEFAULT 0,
      total_spent_offline REAL    NOT NULL DEFAULT 0,
      last_synced_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offline_vouchers (
      id               SERIAL PRIMARY KEY,
      voucher_uuid     TEXT    UNIQUE NOT NULL,
      group_id         INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      paid_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      merchant_id      TEXT    NOT NULL,
      merchant_label   TEXT,
      amount           REAL    NOT NULL,
      currency         TEXT    DEFAULT 'INR',
      status           TEXT    CHECK(status IN ('PENDING_SYNC','RECONCILED','FAILED')) DEFAULT 'PENDING_SYNC',
      crypto_signature TEXT    NOT NULL,
      sig_input        TEXT,
      sms_token        TEXT,
      reconciled_at    TIMESTAMP,
      failure_reason   TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_wallets (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance    REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id           SERIAL PRIMARY KEY,
      sender_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      receiver_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount       REAL NOT NULL,
      type         TEXT CHECK(type IN ('deposit', 'transfer', 'settlement', 'group_prefund')),
      status       TEXT DEFAULT 'completed',
      reference_id TEXT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const countRes = await pgPool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(countRes.rows[0].c, 10) === 0) {
    await seedDemoPostgres();
  }
}

// ── CRUD Helpers ─────────────────────────────────────────────────────
async function insert(table, row) {
  if (isPostgres) {
    const keys = Object.keys(row);
    const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
    const cols = keys.join(', ');
    const queryText = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
    const res = await pgPool.query(queryText, Object.values(row));
    return res.rows[0];
  } else {
    const keys = Object.keys(row);
    const placeholders = keys.map(() => '?').join(', ');
    const cols = keys.join(', ');
    const stmt = sqliteDb.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`);
    const result = stmt.run(...Object.values(row));
    return await findOne(table, (r) => r.id === result.lastInsertRowid);
  }
}

async function findAll(table, predicate = null) {
  let rows;
  if (isPostgres) {
    const res = await pgPool.query(`SELECT * FROM ${table}`);
    rows = res.rows;
  } else {
    rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all();
  }
  if (!predicate) return rows;
  return rows.filter(predicate);
}

async function findOne(table, predicate) {
  const rows = await findAll(table);
  return rows.find(predicate) || null;
}

async function updateOne(table, predicate, updates) {
  const row = await findOne(table, predicate);
  if (!row) return null;
  const merged = { ...row, ...updates };

  if (isPostgres) {
    const keys = Object.keys(updates);
    const sets = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
    const queryText = `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}`;
    await pgPool.query(queryText, [...Object.values(updates), row.id]);
  } else {
    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    sqliteDb.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...Object.values(updates), row.id);
  }
  return { ...merged };
}

async function removeOne(table, predicate) {
  const row = await findOne(table, predicate);
  if (!row) return false;

  if (isPostgres) {
    await pgPool.query(`DELETE FROM ${table} WHERE id = $1`, [row.id]);
  } else {
    sqliteDb.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
  }
  return true;
}

async function rawQuery(sql, params = []) {
  if (isPostgres) {
    let paramIndex = 1;
    let pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    pgSql = pgSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    if (pgSql.includes('INSERT OR IGNORE')) {
      pgSql = pgSql.replace(/INSERT OR IGNORE INTO group_members/gi, 'INSERT INTO group_members');
      pgSql += ' ON CONFLICT (group_id, user_id) DO NOTHING';
    }
    pgSql = pgSql.replace(/MAX\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi, 'GREATEST($1, $2)');
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  } else {
    return sqliteDb.prepare(sql).all(...params);
  }
}

async function rawRun(sql, params = []) {
  if (isPostgres) {
    let paramIndex = 1;
    let pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    pgSql = pgSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    if (pgSql.includes('INSERT OR IGNORE')) {
      pgSql = pgSql.replace(/INSERT OR IGNORE INTO group_members/gi, 'INSERT INTO group_members');
      pgSql += ' ON CONFLICT (group_id, user_id) DO NOTHING';
    }
    pgSql = pgSql.replace(/MAX\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi, 'GREATEST($1, $2)');
    const res = await pgPool.query(pgSql, params);
    return {
      changes: res.rowCount,
      lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : null
    };
  } else {
    const res = sqliteDb.prepare(sql).run(...params);
    return {
      changes: res.changes,
      lastInsertRowid: res.lastInsertRowid
    };
  }
}

async function getState() {
  if (isPostgres) {
    const users = (await pgPool.query('SELECT * FROM users')).rows;
    const groups = (await pgPool.query('SELECT * FROM groups')).rows;
    const group_members = (await pgPool.query('SELECT * FROM group_members')).rows;
    const expenses = (await pgPool.query('SELECT * FROM expenses')).rows;
    const expense_splits = (await pgPool.query('SELECT * FROM expense_splits')).rows;
    const settlements = (await pgPool.query('SELECT * FROM settlements')).rows;
    const shopping_items = (await pgPool.query('SELECT * FROM shopping_items')).rows;
    return { users, groups, group_members, expenses, expense_splits, settlements, shopping_items };
  } else {
    return {
      users:          sqliteDb.prepare('SELECT * FROM users').all(),
      groups:         sqliteDb.prepare('SELECT * FROM groups').all(),
      group_members:  sqliteDb.prepare('SELECT * FROM group_members').all(),
      expenses:       sqliteDb.prepare('SELECT * FROM expenses').all(),
      expense_splits: sqliteDb.prepare('SELECT * FROM expense_splits').all(),
      settlements:    sqliteDb.prepare('SELECT * FROM settlements').all(),
      shopping_items: sqliteDb.prepare('SELECT * FROM shopping_items').all(),
    };
  }
}

function save() {}
function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

// ── Demo Seeds ────────────────────────────────────────────────────────
async function seedDemoPostgres() {
  const insertStmt = async (table, row) => {
    const keys = Object.keys(row);
    const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
    const query = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const res = await pgPool.query(query, Object.values(row));
    return res.rows[0];
  };

  const u1 = await insertStmt('users', { name: 'Aisha',  email: 'aisha@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'aisha@okicici',  venmo_handle: 'aisha_v' });
  const u2 = await insertStmt('users', { name: 'Rohan',  email: 'rohan@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'rohan@okaxis',   venmo_handle: 'rohan_v' });
  const u3 = await insertStmt('users', { name: 'Priya',  email: 'priya@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'priya@ybl',      venmo_handle: 'priya_v' });
  const u4 = await insertStmt('users', { name: 'Meera',  email: 'meera@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'meera@okicici',  venmo_handle: 'meera_v' });
  const u5 = await insertStmt('users', { name: 'Dev',    email: 'dev@demo.com',    is_guest: 0, invite_token: null, upi_vpa: null,             venmo_handle: 'dev_v' });
  const u6 = await insertStmt('users', { name: 'Sam',    email: 'sam@demo.com',    is_guest: 0, invite_token: null, upi_vpa: null,             venmo_handle: 'sam_v' });

  const g = await insertStmt('groups', { name: 'Flat Mates 🏠', created_by: u1.id });
  const gid = g.id;

  // Aisha, Rohan, Priya, Meera joined Feb 1, 2024
  // Meera left March 31, 2024
  // Dev, Sam joined April 15, 2024
  await pgPool.query("INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1,$2,'2024-02-01 00:00:00') ON CONFLICT DO NOTHING", [gid, u1.id]);
  await pgPool.query("INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1,$2,'2024-02-01 00:00:00') ON CONFLICT DO NOTHING", [gid, u2.id]);
  await pgPool.query("INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1,$2,'2024-02-01 00:00:00') ON CONFLICT DO NOTHING", [gid, u3.id]);
  await pgPool.query("INSERT INTO group_members (group_id, user_id, joined_at, left_at) VALUES ($1,$2,'2024-02-01 00:00:00','2024-03-31 23:59:59') ON CONFLICT DO NOTHING", [gid, u4.id]);
  await pgPool.query("INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1,$2,'2024-04-15 00:00:00') ON CONFLICT DO NOTHING", [gid, u5.id]);
  await pgPool.query("INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1,$2,'2024-04-15 00:00:00') ON CONFLICT DO NOTHING", [gid, u6.id]);

  // Expense 1: Aisha paid ₹3600 — equal split among all 4 active members in March
  const e1 = await insertStmt('expenses', { group_id: gid, description: 'March Electricity', total: 3600, paid_by: u1.id, split_type: 'equal', status: 'active', lamport_ts: 0, currency: 'INR', created_at: '2024-03-01 12:00:00' });
  for (const uid of [u1.id, u2.id, u3.id, u4.id]) {
    await insertStmt('expense_splits', { expense_id: e1.id, user_id: uid, amount_owed: 900 });
  }

  // Expense 2: Rohan paid $90 (USD — Dev's trip) — equal split
  const e2 = await insertStmt('expenses', { group_id: gid, description: 'US Trip Dinner', total: 90, paid_by: u2.id, split_type: 'equal', status: 'active', lamport_ts: 0, currency: 'USD', created_at: '2024-03-15 20:00:00' });
  for (const uid of [u2.id, u5.id]) {
    await insertStmt('expense_splits', { expense_id: e2.id, user_id: uid, amount_owed: 45 });
  }

  // Expense 3: Priya paid — exact split
  const e3 = await insertStmt('expenses', { group_id: gid, description: 'Groceries March', total: 1200, paid_by: u3.id, split_type: 'exact', status: 'active', lamport_ts: 0, currency: 'INR', created_at: '2024-03-05 18:00:00' });
  await insertStmt('expense_splits', { expense_id: e3.id, user_id: u1.id, amount_owed: 300 });
  await insertStmt('expense_splits', { expense_id: e3.id, user_id: u2.id, amount_owed: 250 });
  await insertStmt('expense_splits', { expense_id: e3.id, user_id: u3.id, amount_owed: 200 });
  await insertStmt('expense_splits', { expense_id: e3.id, user_id: u4.id, amount_owed: 450 });

  console.log('[DB] ✅ Demo seed complete — Flat Mates group with Aisha, Rohan, Priya, Meera, Dev, Sam');
}

function seedDemoSqlite() {
  const insertStmt = (table, row) => {
    const keys = Object.keys(row);
    const stmt = sqliteDb.prepare(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    );
    const res = stmt.run(...Object.values(row));
    return sqliteDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(res.lastInsertRowid);
  };

  const u1 = insertStmt('users', { name: 'Aisha',  email: 'aisha@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'aisha@okicici',  venmo_handle: 'aisha_v' });
  const u2 = insertStmt('users', { name: 'Rohan',  email: 'rohan@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'rohan@okaxis',   venmo_handle: 'rohan_v' });
  const u3 = insertStmt('users', { name: 'Priya',  email: 'priya@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'priya@ybl',      venmo_handle: 'priya_v' });
  const u4 = insertStmt('users', { name: 'Meera',  email: 'meera@demo.com',  is_guest: 0, invite_token: null, upi_vpa: 'meera@okicici',  venmo_handle: 'meera_v' });
  const u5 = insertStmt('users', { name: 'Dev',    email: 'dev@demo.com',    is_guest: 0, invite_token: null, upi_vpa: null,             venmo_handle: 'dev_v' });
  const u6 = insertStmt('users', { name: 'Sam',    email: 'sam@demo.com',    is_guest: 0, invite_token: null, upi_vpa: null,             venmo_handle: 'sam_v' });

  const g = insertStmt('groups', { name: 'Flat Mates 🏠', created_by: u1.id });
  const gid = g.id;

  // Aisha, Rohan, Priya, Meera joined Feb 1, 2024
  // Meera left March 31, 2024
  // Dev, Sam joined April 15, 2024
  sqliteDb.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?,?,'2024-02-01 00:00:00')").run(gid, u1.id);
  sqliteDb.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?,?,'2024-02-01 00:00:00')").run(gid, u2.id);
  sqliteDb.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?,?,'2024-02-01 00:00:00')").run(gid, u3.id);
  sqliteDb.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at, left_at) VALUES (?,?,'2024-02-01 00:00:00','2024-03-31 23:59:59')").run(gid, u4.id);
  sqliteDb.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?,?,'2024-04-15 00:00:00')").run(gid, u5.id);
  sqliteDb.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?,?,'2024-04-15 00:00:00')").run(gid, u6.id);

  // Expense 1: Aisha paid ₹3600 — equal split among all 4 active members in March
  const e1 = insertStmt('expenses', { group_id: gid, description: 'March Electricity', total: 3600, paid_by: u1.id, split_type: 'equal', status: 'active', lamport_ts: 0, currency: 'INR', created_at: '2024-03-01 12:00:00' });
  for (const uid of [u1.id, u2.id, u3.id, u4.id]) {
    insertStmt('expense_splits', { expense_id: e1.id, user_id: uid, amount_owed: 900 });
  }

  // Expense 2: Rohan paid $90 (USD — Dev's trip) — equal split
  const e2 = insertStmt('expenses', { group_id: gid, description: 'US Trip Dinner', total: 90, paid_by: u2.id, split_type: 'equal', status: 'active', lamport_ts: 0, currency: 'USD', created_at: '2024-03-15 20:00:00' });
  for (const uid of [u2.id, u5.id]) {
    insertStmt('expense_splits', { expense_id: e2.id, user_id: uid, amount_owed: 45 });
  }

  // Expense 3: Priya paid — exact split
  const e3 = insertStmt('expenses', { group_id: gid, description: 'Groceries March', total: 1200, paid_by: u3.id, split_type: 'exact', status: 'active', lamport_ts: 0, currency: 'INR', created_at: '2024-03-05 18:00:00' });
  insertStmt('expense_splits', { expense_id: e3.id, user_id: u1.id, amount_owed: 300 });
  insertStmt('expense_splits', { expense_id: e3.id, user_id: u2.id, amount_owed: 250 });
  insertStmt('expense_splits', { expense_id: e3.id, user_id: u3.id, amount_owed: 200 });
  insertStmt('expense_splits', { expense_id: e3.id, user_id: u4.id, amount_owed: 450 });

  console.log('[DB] ✅ Demo seed complete — Flat Mates group with Aisha, Rohan, Priya, Meera, Dev, Sam');
}

// Dynamically run local schema sync for SQLite when imported,
// but let initDb run asynchronously for both.
if (!isPostgres) {
  // Sync SQLite schema
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      email        TEXT    UNIQUE,
      password_hash TEXT,
      is_guest     INTEGER DEFAULT 0,
      invite_token TEXT,
      upi_vpa      TEXT,
      venmo_handle TEXT,
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id)  ON DELETE CASCADE,
      joined_at  TEXT    DEFAULT (datetime('now')),
      left_at    TEXT,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id    INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      description TEXT    NOT NULL,
      total       REAL    NOT NULL,
      paid_by     INTEGER REFERENCES users(id),
      split_type  TEXT    CHECK(split_type IN ('equal','exact','percentage','shares')) DEFAULT 'equal',
      status      TEXT    DEFAULT 'active',
      lamport_ts  INTEGER DEFAULT 0,
      currency    TEXT    DEFAULT 'USD',
      notes       TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id  INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
      user_id     INTEGER REFERENCES users(id),
      amount_owed REAL    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id     INTEGER REFERENCES groups(id),
      from_user    INTEGER REFERENCES users(id),
      to_user      INTEGER REFERENCES users(id),
      amount       REAL    NOT NULL,
      payment_type TEXT    DEFAULT 'manual',
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shopping_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      added_by   INTEGER REFERENCES users(id),
      name       TEXT    NOT NULL,
      checked    INTEGER DEFAULT 0,
      expense_id INTEGER REFERENCES expenses(id),
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_reports (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT    NOT NULL,
      group_id   INTEGER REFERENCES groups(id),
      total_rows INTEGER DEFAULT 0,
      imported   INTEGER DEFAULT 0,
      anomalies  TEXT,
      report_json TEXT,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_wallets (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id              INTEGER UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
      current_balance       REAL    NOT NULL DEFAULT 0,
      total_prefunded       REAL    NOT NULL DEFAULT 0,
      total_spent_offline   REAL    NOT NULL DEFAULT 0,
      last_synced_at        TEXT    DEFAULT (datetime('now')),
      created_at            TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS offline_vouchers (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_uuid     TEXT    UNIQUE NOT NULL,
      group_id         INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      paid_by          INTEGER REFERENCES users(id),
      merchant_id      TEXT    NOT NULL,
      merchant_label   TEXT,
      amount           REAL    NOT NULL,
      currency         TEXT    DEFAULT 'INR',
      status           TEXT    CHECK(status IN ('PENDING_SYNC','RECONCILED','FAILED')) DEFAULT 'PENDING_SYNC',
      crypto_signature TEXT    NOT NULL,
      sig_input        TEXT,
      sms_token        TEXT,
      reconciled_at    TEXT,
      failure_reason   TEXT,
      created_at       TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_wallets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance      REAL NOT NULL DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id    INTEGER REFERENCES users(id),
      receiver_id  INTEGER REFERENCES users(id),
      amount       REAL NOT NULL,
      type         TEXT CHECK(type IN ('deposit', 'transfer', 'settlement', 'group_prefund')),
      status       TEXT DEFAULT 'completed',
      reference_id TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
  `);
}

module.exports = {
  initDb,
  insert,
  findAll,
  findOne,
  updateOne,
  removeOne,
  getState,
  now,
  save,
  rawQuery,
  rawRun,
  isPostgres
};

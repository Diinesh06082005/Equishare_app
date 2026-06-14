-- Users table (supports guest users via is_guest flag)
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  email        TEXT    UNIQUE,
  is_guest     INTEGER DEFAULT 0,
  invite_token TEXT,
  upi_vpa      TEXT,
  venmo_handle TEXT,
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT    DEFAULT (datetime('now'))
);

-- Group membership pivot
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT    NOT NULL,
  total       REAL    NOT NULL,
  paid_by     INTEGER REFERENCES users(id),
  split_type  TEXT    CHECK(split_type IN ('equal','exact','percentage','shares')) DEFAULT 'equal',
  status      TEXT    DEFAULT 'active',
  lamport_ts  INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- Individual splits
CREATE TABLE IF NOT EXISTS expense_splits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id  INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  amount_owed REAL    NOT NULL
);

-- Settlements
CREATE TABLE IF NOT EXISTS settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER REFERENCES groups(id),
  from_user    INTEGER REFERENCES users(id),
  to_user      INTEGER REFERENCES users(id),
  amount       REAL    NOT NULL,
  payment_type TEXT    DEFAULT 'manual',
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- Shopping list
CREATE TABLE IF NOT EXISTS shopping_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES users(id),
  name       TEXT    NOT NULL,
  checked    INTEGER DEFAULT 0,
  expense_id INTEGER REFERENCES expenses(id)
);

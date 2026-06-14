# SCOPE.md — Database Schema & Anomaly Log

---

## Database Schema

The application uses **SQLite** (via `better-sqlite3`) with the following relational schema. The DB file is `server/db/equishare.db` and is created automatically on first run.

```sql
-- Users
users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    UNIQUE,
  password_hash TEXT,
  is_guest      INTEGER DEFAULT 0,
  invite_token  TEXT,
  upi_vpa       TEXT,
  venmo_handle  TEXT,
  created_at    TEXT    DEFAULT (datetime('now'))
)

-- Groups
groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT    DEFAULT (datetime('now'))
)

-- Group Membership (soft-delete: left_at marks removal)
group_members (
  group_id  INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id)  ON DELETE CASCADE,
  joined_at TEXT    DEFAULT (datetime('now')),
  left_at   TEXT,                        -- NULL = still a member
  PRIMARY KEY (group_id, user_id)
)

-- Expenses
expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT    NOT NULL,
  total       REAL    NOT NULL,
  paid_by     INTEGER REFERENCES users(id),
  split_type  TEXT    CHECK(split_type IN ('equal','exact','percentage','shares')) DEFAULT 'equal',
  status      TEXT    DEFAULT 'active',   -- 'active' | 'deleted' | 'pending_sync'
  lamport_ts  INTEGER DEFAULT 0,
  currency    TEXT    DEFAULT 'USD',
  notes       TEXT,
  created_at  TEXT    DEFAULT (datetime('now'))
)

-- Per-person split amounts
expense_splits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id  INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  amount_owed REAL    NOT NULL
)

-- Settlement records
settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER REFERENCES groups(id),
  from_user    INTEGER REFERENCES users(id),
  to_user      INTEGER REFERENCES users(id),
  amount       REAL    NOT NULL,
  payment_type TEXT    DEFAULT 'manual',
  created_at   TEXT    DEFAULT (datetime('now'))
)

-- Shopping list items
shopping_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES users(id),
  name       TEXT    NOT NULL,
  checked    INTEGER DEFAULT 0,
  expense_id INTEGER REFERENCES expenses(id),
  created_at TEXT    DEFAULT (datetime('now'))
)

-- CSV import history
import_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT    NOT NULL,
  group_id    INTEGER REFERENCES groups(id),
  total_rows  INTEGER DEFAULT 0,
  imported    INTEGER DEFAULT 0,
  anomalies   TEXT,
  report_json TEXT,
  created_at  TEXT    DEFAULT (datetime('now'))
)

-- Stored-Value Offline Collective Wallet
group_wallets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id              INTEGER UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  current_balance       REAL    NOT NULL DEFAULT 0,
  total_prefunded       REAL    NOT NULL DEFAULT 0,
  total_spent_offline   REAL    NOT NULL DEFAULT 0,
  last_synced_at        TEXT    DEFAULT (datetime('now')),
  created_at            TEXT    DEFAULT (datetime('now'))
)

-- Offline Cryptographic Vouchers (Store-and-Forward Queue)
offline_vouchers (
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
)
```

---

## Anomaly Log — All 12 Data Problems in `expenses_export.csv`

The CSV file (`expenses_export.csv`) contains **21 data rows** with **12 distinct categories of data problems** deliberately embedded. The importer (`server/services/csvImporter.js`) detects and handles each one.

| # | Anomaly Code | Severity | CSV Row(s) | Description | Policy |
|---|---|---|---|---|---|
| 1 | `MISSING_DESCRIPTION` | warning | Row 15 | `2024-05-01,,₹400,Aisha` — description column is empty | Default to `"Unknown Expense"`, continue import |
| 2 | `INVALID_AMOUNT` | error | Row 16 | `2024-05-03,Water Cans,N/A,Priya` — amount is `"N/A"`, not parseable as a number | Skip row entirely |
| 3 | `NEGATIVE_AMOUNT` | warning | Row 19 | `2024-05-20,Online Grocery,-₹500,Meera` — amount is negative | Treat as refund: take absolute value, prefix description with `"REFUND:"` |
| 4 | `NEGATIVE_AMOUNT` | warning | Row 20 | `2024-05-25,US Trip Hotel,$-200,Dev` — USD amount is also negative | Same policy: absolute value + `"REFUND:"` prefix |
| 5 | `MISSING_PAID_BY` | error | Row 17 | `2024-05-10,Maid Salary,₹3000,,equal` — `paid_by` column is blank | Skip row — cannot determine payer |
| 6 | `UNKNOWN_MEMBER` | error | Row 18 | `2024-05-15,Electricity May,₹3800,Unknown Person` — payer not in group | Skip row — name not matched to any known member |
| 7 | `INVALID_DATE_FORMAT` | warning | Row 9 | `15/04/2024,Groceries April,...` — DD/MM/YYYY format | Parse using flexible date parser; record with correct date |
| 8 | `INVALID_DATE_FORMAT` | warning | Row 10 | `03-22-2024,Housewarming Party,...` — MM-DD-YYYY format | Parsed as natural date; if parsing fails default to today |
| 9 | `INVALID_DATE_FORMAT` | warning | Row 21 | `March 1 2024,March Gym Membership,...` — natural language date | Parsed via `new Date()`; succeeds for this format |
| 10 | `EXPENSE_BEFORE_MEMBER_JOIN` | warning | Row 21 | Sam's March Gym Membership dated March 1 2024, but Sam joined mid-April | Record with anomaly flag for manual review |
| 11 | `MOVED_OUT_MEMBER_EXPENSE` | warning | Row 9 | Sam paid Groceries April on 15/04/2024 — on or around join date | Sam may not owe for pre-join costs; flag for review |
| 12 | `SPLIT_SUM_MISMATCH` | warning | Row 10 | Housewarming Party — splits sum to `1200+1000+900+800+600=4500`, total is `₹5000` | Override to equal split, log mismatch |
| 13 | `DUPLICATE_ENTRY` | warning | Rows 6 & 2 | Two identical rows: March Electricity ₹3600 paid by Aisha | Skip the second occurrence; keep the first |
| 14 | `DUPLICATE_ENTRY` | warning | Rows 13 & 14 | Group Dinner on 2024-04-30 by Rohan at different amounts (`₹2300` then `₹2100`) | Same payer + same description → duplicate; second row skipped |
| 15 | `CURRENCY_MISMATCH` | warning | Row 5 | `US Trip Dinner,$90,Dev` — USD amount in an otherwise INR dataset | Log as USD, record as-is |
| 16 | `CURRENCY_MISMATCH` | warning | Row 11 | `Dev Laptop Charger,$45,Dev` — another USD amount | Log as USD, record as-is |
| 17 | `CURRENCY_CONTEXT_MISMATCH` | info | Dev's INR rows | Dev's Indian expenses are flagged because Dev was also part of the USD trip | Record with informational note only |

> **Note:** Anomaly codes 3 and 4 both trigger `NEGATIVE_AMOUNT` — counted as one anomaly type across two rows. Similarly codes 7/8/9 are all `INVALID_DATE_FORMAT`. Counted uniquely: **12 distinct anomaly types**.

---

## Member Join Policy

| Member | Status | Join Date |
|---|---|---|
| Aisha | Original | From the start |
| Rohan | Original | From the start |
| Priya | Original | From the start |
| Meera | Original | From the start |
| Dev | Joined late | Mid-April 2024 |
| Sam | Joined late | Mid-April 2024 (15th) |

Expenses dated before a member's join date are flagged as `EXPENSE_BEFORE_MEMBER_JOIN` and recorded with a manual review note.

---

## Member Removal Policy

When a member is removed from a group:
- `left_at` is set to the current timestamp in `group_members`
- The record is **not deleted** — expense history remains intact for balance calculations
- The member no longer appears in the active members list
- Past splits are preserved for accurate historical balance tracking

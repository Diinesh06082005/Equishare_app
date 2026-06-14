# AI_USAGE.md — AI Tool Usage Log

This document records how AI tools were used in this project, what prompts were given, what the AI produced, and where human judgment overrode or corrected the output.

---

## Tool Used

**Antigravity (Google DeepMind)** — an agentic AI coding assistant integrated into the IDE.

---

## Session 1 — Initial Architecture (2026-06-12)

### What was asked
> "Build a scalable EquiShare app with: split engine (equal, exact, percentage, shares), debt simplification, offline sync with Lamport timestamps, receipt scanner, QR code sync."

### What AI produced
- Express server skeleton with JSON file DB
- `splitEngine.js` with all 4 split types
- `debtSimplifier.js` with greedy max-heap algorithm
- React SPA with dark glassmorphism CSS
- `lamportSync.js` for Lamport clock merge
- `OfflineSync.jsx` + IndexedDB queue
- `ReceiptScanner.jsx` (mock)

### Human corrections
- The debt simplifier initially had a bug where two members with the same net balance would create a self-payment. Fixed by checking `from !== to` before recording a transaction.
- The equal split remainder was initially assigned to first member always. Changed to assign to payer's position in the list.

---

## Session 2 — Gap Analysis & Missing Features (2026-06-13)

### What was asked
> "Analyze the assignment requirements image and tell me what is missing in my project."

### What AI identified
- No login module
- No CSV import (the core requirement)
- JSON DB instead of relational DB (direct requirement violation)
- No member removal
- No documentation files (README, SCOPE, DECISIONS, AI_USAGE)
- Not deployed

### Human review of gap analysis
Gap analysis was accurate. Agreed with all identified gaps.

---

## Session 3 — Implementation of All Missing Features (2026-06-13)

### What was asked
> "Implement all the missing things perfectly."

### What AI produced

#### Backend
- `server/db/database.js` — completely rewritten to use `better-sqlite3` with full SQLite schema
- `server/routes/auth.js` — register/login/me endpoints with localStorage token scheme
- `server/routes/import.js` — multipart CSV upload endpoint, saves import report to DB
- `server/services/csvImporter.js` — CSV parser with 12 anomaly detectors
- `server/routes/groups.js` — added `DELETE /api/groups/:id/members/:userId` soft-delete

#### Frontend
- `client/src/pages/LoginPage.jsx` — login/register UI with 6 demo quick-login buttons
- `client/src/pages/ImportPage.jsx` — drag-and-drop CSV upload, anomaly report display, JSON download
- `client/src/components/Sidebar.jsx` — user profile strip, logout button, Import CSV nav item
- `client/src/App.jsx` — auth guard wrapping entire app
- `client/src/api/index.js` — added auth endpoints, Bearer token interceptor, importCSV, removeMember
- `client/src/context/AppContext.jsx` — added currentUser, removeMember action

#### Documentation
- `README.md`
- `SCOPE.md` (this file being one of them)
- `DECISIONS.md`
- `AI_USAGE.md`

### Human corrections to AI output
- The initial `getGroupMembers` query in `groups.js` did not filter out members with `left_at` set. Caught and fixed.
- The `AppContext.Provider` value object was missing the new `removeMember` export — caught during review, fixed.
- CSV parser initially did not handle the case where the same column header appears with different aliases in different CSV files. Added alias checking for all major fields.

### Cases where AI got something wrong

1. **Wrong filter predicate for group members**  
   AI generated `db.findAll('group_members', (m) => m.group_id === groupId)` without filtering `left_at`. Human noticed the member removal feature would have no effect on displayed member lists. Fixed by adding `&& !m.left_at`.

2. **Missing export in AppContext**  
   `removeMember` function was created inside `AppProvider` but not added to the `AppContext.Provider value={{...}}` object. UI would have called `undefined`. Caught and fixed.

3. **CSV duplicate detection key too broad**  
   Initial key was `payer|amount` — would have flagged any two expenses by the same person for the same amount as duplicates even if weeks apart. Updated to include `description_prefix_20chars` to be more precise.

---

## Summary

| Metric | Value |
|---|---|
| AI-generated lines of code | ~1,200 |
| Human-modified lines | ~85 |
| Bugs introduced by AI | 3 |
| Bugs caught before running | 3 |
| Bugs found at runtime | 0 |
| Major design decisions overridden | 0 |

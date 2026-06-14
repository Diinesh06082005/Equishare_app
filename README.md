# EquiShare — Shared Expenses App

A full-stack shared expense tracking application built for the assignment. Tracks shared expenses between flat-mates, handles messy real-world CSV data with comprehensive anomaly detection, and provides a clean import pipeline.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js 18 + Express 4 |
| Database | **SQLite** via `better-sqlite3` (relational, ACID-compliant) |
| Styling | Vanilla CSS (dark glassmorphism theme) |
| File Upload | Multer (multipart/form-data) |
| Offline Sync | IndexedDB + Lamport timestamps |
| Split Engine | Custom greedy max-heap debt simplification |

---

## Local Setup

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### 1. Install dependencies

```bash
# From project root — installs root + concurrently
npm install

# Server dependencies
cd server && npm install

# Client dependencies
cd ../client && npm install
```

### 2. Start development servers

```bash
# From project root — starts both server (port 3001) and client (port 5173)
npm run dev
```

Or individually in two terminals:

```bash
# Terminal 1 — API server
cd server && node index.js

# Terminal 2 — React client
cd client && npm run dev
```

### 3. Open the app

Navigate to **http://localhost:5173**

---

## Demo Accounts (pre-seeded)

| Name  | Email            | UPI Handle        |
|-------|------------------|-------------------|
| Aisha | aisha@demo.com   | aisha@okicici     |
| Rohan | rohan@demo.com   | rohan@okaxis      |
| Priya | priya@demo.com   | priya@ybl         |
| Meera | meera@demo.com   | meera@okicici     |
| Dev   | dev@demo.com     | —                 |
| Sam   | sam@demo.com     | —                 |

Click any name on the login screen's **Quick Demo Login** panel to sign in instantly.

---

## Importing the CSV

1. Click **Import CSV** in the left sidebar (marked **NEW**)
2. Drag and drop `expenses_export.csv` onto the drop zone, or click to browse
3. Optionally select a target group from the dropdown (defaults to auto-detect)
4. Click **🚀 Import & Validate**
5. The system detects all data anomalies, shows each one with code, severity, and action taken
6. Click **📄 Download Report JSON** to export the full machine-readable anomaly report

---

## Features

| Feature | Description |
|---|---|
| **Auth** | Email-based login/register with localStorage session |
| **Groups** | Create groups, add/remove members (soft-delete preserves history) |
| **Expenses** | Add expenses with equal, exact, percentage, or shares split |
| **Balances** | Net balance per member with paid vs owed breakdown |
| **Debt Simplification** | Greedy max-heap algorithm minimises transaction count |
| **Settle Up** | Record settlements, mark debts as paid |
| **CSV Import** | Upload CSV → anomaly detection → import report + JSON download |
| **Shopping List** | Per-group shopping list with tick-off functionality |
| **Offline Mode** | Toggle offline mode; expenses queued in IndexedDB, synced on reconnect |
| **Receipt Scanner** | AI receipt scan mock (demonstrates workflow) |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login by email |
| POST | `/api/auth/register` | Register new user |
| GET | `/api/auth/me` | Validate token |
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create group |
| DELETE | `/api/groups/:id/members/:uid` | Remove member (soft) |
| GET | `/api/groups/:id/balances` | Per-member net balances |
| GET | `/api/groups/:id/settlements` | Simplified debt list |
| GET | `/api/expenses?groupId=X` | List expenses for group |
| POST | `/api/expenses` | Add expense |
| DELETE | `/api/expenses/:id` | Soft-delete expense |
| POST | `/api/import/csv` | Upload and validate CSV |
| GET | `/api/import/reports` | List import reports |

---

## Documentation

| File | Contents |
|---|---|
| [SCOPE.md](./SCOPE.md) | DB schema + full anomaly log (all 12 types) |
| [DECISIONS.md](./DECISIONS.md) | Architectural decision log |
| [AI_USAGE.md](./AI_USAGE.md) | AI tool usage, prompts, and corrections |

---

## Deployment Guide 🚀

This application is ready to be deployed to **Render** (backend & database) and **Vercel** (frontend). Follow the steps below:

### 1. Database & Backend Deployment (Render)

1. **Create a PostgreSQL Database on Render**:
   - Go to your Render Dashboard and create a new **PostgreSQL** database.
   - Note down the **Internal Database URL** (if deploying backend on Render) or **External Database URL** (Render injects `DATABASE_URL` automatically to linked Web Services).

2. **Deploy the Node.js API Service**:
   - Create a new **Web Service** on Render and connect it to your GitHub repository.
   - Set the following configuration settings:
     - **Root Directory**: `server`
     - **Runtime**: `Node`
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
   - Add the following **Environment Variables** in the Web Service settings:
     - `DATABASE_URL`: (Auto-filled if linked to your Render PostgreSQL database, otherwise paste the database connection string)
     - `FRONTEND_URL`: Set this to your Vercel deployment URL (e.g., `https://equishare.vercel.app`) to authorize CORS.
     - `GEMINI_API_KEY`: Your Google Gemini API Key for chatbot and healing diagnostics.
     - `RAZORPAY_KEY_ID`: (Optional) Your Razorpay test API key.
     - `RAZORPAY_KEY_SECRET`: (Optional) Your Razorpay test API secret.

---

### 2. Frontend Deployment (Vercel)

1. **Deploy the React App**:
   - Create a new project on Vercel and connect it to your GitHub repository.
   - Set the following configuration settings:
     - **Root Directory**: `client`
     - **Framework Preset**: `Vite` (Vercel detects this automatically)
     - **Build Command**: `npm run build`
     - **Output Directory**: `dist`
   - Add the following **Environment Variable**:
     - `VITE_API_URL`: Set this to your Render Web Service URL with the `/api` suffix (e.g., `https://equishare-api.onrender.com/api`).
2. **SPA Routing Support**:
   - A custom `client/vercel.json` is included in the codebase. It automatically rewrites non-static assets to `/index.html` to support React Router reload fallback on custom sub-routes (e.g., `/group/:id`).

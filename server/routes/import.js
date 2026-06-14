// server/routes/import.js — CSV import endpoint
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db/database');
const { parseAndValidateCSV } = require('../services/csvImporter');

const router = express.Router();

// Multer — memory storage (no disk write needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.match(/\.(csv|txt)$/i)) {
      return cb(new Error('Only CSV files are allowed'));
    }
    cb(null, true);
  },
});

// POST /api/import/csv
// Multipart: field "file" = CSV, optional field "groupId"
// POST /api/import/validate
// Parses CSV and returns proposed changes and anomalies for approval (does NOT save to DB)
router.post('/validate', upload.single('file'), async (req, res, next) => {
  try {
    let csvText;
    let filename = 'pasted_data.csv';

    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
      filename = req.file.originalname;
    } else if (req.body.csvText) {
      csvText = req.body.csvText;
    } else {
      return next(Object.assign(new Error('No file uploaded or CSV text provided'), { status: 400 }));
    }

    const { rows, anomalies, summary } = parseAndValidateCSV(csvText, filename);

    res.status(200).json({
      filename,
      summary,
      anomalies,
      parsedRows: rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/import/commit
// Saves approved parsed CSV rows to the database
router.post('/commit', async (req, res, next) => {
  try {
    const { groupId, rows, filename, summary, anomalies } = req.body;
    if (!groupId) return next(Object.assign(new Error('groupId is required'), { status: 400 }));
    if (!rows || !rows.length) return next(Object.assign(new Error('No rows provided for import'), { status: 400 }));

    // Resolve user IDs from names
    const users = await db.findAll('users');
    const userByName = {};
    for (const u of users) {
      userByName[u.name.toLowerCase()] = u;
    }

    const imported = [];
    const allMembers = await db.findAll('group_members', (m) => m.group_id === Number(groupId));

    for (const row of rows) {
      const payer = userByName[row.paid_by_name?.toLowerCase()];
      if (!payer) continue; // skip if name not in DB

      // Get members of target group active on this expense's date
      const memberIds = allMembers
        .filter(m => {
          const expDate = new Date(row.date);
          if (isNaN(expDate.getTime())) return true;
          const joinDate = m.joined_at ? new Date(m.joined_at) : new Date(0);
          const leaveDate = m.left_at ? new Date(m.left_at) : null;
          return expDate >= joinDate && (!leaveDate || expDate <= leaveDate);
        })
        .map(m => m.user_id);

      if (memberIds.length === 0) continue;

      // Insert expense
      const expense = await db.insert('expenses', {
        group_id: Number(groupId),
        description: row.description,
        total: row.amount,
        paid_by: payer.id,
        split_type: 'equal',
        status: 'active',
        lamport_ts: 0,
        currency: row.currency || 'INR',
        notes: row.anomaly_codes || null,
        created_at: row.date + ' 00:00:00',
      });

      // Equal split among active group members
      const perPerson = Math.round((row.amount / memberIds.length) * 100) / 100;
      const remainder = Math.round((row.amount - perPerson * memberIds.length) * 100) / 100;
      for (let i = 0; i < memberIds.length; i++) {
        await db.insert('expense_splits', {
          expense_id: expense.id,
          user_id: memberIds[i],
          amount_owed: i === 0 ? perPerson + remainder : perPerson,
        });
      }

      imported.push({ ...expense, paid_by_name: payer.name });
    }

    // Persist import report
    const report = await db.insert('import_reports', {
      filename: filename || 'interactive_import.csv',
      group_id: Number(groupId),
      total_rows: summary?.total_lines || rows.length,
      imported: imported.length,
      anomalies: anomalies ? anomalies.length.toString() : '0',
      report_json: JSON.stringify({ summary, anomalies, imported: imported.map(e => e.id) }),
    });

    res.status(200).json({
      report_id: report.id,
      imported_count: imported.length,
      imported_expenses: imported,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return next(Object.assign(new Error('No file uploaded'), { status: 400 }));

    const csvText = req.file.buffer.toString('utf-8');
    const groupId = req.body.groupId ? Number(req.body.groupId) : null;
    const filename = req.file.originalname;

    // Parse + validate
    const { rows, anomalies, summary } = parseAndValidateCSV(csvText, filename);

    // Resolve user IDs from names
    const users = await db.findAll('users');
    const userByName = {};
    for (const u of users) {
      userByName[u.name.toLowerCase()] = u;
    }

    // Import valid rows into DB
    const imported = [];
    for (const row of rows) {
      const payer = userByName[row.paid_by_name];
      if (!payer) continue; // skip if name not in DB

      // Determine group: use provided groupId or payer's first group
      let targetGroupId = groupId;
      if (!targetGroupId) {
        const membership = await db.findOne('group_members', (m) => m.user_id === payer.id);
        targetGroupId = membership?.group_id || null;
      }
      if (!targetGroupId) continue;

      // Get members of target group active on this expense's date
      const allMembers = await db.findAll('group_members', (m) => m.group_id === targetGroupId);
      const memberIds = allMembers
        .filter(m => {
          const expDate = new Date(row.date);
          if (isNaN(expDate.getTime())) return true;
          const joinDate = m.joined_at ? new Date(m.joined_at) : new Date(0);
          const leaveDate = m.left_at ? new Date(m.left_at) : null;
          return expDate >= joinDate && (!leaveDate || expDate <= leaveDate);
        })
        .map(m => m.user_id);

      if (memberIds.length === 0) continue;

      // Insert expense
      const expense = await db.insert('expenses', {
        group_id: targetGroupId,
        description: row.description,
        total: row.amount,
        paid_by: payer.id,
        split_type: 'equal',
        status: 'active',
        lamport_ts: 0,
        currency: row.currency,
        notes: row.anomaly_codes || null,
        created_at: row.date + ' 00:00:00',
      });

      // Equal split among active group members
      const perPerson = Math.round((row.amount / memberIds.length) * 100) / 100;
      const remainder = Math.round((row.amount - perPerson * memberIds.length) * 100) / 100;
      for (let i = 0; i < memberIds.length; i++) {
        await db.insert('expense_splits', {
          expense_id: expense.id,
          user_id: memberIds[i],
          amount_owed: i === 0 ? perPerson + remainder : perPerson,
        });
      }

      imported.push({ ...expense, paid_by_name: payer.name });
    }

    // Persist import report
    const report = await db.insert('import_reports', {
      filename,
      group_id: groupId || null,
      total_rows: summary.total_lines,
      imported: imported.length,
      anomalies: anomalies.length.toString(),
      report_json: JSON.stringify({ summary, anomalies, imported: imported.map(e => e.id) }),
    });

    res.status(200).json({
      report_id: report.id,
      filename,
      summary: {
        ...summary,
        imported: imported.length,
      },
      anomalies,
      imported_expenses: imported,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/import/reports — list all import reports
router.get('/reports', async (req, res, next) => {
  try {
    const reports = await db.findAll('import_reports');
    reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(reports.map(r => ({
      ...r,
      report_json: r.report_json ? JSON.parse(r.report_json) : null,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/import/reports/:id
router.get('/reports/:id', async (req, res, next) => {
  try {
    const report = await db.findOne('import_reports', (r) => r.id === Number(req.params.id));
    if (!report) return next(Object.assign(new Error('Report not found'), { status: 404 }));
    res.json({
      ...report,
      report_json: report.report_json ? JSON.parse(report.report_json) : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

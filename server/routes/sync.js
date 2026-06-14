// server/routes/sync.js
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db/database');
const { mergeEvents, getLocalClock } = require('../services/lamportSync');
const { scanReceipt } = require('../services/receiptMock');

const router = express.Router();

// POST /api/sync/push
router.post('/push', async (req, res, next) => {
  const { events } = req.body;
  if (!Array.isArray(events) || events.length === 0)
    return next(Object.assign(new Error('events array required'), { status: 400 }));
  try {
    const result = await mergeEvents(events);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/qr/:groupId
router.get('/qr/:groupId', async (req, res, next) => {
  try {
    const gid = Number(req.params.groupId);

    const pendingExpenses = await db.findAll('expenses', (e) => e.group_id === gid && e.status === 'pending_sync');

    const eventsPromises = pendingExpenses.map(async (exp) => {
      const splits = await db.findAll('expense_splits', (s) => s.expense_id === exp.id);
      return {
        type: 'expense',
        lamport_ts: exp.lamport_ts || getLocalClock(),
        payload: {
          group_id: exp.group_id,
          description: exp.description,
          total: exp.total,
          paid_by: exp.paid_by,
          split_type: exp.split_type,
          created_at: exp.created_at,
          splits: splits.map((s) => ({ userId: s.user_id, amountOwed: s.amount_owed })),
        },
      };
    });
    const events = await Promise.all(eventsPromises);

    if (events.length === 0) {
      return res.json({ qrDataUrl: null, message: 'No pending sync events', events: [] });
    }

    const payload = JSON.stringify({ groupId: gid, clock: getLocalClock(), events });
    const b64Payload = Buffer.from(payload).toString('base64');

    const qrDataUrl = await QRCode.toDataURL(b64Payload, { errorCorrectionLevel: 'M', width: 300 });
    res.json({ qrDataUrl, eventCount: events.length, payload: b64Payload });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/status
router.get('/status', (req, res) => {
  res.json({ serverClock: getLocalClock(), timestamp: new Date().toISOString() });
});

// POST /api/sync/receipt/scan
router.post('/receipt/scan', async (req, res, next) => {
  const { filename = 'receipt.jpg' } = req.body;
  try {
    const result = await scanReceipt(filename);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

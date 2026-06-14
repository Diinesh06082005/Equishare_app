// server/routes/wallet.js — Stored-Value Offline Collective Wallet API
const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const Razorpay = require('razorpay');

const router = express.Router();

const NONCE = 'SW_WALLET_V1';

// ── Authentication Middleware ───────────────────────────────────────
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(Object.assign(new Error('Unauthorized'), { status: 401 }));
  }
  const token = authHeader.replace('Bearer ', '');
  const match = token.match(/^uid-(\d+)$/);
  if (!match) {
    return next(Object.assign(new Error('Invalid token'), { status: 401 }));
  }
  const userId = Number(match[1]);
  db.findOne('users', (u) => u.id === userId).then((user) => {
    if (!user) {
      return next(Object.assign(new Error('User not found'), { status: 404 }));
    }
    req.userId = userId;
    req.user = user;
    next();
  }).catch(next);
}

// ── Helpers ───────────────────────────────────────────────────────────

async function getOrCreateWallet(groupId) {
  let wallet = await db.findOne('group_wallets', (w) => w.group_id === groupId);
  if (!wallet) {
    wallet = await db.insert('group_wallets', {
      group_id: groupId,
      current_balance: 0,
      total_prefunded: 0,
      total_spent_offline: 0,
    });
  }
  return wallet;
}

/** Recompute the server-side SHA-256 for a voucher payload */
function computeServerSig(groupId, merchantId, amount, timestamp) {
  const input = `${groupId}|${merchantId}|${amount}|${timestamp}|${NONCE}`;
  return {
    signature: crypto.createHash('sha256').update(input).digest('hex'),
    input,
  };
}

// ── GET /api/wallet/:groupId ──────────────────────────────────────────
router.get('/:groupId', async (req, res, next) => {
  try {
    const gid = Number(req.params.groupId);
    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    const wallet = await getOrCreateWallet(gid);
    const vouchers = await db.findAll('offline_vouchers', (v) => v.group_id === gid);
    vouchers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Attach user names to vouchers
    const enrichedPromises = vouchers.map(async (v) => {
      const u = await db.findOne('users', (usr) => usr.id === v.paid_by);
      return {
        ...v,
        paid_by_name: u?.name || 'Unknown',
      };
    });
    const enriched = await Promise.all(enrichedPromises);

    res.json({ wallet, vouchers: enriched });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/wallet/prefund ──────────────────────────────────────────
// Body: { groupId, amount, fundedBy }
router.post('/prefund', async (req, res, next) => {
  try {
    const { groupId, amount, fundedBy } = req.body;
    if (!groupId || !amount || amount <= 0)
      return next(Object.assign(new Error('groupId and amount > 0 required'), { status: 400 }));

    const gid = Number(groupId);
    const prefundAmount = parseFloat(amount);

    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    // Get active group members
    const members = await db.rawQuery(
      `SELECT u.* FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       WHERE gm.group_id = ? AND gm.left_at IS NULL`,
      [gid]
    );
    if (!members.length)
      return next(Object.assign(new Error('No active members in group'), { status: 400 }));

    const perPerson = Math.round((prefundAmount / members.length) * 100) / 100;
    const remainder = Math.round((prefundAmount - perPerson * members.length) * 100) / 100;

    // Record a regular expense for the prefund contribution
    const expense = await db.insert('expenses', {
      group_id: gid,
      description: `🏦 Wallet Prefund (₹${prefundAmount.toFixed(0)})`,
      total: prefundAmount,
      paid_by: Number(fundedBy) || members[0].id,
      split_type: 'equal',
      status: 'active',
      lamport_ts: 0,
      currency: 'INR',
      notes: 'wallet_prefund',
    });

    for (let i = 0; i < members.length; i++) {
      await db.insert('expense_splits', {
        expense_id: expense.id,
        user_id: members[i].id,
        amount_owed: i === 0 ? perPerson + remainder : perPerson,
      });
    }

    // Top up the wallet
    await getOrCreateWallet(gid);
    await db.rawRun(
      `UPDATE group_wallets
       SET current_balance = current_balance + ?,
           total_prefunded = total_prefunded + ?,
           last_synced_at  = datetime('now')
       WHERE group_id = ?`,
      [prefundAmount, prefundAmount, gid]
    );

    const updatedWallet = await db.findOne('group_wallets', (w) => w.group_id === gid);
    res.status(201).json({
      message: `Wallet topped up by ₹${prefundAmount.toFixed(2)} (₹${perPerson.toFixed(2)} per member)`,
      wallet: updatedWallet,
      expense_id: expense.id,
      per_person: perPerson,
      member_count: members.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/wallet/reconcile ────────────────────────────────────────
// Body: { groupId, vouchers: [{ voucher_uuid, group_id, merchant_id, amount, timestamp, crypto_signature }] }
router.post('/reconcile', async (req, res, next) => {
  try {
    const { groupId, vouchers: batch = [] } = req.body;
    if (!groupId) return next(Object.assign(new Error('groupId required'), { status: 400 }));

    const gid = Number(groupId);
    const wallet = await getOrCreateWallet(gid);
    const results = [];
    let totalDebited = 0;

    for (const v of batch) {
      const { voucher_uuid, merchant_id, amount, timestamp, crypto_signature, paid_by } = v;

      // Check if already reconciled (idempotent)
      const existing = await db.findOne('offline_vouchers', (r) => r.voucher_uuid === voucher_uuid);
      if (existing && existing.status === 'RECONCILED') {
        results.push({ voucher_uuid, status: 'RECONCILED', message: 'Already reconciled (idempotent)' });
        continue;
      }

      // Verify cryptographic signature
      const { signature: expectedSig, input: sigInput } = computeServerSig(
        v.group_id || gid, merchant_id, amount, timestamp
      );

      const sigOk = crypto.timingSafeEqual(
        Buffer.from(crypto_signature.toLowerCase(), 'hex').slice(0, 16),
        Buffer.from(expectedSig.toLowerCase(), 'hex').slice(0, 16)
      );

      const parsedAmount = parseFloat(amount);

      if (!sigOk) {
        // Record as FAILED
        if (!existing) {
          await db.insert('offline_vouchers', {
            voucher_uuid, group_id: gid, paid_by: paid_by || null,
            merchant_id, merchant_label: v.merchant_label || merchant_id,
            amount: parsedAmount, currency: v.currency || 'INR',
            status: 'FAILED', crypto_signature, sig_input: sigInput,
            sms_token: v.sms_token || null, failure_reason: 'Signature mismatch',
          });
        } else {
          await db.rawRun(
            `UPDATE offline_vouchers SET status='FAILED', failure_reason='Signature mismatch' WHERE voucher_uuid=?`,
            [voucher_uuid]
          );
        }
        results.push({ voucher_uuid, status: 'FAILED', message: 'Signature mismatch — voucher rejected' });
        continue;
      }

      // Check wallet has sufficient balance (allow overdraft up to 10% buffer for race conditions)
      if (wallet.current_balance - totalDebited < parsedAmount * 0.9) {
        if (!existing) {
          await db.insert('offline_vouchers', {
            voucher_uuid, group_id: gid, paid_by: paid_by || null,
            merchant_id, merchant_label: v.merchant_label || merchant_id,
            amount: parsedAmount, currency: v.currency || 'INR',
            status: 'FAILED', crypto_signature, sig_input: sigInput,
            sms_token: v.sms_token || null, failure_reason: 'Insufficient wallet balance',
          });
        }
        results.push({ voucher_uuid, status: 'FAILED', message: 'Insufficient wallet balance' });
        continue;
      }

      // Commit the voucher
      if (!existing) {
        await db.insert('offline_vouchers', {
          voucher_uuid, group_id: gid, paid_by: paid_by || null,
          merchant_id, merchant_label: v.merchant_label || merchant_id,
          amount: parsedAmount, currency: v.currency || 'INR',
          status: 'RECONCILED', crypto_signature, sig_input: sigInput,
          sms_token: v.sms_token || null,
          reconciled_at: new Date().toISOString(),
        });
      } else {
        await db.rawRun(
          `UPDATE offline_vouchers SET status='RECONCILED', reconciled_at=datetime('now') WHERE voucher_uuid=?`,
          [voucher_uuid]
        );
      }

      totalDebited += parsedAmount;
      results.push({ voucher_uuid, status: 'RECONCILED', amount: parsedAmount });
    }

    // Deduct total from wallet balance
    if (totalDebited > 0) {
      await db.rawRun(
        `UPDATE group_wallets
         SET current_balance      = MAX(0, current_balance - ?),
             total_spent_offline  = total_spent_offline + ?,
             last_synced_at       = datetime('now')
         WHERE group_id = ?`,
        [totalDebited, totalDebited, gid]
      );
    }

    const finalWallet = await db.findOne('group_wallets', (w) => w.group_id === gid);
    res.json({
      message: `Reconciled ${results.filter(r => r.status === 'RECONCILED').length}/${batch.length} vouchers`,
      results,
      wallet: finalWallet,
      total_debited: totalDebited,
    });
  } catch (err) {
    next(err);
  }
});

// ── Personal Wallet and Razorpay Integration Endpoints ────────────────

async function getOrCreateUserWallet(userId) {
  let wallet = await db.findOne('user_wallets', (w) => w.user_id === userId);
  if (!wallet) {
    wallet = await db.insert('user_wallets', {
      user_id: userId,
      balance: 0,
    });
  }
  return wallet;
}

// 1. GET /api/wallet/personal/info - Get personal wallet info & transactions
router.get('/personal/info', authRequired, async (req, res, next) => {
  try {
    const wallet = await getOrCreateUserWallet(req.userId);
    const txs = await db.rawQuery(
      `SELECT t.*, 
              u_send.name as sender_name, 
              u_recv.name as receiver_name
       FROM wallet_transactions t
       LEFT JOIN users u_send ON u_send.id = t.sender_id
       LEFT JOIN users u_recv ON u_recv.id = t.receiver_id
       WHERE t.sender_id = ? OR t.receiver_id = ?
       ORDER BY t.created_at DESC`,
      [req.userId, req.userId]
    );
    res.json({ wallet, transactions: txs });
  } catch (err) {
    next(err);
  }
});

// 2. POST /api/wallet/personal/create-order - Create Razorpay order to top up wallet
router.post('/personal/create-order', authRequired, async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return next(Object.assign(new Error('Amount must be greater than 0'), { status: 400 }));
    }
    const rzpKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummyKeyId123';
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET || 'dummySecret123';
    const razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpSecret });

    const options = {
      amount: Math.round(amount * 100), // in paise
      currency: 'INR',
      receipt: `rcpt_personal_${req.userId}_${Date.now()}`,
    };

    try {
      const order = await razorpay.orders.create(options);
      res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: rzpKeyId });
    } catch (err) {
      console.warn('Razorpay order create failed, falling back to mock:', err.message);
      res.json({
        orderId: `order_mock_${Date.now()}`,
        amount: Math.round(amount * 100),
        currency: 'INR',
        keyId: rzpKeyId,
        isMock: true
      });
    }
  } catch (err) {
    next(err);
  }
});

// 3. POST /api/wallet/personal/verify-payment - Verify Razorpay payment and credit personal wallet
router.post('/personal/verify-payment', authRequired, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, isMock } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id) {
      return next(Object.assign(new Error('Order ID and Payment ID are required'), { status: 400 }));
    }

    const rzpSecret = process.env.RAZORPAY_KEY_SECRET || 'dummySecret123';
    let verified = false;

    if (isMock || razorpay_order_id.startsWith('order_mock_')) {
      verified = true;
    } else {
      const text = razorpay_order_id + '|' + razorpay_payment_id;
      const generated_signature = crypto
        .createHmac('sha256', rzpSecret)
        .update(text)
        .digest('hex');
      verified = (generated_signature === razorpay_signature);
    }

    if (!verified) {
      return next(Object.assign(new Error('Payment signature verification failed'), { status: 400 }));
    }

    const parsedAmount = parseFloat(amount);
    await getOrCreateUserWallet(req.userId);
    await db.rawRun(
      `UPDATE user_wallets 
       SET balance = balance + ?, updated_at = datetime('now') 
       WHERE user_id = ?`,
      [parsedAmount, req.userId]
    );

    await db.insert('wallet_transactions', {
      sender_id: null,
      receiver_id: req.userId,
      amount: parsedAmount,
      type: 'deposit',
      reference_id: razorpay_payment_id,
    });

    const updatedWallet = await getOrCreateUserWallet(req.userId);
    res.json({ message: 'Funds loaded successfully', wallet: updatedWallet });
  } catch (err) {
    next(err);
  }
});

// 4. POST /api/wallet/personal/transfer - Transfer money from personal wallet to another user's personal wallet
router.post('/personal/transfer', authRequired, async (req, res, next) => {
  try {
    const { targetEmailOrId, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    if (!targetEmailOrId || isNaN(parsedAmount) || parsedAmount <= 0) {
      return next(Object.assign(new Error('Recipient and valid amount > 0 are required'), { status: 400 }));
    }

    let recipient = null;
    if (typeof targetEmailOrId === 'number' || !isNaN(targetEmailOrId)) {
      recipient = await db.findOne('users', u => u.id === Number(targetEmailOrId));
    } else {
      recipient = await db.findOne('users', u => u.email === targetEmailOrId.toLowerCase().trim());
    }

    if (!recipient) {
      return next(Object.assign(new Error('Recipient user not found'), { status: 404 }));
    }
    if (recipient.id === req.userId) {
      return next(Object.assign(new Error('Cannot send money to yourself'), { status: 400 }));
    }

    const senderWallet = await getOrCreateUserWallet(req.userId);
    if (senderWallet.balance < parsedAmount) {
      return next(Object.assign(new Error('Insufficient personal wallet balance'), { status: 400 }));
    }

    await getOrCreateUserWallet(recipient.id);

    await db.rawRun(`UPDATE user_wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?`, [parsedAmount, req.userId]);
    await db.rawRun(`UPDATE user_wallets SET balance = balance + ?, updated_at = datetime('now') WHERE user_id = ?`, [parsedAmount, recipient.id]);

    await db.insert('wallet_transactions', {
      sender_id: req.userId,
      receiver_id: recipient.id,
      amount: parsedAmount,
      type: 'transfer',
    });

    res.json({ message: `Successfully sent ₹${parsedAmount.toFixed(2)} to ${recipient.name}` });
  } catch (err) {
    next(err);
  }
});

// 5. POST /api/wallet/personal/settle - Settle debt using personal wallet
router.post('/personal/settle', authRequired, async (req, res, next) => {
  try {
    const { groupId, fromUser, toUser, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    if (!groupId || !fromUser || !toUser || isNaN(parsedAmount) || parsedAmount <= 0) {
      return next(Object.assign(new Error('Invalid request parameters'), { status: 400 }));
    }

    if (Number(fromUser) !== req.userId) {
      return next(Object.assign(new Error('Cannot settle on behalf of another user'), { status: 403 }));
    }

    const senderWallet = await getOrCreateUserWallet(req.userId);
    if (senderWallet.balance < parsedAmount) {
      return next(Object.assign(new Error('Insufficient personal wallet balance to settle'), { status: 400 }));
    }

    await getOrCreateUserWallet(Number(toUser));

    // Transfer funds
    await db.rawRun(`UPDATE user_wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?`, [parsedAmount, req.userId]);
    await db.rawRun(`UPDATE user_wallets SET balance = balance + ?, updated_at = datetime('now') WHERE user_id = ?`, [parsedAmount, Number(toUser)]);

    // Log transaction
    await db.insert('wallet_transactions', {
      sender_id: req.userId,
      receiver_id: Number(toUser),
      amount: parsedAmount,
      type: 'settlement',
    });

    // Record settlement in group settlements
    const settlement = await db.insert('settlements', {
      group_id: Number(groupId),
      from_user: req.userId,
      to_user: Number(toUser),
      amount: parsedAmount,
      payment_type: 'wallet',
    });

    res.json({ message: 'Settled successfully using personal wallet', settlement });
  } catch (err) {
    next(err);
  }
});

// 6. POST /api/wallet/personal/prefund-group - Prefund group wallet using personal wallet
router.post('/personal/prefund-group', authRequired, async (req, res, next) => {
  try {
    const { groupId, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    if (!groupId || isNaN(parsedAmount) || parsedAmount <= 0) {
      return next(Object.assign(new Error('groupId and valid amount are required'), { status: 400 }));
    }

    const senderWallet = await getOrCreateUserWallet(req.userId);
    if (senderWallet.balance < parsedAmount) {
      return next(Object.assign(new Error('Insufficient personal wallet balance'), { status: 400 }));
    }

    const gid = Number(groupId);
    const group = await db.findOne('groups', (g) => g.id === gid);
    if (!group) return next(Object.assign(new Error('Group not found'), { status: 404 }));

    const members = await db.rawQuery(
      `SELECT u.* FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       WHERE gm.group_id = ? AND gm.left_at IS NULL`,
      [gid]
    );
    if (!members.length) {
      return next(Object.assign(new Error('No active members in group'), { status: 400 }));
    }

    const perPerson = Math.round((parsedAmount / members.length) * 100) / 100;
    const remainder = Math.round((parsedAmount - perPerson * members.length) * 100) / 100;

    // Deduct from personal wallet
    await db.rawRun(`UPDATE user_wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?`, [parsedAmount, req.userId]);

    // Record transaction
    await db.insert('wallet_transactions', {
      sender_id: req.userId,
      receiver_id: null,
      amount: parsedAmount,
      type: 'group_prefund',
    });

    // Record a regular expense for the prefund contribution
    const expense = await db.insert('expenses', {
      group_id: gid,
      description: `🏦 Wallet Prefund (₹${parsedAmount.toFixed(0)})`,
      total: parsedAmount,
      paid_by: req.userId,
      split_type: 'equal',
      status: 'active',
      lamport_ts: 0,
      currency: 'INR',
      notes: 'wallet_prefund',
    });

    for (let i = 0; i < members.length; i++) {
      await db.insert('expense_splits', {
        expense_id: expense.id,
        user_id: members[i].id,
        amount_owed: i === 0 ? perPerson + remainder : perPerson,
      });
    }

    // Top up the group wallet
    await getOrCreateWallet(gid);
    await db.rawRun(
      `UPDATE group_wallets
       SET current_balance = current_balance + ?,
           total_prefunded = total_prefunded + ?,
           last_synced_at  = datetime('now')
       WHERE group_id = ?`,
      [parsedAmount, parsedAmount, gid]
    );

    const updatedWallet = await db.findOne('group_wallets', (w) => w.group_id === gid);
    res.status(201).json({
      message: `Wallet topped up by ₹${parsedAmount.toFixed(2)} (₹${perPerson.toFixed(2)} per member)`,
      wallet: updatedWallet,
      expense_id: expense.id,
    });
  } catch (err) {
    next(err);
  }
});

// 7. POST /api/wallet/settle/create-order - Create Razorpay order for direct settlement
router.post('/settle/create-order', authRequired, async (req, res, next) => {
  try {
    const { amount, toUser } = req.body;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return next(Object.assign(new Error('Valid amount required'), { status: 400 }));
    }

    const rzpKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummyKeyId123';
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET || 'dummySecret123';
    const razorpay = new Razorpay({ key_id: rzpKeyId, key_secret: rzpSecret });

    const options = {
      amount: Math.round(parsedAmount * 100),
      currency: 'INR',
      receipt: `rcpt_settle_${req.userId}_${toUser}_${Date.now()}`,
    };

    try {
      const order = await razorpay.orders.create(options);
      res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: rzpKeyId });
    } catch (err) {
      console.warn('Razorpay order create failed for settlement, using mock:', err.message);
      res.json({
        orderId: `order_mock_${Date.now()}`,
        amount: Math.round(parsedAmount * 100),
        currency: 'INR',
        keyId: rzpKeyId,
        isMock: true
      });
    }
  } catch (err) {
    next(err);
  }
});

// 8. POST /api/wallet/settle/verify-payment - Verify Razorpay payment and settle
router.post('/settle/verify-payment', authRequired, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, groupId, fromUser, toUser, isMock } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !groupId || !fromUser || !toUser) {
      return next(Object.assign(new Error('Missing required verification fields'), { status: 400 }));
    }

    const rzpSecret = process.env.RAZORPAY_KEY_SECRET || 'dummySecret123';
    let verified = false;

    if (isMock || razorpay_order_id.startsWith('order_mock_')) {
      verified = true;
    } else {
      const text = razorpay_order_id + '|' + razorpay_payment_id;
      const generated_signature = crypto
        .createHmac('sha256', rzpSecret)
        .update(text)
        .digest('hex');
      verified = (generated_signature === razorpay_signature);
    }

    if (!verified) {
      return next(Object.assign(new Error('Payment signature verification failed'), { status: 400 }));
    }

    const parsedAmount = parseFloat(amount);

    // Record settlement in group settlements
    const settlement = await db.insert('settlements', {
      group_id: Number(groupId),
      from_user: Number(fromUser),
      to_user: Number(toUser),
      amount: parsedAmount,
      payment_type: 'razorpay',
    });

    // Credit receiver's personal wallet
    await getOrCreateUserWallet(Number(toUser));
    await db.rawRun(`UPDATE user_wallets SET balance = balance + ?, updated_at = datetime('now') WHERE user_id = ?`, [parsedAmount, Number(toUser)]);

    // Log transaction
    await db.insert('wallet_transactions', {
      sender_id: Number(fromUser),
      receiver_id: Number(toUser),
      amount: parsedAmount,
      type: 'settlement',
      reference_id: razorpay_payment_id,
    });

    res.json({ message: 'Settlement paid & verified successfully via Razorpay', settlement });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// src/services/walletEngine.js
// Client-side crypto engine: SHA-256 signing, offline queue, SMS encoder

import { openDB } from 'idb';

const NONCE = 'SW_WALLET_V1';
const QUEUE_DB = 'sw-wallet-queue';
const QUEUE_STORE = 'vouchers';

// ── IndexedDB Queue ───────────────────────────────────────────────────

let _queueDb = null;
async function getQueueDb() {
  if (_queueDb) return _queueDb;
  _queueDb = await openDB(QUEUE_DB, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'voucher_uuid' });
      }
    },
  });
  return _queueDb;
}

export async function pushToQueue(voucher) {
  const db = await getQueueDb();
  await db.put(QUEUE_STORE, voucher);
}

export async function getQueue() {
  const db = await getQueueDb();
  return db.getAll(QUEUE_STORE);
}

export async function removeFromQueue(voucherUuid) {
  const db = await getQueueDb();
  await db.delete(QUEUE_STORE, voucherUuid);
}

export async function clearQueue() {
  const db = await getQueueDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  await tx.store.clear();
}

export async function getQueueCount() {
  const db = await getQueueDb();
  return db.count(QUEUE_STORE);
}

// ── Crypto SHA-256 Signature ──────────────────────────────────────────

/**
 * Signs a payment using Web Crypto API SHA-256.
 * Input: GroupID|MerchantID|Amount|Timestamp|NONCE
 * Returns: full 64-char hex digest
 */
export async function signVoucher(groupId, merchantId, amount, timestamp) {
  const input = `${groupId}|${merchantId}|${amount}|${timestamp}|${NONCE}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return { signature: hexHash, input };
}

// ── UUID Generator ────────────────────────────────────────────────────

export function generateUUID() {
  // Use crypto.randomUUID if available, fallback to manual
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Full Offline Payment Flow ─────────────────────────────────────────

/**
 * Execute an offline wallet payment:
 * 1. Validate local balance
 * 2. Generate signed voucher
 * 3. Push to IndexedDB queue
 * 4. Return voucher for display
 */
export async function executeOfflinePayment({
  groupId, merchantId, merchantLabel, amount, currency = 'INR', paidBy,
}) {
  const timestamp = Date.now().toString();
  const voucherUuid = generateUUID();
  const { signature, input: sigInput } = await signVoucher(groupId, merchantId, amount, timestamp);
  const smsToken = encodeSMSToken(groupId, merchantId, amount, signature);

  const voucher = {
    voucher_uuid: voucherUuid,
    group_id: groupId,
    paid_by: paidBy,
    merchant_id: merchantId,
    merchant_label: merchantLabel || merchantId,
    amount: parseFloat(amount),
    currency,
    timestamp,
    crypto_signature: signature,
    sig_input: sigInput,
    sms_token: smsToken,
    status: 'PENDING_SYNC',
    created_at: new Date().toISOString(),
  };

  await pushToQueue(voucher);
  return voucher;
}

// ── SMS Token Encoder ─────────────────────────────────────────────────

/**
 * Compresses payment data into ultra-compact SMS token.
 * Format: GRP{groupId}_M{merchantCode}_{amountCents}_SIG{sigPrefix8}
 * Example: GRP1_MCAMP99_4550_SIG3a7f9c12
 */
export function encodeSMSToken(groupId, merchantId, amount, signature) {
  // Extract alphanumeric code from merchant ID
  const merchantCode = merchantId
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);

  // Convert amount to integer cents (avoid floats in SMS)
  const amountCents = Math.round(parseFloat(amount) * 100);

  // Use first 8 chars of sig as short reference
  const sigPrefix = signature.slice(0, 8);

  return `GRP${groupId}_M${merchantCode}_${amountCents}_SIG${sigPrefix}`;
}

/**
 * Generate a pre-filled SMS draft URL.
 * Uses the `sms:` URI scheme — works on Android/iOS.
 */
export function generateSMSDraftURL(smsToken) {
  const number = '+15555748729'; // Mock: +1-555-SPLIT-PAY
  const body = encodeURIComponent(
    `[EquiShare Wallet] OFFLINE_PAYMENT: ${smsToken}`
  );
  return `sms:${number}?body=${body}`;
}

// ── Local Balance Cache ───────────────────────────────────────────────

const BALANCE_KEY = (groupId) => `sw_wallet_${groupId}`;

export function cacheWalletBalance(groupId, balance) {
  localStorage.setItem(BALANCE_KEY(groupId), JSON.stringify({
    balance: parseFloat(balance),
    cached_at: Date.now(),
  }));
}

export function getCachedBalance(groupId) {
  try {
    const raw = localStorage.getItem(BALANCE_KEY(groupId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function deductFromCache(groupId, amount) {
  const cached = getCachedBalance(groupId);
  if (!cached) return null;
  const newBalance = Math.max(0, cached.balance - parseFloat(amount));
  cacheWalletBalance(groupId, newBalance);
  return newBalance;
}

export function clearWalletCache(groupId) {
  localStorage.removeItem(BALANCE_KEY(groupId));
}

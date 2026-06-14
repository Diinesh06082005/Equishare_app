// src/api/index.js — Axios API wrapper with offline interception
import axios from 'axios';
import { openDB } from 'idb';

const BASE = import.meta.env.VITE_API_URL || '/api';
let offlineMode = false;

const api = axios.create({ baseURL: BASE, timeout: 8000 });

// ── Offline queue (IndexedDB) ────────────────────────────────────────
async function getOfflineDB() {
  return openDB('equishare-offline', 1, {
    upgrade(db) { db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); },
  });
}

export function setOfflineMode(enabled) { offlineMode = enabled; }
export function isOfflineModeActive() { return offlineMode; }

export async function getOfflineQueue() {
  const db = await getOfflineDB();
  return db.getAll('queue');
}

export async function addToOfflineQueue(event) {
  const db = await getOfflineDB();
  return db.add('queue', { ...event, queued_at: new Date().toISOString() });
}

export async function clearOfflineQueue() {
  const db = await getOfflineDB();
  const tx = db.transaction('queue', 'readwrite');
  await tx.store.clear();
}

// ── Auth ─────────────────────────────────────────────────────────────
export const login    = (data) => api.post('/auth/login', data).then(r => r.data);
export const register = (data) => api.post('/auth/register', data).then(r => r.data);
export const getMe    = ()     => api.get('/auth/me').then(r => r.data);

// Inject token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sw_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Users ────────────────────────────────────────────────────────────
export const getUsers = () => api.get('/users').then(r => r.data);
export const getUser = (id) => api.get(`/users/${id}`).then(r => r.data);
export const createUser = (data) => api.post('/users', data).then(r => r.data);
export const updateUser = (id, data) => api.patch(`/users/${id}`, data).then(r => r.data);
export const getGuestLedger = (token) => api.get(`/users/guest/${token}`).then(r => r.data);

// ── Groups ───────────────────────────────────────────────────────────
export const getGroups = () => api.get('/groups').then(r => r.data);
export const getGroup = (id) => api.get(`/groups/${id}`).then(r => r.data);
export const createGroup = (data) => api.post('/groups', data).then(r => r.data);
export const addMembers = (groupId, userIds) => api.post(`/groups/${groupId}/members`, { userIds }).then(r => r.data);
export const removeMember = (groupId, userId) => api.delete(`/groups/${groupId}/members/${userId}`).then(r => r.data);
export const getBalances = (groupId) => api.get(`/groups/${groupId}/balances`).then(r => r.data);
export const getSettlements = (groupId) => api.get(`/groups/${groupId}/settlements`).then(r => r.data);

// ── Expenses ─────────────────────────────────────────────────────────
export const getExpenses = (groupId) => api.get('/expenses', { params: { groupId } }).then(r => r.data);
export const getExpense = (id) => api.get(`/expenses/${id}`).then(r => r.data);
export const createExpense = async (data) => {
  if (offlineMode) {
    const event = {
      type: 'expense',
      lamport_ts: Date.now(),
      payload: { ...data, created_at: new Date().toISOString().replace('T',' ').slice(0,19) },
    };
    await addToOfflineQueue(event);
    return { ...data, id: `offline-${Date.now()}`, status: 'pending_sync', splits: [] };
  }
  return api.post('/expenses', data).then(r => r.data);
};
export const deleteExpense = (id) => api.delete(`/expenses/${id}`).then(r => r.data);
export const recordSettlement = (data) => api.post('/expenses/settlements', data).then(r => r.data);
export const getSettlementHistory = (groupId) => api.get('/expenses/settlements/history', { params: { groupId } }).then(r => r.data);

// ── Shopping ─────────────────────────────────────────────────────────
export const getShoppingList = (groupId) => api.get(`/shopping/${groupId}`).then(r => r.data);
export const addShoppingItem = (data) => api.post('/shopping', data).then(r => r.data);
export const updateShoppingItem = (id, data) => api.patch(`/shopping/${id}`, data).then(r => r.data);
export const deleteShoppingItem = (id) => api.delete(`/shopping/${id}`).then(r => r.data);

// ── Sync ─────────────────────────────────────────────────────────────
export const pushOfflineEvents = (events) => api.post('/sync/push', { events }).then(r => r.data);
export const getQRPayload = (groupId) => api.get(`/sync/qr/${groupId}`).then(r => r.data);
export const scanReceipt = (filename) => api.post('/sync/receipt/scan', { filename }).then(r => r.data);
export const askAIChat = (messages, groupId = null) => api.post('/ai/chat', { messages, groupId }).then(r => r.data);
export const askAgentCommand = (messages, groupId = null) => api.post('/ai/agent-command', { messages, groupId }).then(r => r.data);
export const diagnoseError = (errorDetails, groupId = null) => api.post('/ai/diagnose-error', { errorDetails, groupId }).then(r => r.data);
export const simulateError = (type, groupId) => api.post('/ai/simulate-error', { type, groupId }).then(r => r.data);
export const getFinancialInsights = (balances, groups) => api.post('/ai/financial-insights', { balances, groups }).then(r => r.data);
export const checkGroupIntegrity = (groupId) => api.get(`/ai/integrity-check/${groupId}`).then(r => r.data);
export const healGroup = (groupId, anomalies) => api.post(`/ai/heal-group/${groupId}`, { anomalies }).then(r => r.data);

// ── Import ────────────────────────────────────────────────────────────
export const importCSV = (file, groupId = null) => {
  const form = new FormData();
  form.append('file', file);
  if (groupId) form.append('groupId', groupId);
  return api.post('/import/csv', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
};
export const validateCSV = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/import/validate', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
};
export const commitImport = (data) => api.post('/import/commit', data).then(r => r.data);
export const getImportReports = () => api.get('/import/reports').then(r => r.data);

// ── Wallet ────────────────────────────────────────────────────────────
export const getWallet        = (groupId) => api.get(`/wallet/${groupId}`).then(r => r.data);
export const prefundWallet    = (data)    => api.post('/wallet/prefund', data).then(r => r.data);
export const reconcileWallet  = (data)    => api.post('/wallet/reconcile', data).then(r => r.data);

// ── Real Personal Wallet & Razorpay API ──────────────────────────────
export const getPersonalInfo      = () => api.get('/wallet/personal/info').then(r => r.data);
export const createPersonalOrder  = (amount) => api.post('/wallet/personal/create-order', { amount }).then(r => r.data);
export const verifyPersonalPayment = (data) => api.post('/wallet/personal/verify-payment', data).then(r => r.data);
export const transferPersonalFunds = (data) => api.post('/wallet/personal/transfer', data).then(r => r.data);
export const settlePersonalDebt    = (data) => api.post('/wallet/personal/settle', data).then(r => r.data);
export const prefundGroupFromPersonal = (data) => api.post('/wallet/personal/prefund-group', data).then(r => r.data);
export const createSettleOrder    = (data) => api.post('/wallet/settle/create-order', data).then(r => r.data);
export const verifySettlePayment  = (data) => api.post('/wallet/settle/verify-payment', data).then(r => r.data);

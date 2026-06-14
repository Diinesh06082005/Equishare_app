// src/components/WalletPanel.jsx — Stored-Value Offline Collective Wallet UI
import { useState, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import VoucherModal from './VoucherModal';
import * as api from '../api';

const MOCK_MERCHANTS = [
  { id: 'MERCHANT_99_CAMPGROUND',  label: '🏕️ Campground #99',   preset: 500  },
  { id: 'MERCHANT_22_SHOP',        label: '🛒 Shop #22',          preset: 200  },
  { id: 'MERCHANT_PETROL_STOP',    label: '⛽ Petrol Stop',       preset: 800  },
  { id: 'MERCHANT_DHABA_HIGHWAY',  label: '🍛 Highway Dhaba',     preset: 350  },
  { id: 'MERCHANT_HOTEL_PARVAT',   label: '🏨 Hotel Parvat',      preset: 2400 },
  { id: 'MERCHANT_ENTRANCE_TICKET',label: '🎫 Entry Ticket',      preset: 150  },
];

export default function WalletPanel({ groupId, currentUser }) {
  const {
    wallet, vouchers, localBalance, offlineTravelMode, queueCount,
    loading, reconciling,
    prefund, payOffline, reconcile, toggleTravelMode, loadWallet,
  } = useWallet(groupId, currentUser);

  const [prefundAmount, setPrefundAmount] = useState('');
  const [prefundLoading, setPrefundLoading] = useState(false);
  const [prefundMsg, setPrefundMsg] = useState('');
  const [showPrefund, setShowPrefund] = useState(false);
  const [personalBalance, setPersonalBalance] = useState(0);

  useEffect(() => {
    if (showPrefund) {
      api.getPersonalInfo()
        .then(data => setPersonalBalance(data.wallet?.balance || 0))
        .catch(() => {});
    }
  }, [showPrefund]);

  const [merchantInput, setMerchantInput] = useState('');
  const [merchantLabel, setMerchantLabel] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');

  const [voucher, setVoucher] = useState(null); // active voucher for modal
  const [reconcileMsg, setReconcileMsg] = useState('');

  const displayBalance = localBalance ?? wallet?.current_balance ?? 0;

  // ── Prefund ────────────────────────────────────────────────────────
  async function handlePrefund(e) {
    e.preventDefault();
    if (!prefundAmount || parseFloat(prefundAmount) <= 0) return;
    setPrefundLoading(true);
    setPrefundMsg('');
    try {
      const res = await prefund(parseFloat(prefundAmount));
      setPrefundMsg(`✅ ${res.message}`);
      setPrefundAmount('');
      setTimeout(() => { setPrefundMsg(''); setShowPrefund(false); }, 3000);
    } catch (err) {
      setPrefundMsg(`❌ ${err?.response?.data?.error || err.message}`);
    } finally {
      setPrefundLoading(false);
    }
  }

  async function handlePrefundFromPersonal(e) {
    e.preventDefault();
    if (!prefundAmount || parseFloat(prefundAmount) <= 0) return;
    const amount = parseFloat(prefundAmount);
    if (personalBalance < amount) {
      setPrefundMsg('❌ Insufficient Personal Wallet balance');
      return;
    }
    setPrefundLoading(true);
    setPrefundMsg('');
    try {
      const res = await api.prefundGroupFromPersonal({ groupId: Number(groupId), amount });
      setPrefundMsg(`✅ ${res.message}`);
      setPrefundAmount('');
      setPersonalBalance(prev => prev - amount);
      await loadWallet();
      setTimeout(() => { setPrefundMsg(''); setShowPrefund(false); }, 3000);
    } catch (err) {
      setPrefundMsg(`❌ ${err?.response?.data?.error || err.message}`);
    } finally {
      setPrefundLoading(false);
    }
  }

  // ── Offline Payment ────────────────────────────────────────────────
  function selectMockMerchant(m) {
    setMerchantInput(m.id);
    setMerchantLabel(m.label);
    setPayAmount(m.preset.toString());
    setPayError('');
  }

  async function handleOfflinePay(e) {
    e.preventDefault();
    if (!merchantInput || !payAmount) return;
    setPayError('');
    setPayLoading(true);
    try {
      const v = await payOffline({
        merchantId: merchantInput.trim().toUpperCase().replace(/\s+/g, '_'),
        merchantLabel: merchantLabel || merchantInput,
        amount: parseFloat(payAmount),
        currency: 'INR',
      });
      setVoucher(v);
      setMerchantInput('');
      setMerchantLabel('');
      setPayAmount('');
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPayLoading(false);
    }
  }

  // ── Reconcile ──────────────────────────────────────────────────────
  async function handleReconcile() {
    setReconcileMsg('');
    try {
      const r = await reconcile();
      setReconcileMsg(`✅ Synced ${r.reconciled} voucher(s). ${r.failed ? `⚠ ${r.failed} failed.` : ''} New balance: ₹${r.wallet?.current_balance?.toFixed(2) ?? '—'}`);
      setTimeout(() => setReconcileMsg(''), 5000);
    } catch (err) {
      setReconcileMsg(`❌ Reconcile failed: ${err.message}`);
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="empty-icon spin">⚙️</div>
        <p>Loading wallet…</p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Balance Hero ──────────────────────────────────────────── */}
      <div className="wallet-hero">
        <div className="wallet-hero-top">
          <div>
            <div className="wallet-hero-label">COLLECTIVE WALLET</div>
            <div className="wallet-hero-balance">
              ₹{displayBalance.toFixed(2)}
            </div>
            <div className="wallet-hero-sub">
              {wallet ? (
                <>Prefunded ₹{wallet.total_prefunded?.toFixed(2) || '0.00'} · Spent offline ₹{wallet.total_spent_offline?.toFixed(2) || '0.00'}</>
              ) : (
                'Cached local balance — connect to sync'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            <button
              id="btn-prefund"
              className="btn btn-primary btn-sm"
              onClick={() => setShowPrefund(!showPrefund)}
            >
              ➕ Prefund
            </button>
            {queueCount > 0 && (
              <button
                id="btn-reconcile"
                className="btn btn-secondary btn-sm"
                onClick={handleReconcile}
                disabled={reconciling}
                style={{ position: 'relative' }}
              >
                {reconciling ? '⏳ Syncing…' : `☁️ Sync (${queueCount})`}
              </button>
            )}
          </div>
        </div>

        {/* Prefund form */}
        {showPrefund && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              <input
                id="prefund-amount"
                type="number"
                min="1"
                step="1"
                className="form-input"
                placeholder="Amount to prefund (₹)"
                value={prefundAmount}
                onChange={e => setPrefundAmount(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                id="btn-prefund-submit"
                onClick={handlePrefund}
                className="btn btn-secondary btn-sm"
                disabled={prefundLoading || !prefundAmount || parseFloat(prefundAmount) <= 0}
              >
                {prefundLoading ? '⏳' : '💰 Lock In (Mock)'}
              </button>
              <button
                id="btn-prefund-wallet"
                onClick={handlePrefundFromPersonal}
                className="btn btn-success btn-sm"
                disabled={prefundLoading || !prefundAmount || parseFloat(prefundAmount) <= 0 || personalBalance < parseFloat(prefundAmount)}
              >
                {prefundLoading ? '⏳' : `💳 Pay via Personal Wallet (Bal: ₹${personalBalance.toFixed(2)})`}
              </button>
            </div>
            {prefundMsg && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: prefundMsg.startsWith('✅') ? 'var(--green)' : 'var(--red)' }}>
                {prefundMsg}
              </div>
            )}
          </div>
        )}
      </div>

      {reconcileMsg && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)',
          background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)',
          fontSize: '0.85rem', color: 'var(--green)', marginBottom: '1.5rem',
        }}>
          {reconcileMsg}
        </div>
      )}

      {/* ── Offline Travel Mode Toggle ────────────────────────────── */}
      <div className="travel-mode-bar" id="travel-mode-toggle" onClick={toggleTravelMode}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div className={`travel-mode-icon ${offlineTravelMode ? 'active' : ''}`}>
            {offlineTravelMode ? '✈️' : '📶'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              {offlineTravelMode ? 'Offline Travel Mode: ON' : 'Offline Travel Mode: OFF'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-2)', marginTop: '0.1rem' }}>
              {offlineTravelMode
                ? 'Payments signed & queued locally — will sync when online'
                : 'Click to enter zero-signal zone mode'}
            </div>
          </div>
        </div>
        <div className={`travel-mode-pill ${offlineTravelMode ? 'on' : 'off'}`}>
          {offlineTravelMode ? 'ACTIVE' : 'OFF'}
        </div>
      </div>

      {/* ── Payment Input (shown in travel mode) ─────────────────── */}
      {offlineTravelMode && (
        <div className="card mb-3">
          <div className="section-title" style={{ marginBottom: '0.75rem' }}>⚡ Quick Pay — Offline</div>

          {/* Mock merchant quick-select */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginBottom: '0.5rem' }}>
              Quick-select merchant:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {MOCK_MERCHANTS.map(m => (
                <button
                  key={m.id}
                  className={`btn btn-sm ${merchantInput === m.id ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => selectMockMerchant(m)}
                  id={`merchant-${m.id}`}
                  style={{ fontSize: '0.72rem' }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleOfflinePay}>
            <div className="form-group">
              <label className="form-label" htmlFor="merchant-id-input">Merchant ID</label>
              <input
                id="merchant-id-input"
                className="form-input"
                placeholder="e.g. MERCHANT_99_CAMPGROUND"
                value={merchantInput}
                onChange={e => {
                  setMerchantInput(e.target.value);
                  setMerchantLabel(e.target.value);
                }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="pay-amount-input">Amount (₹)</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input
                  id="pay-amount-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="form-input"
                  placeholder="0.00"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  id="btn-pay-offline"
                  type="submit"
                  className="btn btn-primary"
                  disabled={payLoading || !merchantInput || !payAmount}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {payLoading ? '⏳' : '🔐 Pay Offline'}
                </button>
              </div>
            </div>

            {payError && (
              <div style={{
                marginTop: '0.75rem', padding: '0.75rem',
                background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)',
                borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--red)',
              }}>
                ⚠️ {payError}
              </div>
            )}

            <div style={{
              marginTop: '0.875rem', padding: '0.6rem 0.875rem',
              background: 'var(--bg-700)', borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem', color: 'var(--text-2)',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <span>💰</span>
              <span>Available: <strong style={{ color: 'var(--text-1)' }}>₹{displayBalance.toFixed(2)}</strong>
                {queueCount > 0 && <span style={{ color: 'var(--yellow)', marginLeft: '0.5rem' }}>⏳ {queueCount} pending sync</span>}
              </span>
            </div>
          </form>
        </div>
      )}

      {/* ── Voucher History ───────────────────────────────────────── */}
      <div className="section-title">Transaction History</div>
      {vouchers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🏦</div>
          <p>No offline transactions yet</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
            Prefund the wallet, enter Travel Mode, and tap Pay Offline
          </p>
        </div>
      ) : (
        vouchers.map((v) => (
          <div key={v.id} className="voucher-row">
            <div className="voucher-icon">
              {v.status === 'RECONCILED' ? '✅' : v.status === 'FAILED' ? '❌' : '⏳'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {v.merchant_label || v.merchant_id}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-2)', marginTop: '0.1rem', fontFamily: 'monospace' }}>
                {v.crypto_signature?.slice(0, 12)}… · {v.created_at?.slice(0, 10)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>₹{parseFloat(v.amount).toFixed(2)}</div>
              <div style={{
                fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.04em',
                color: v.status === 'RECONCILED' ? 'var(--green)' : v.status === 'FAILED' ? 'var(--red)' : 'var(--yellow)',
              }}>
                {v.status}
              </div>
            </div>
          </div>
        ))
      )}

      {/* ── Voucher Success Modal ─────────────────────────────────── */}
      {voucher && (
        <VoucherModal
          voucher={voucher}
          onClose={() => setVoucher(null)}
          onSMSFallback={async () => {
            // Reload database and queue state to reflect deleted item
            await loadWallet();
          }}
        />
      )}
    </div>
  );
}

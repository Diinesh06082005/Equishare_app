// src/components/VoucherModal.jsx — Digital Success Voucher screen
import { useState, useEffect, useRef } from 'react';
import { generateSMSDraftURL, removeFromQueue } from '../services/walletEngine';

export default function VoucherModal({ voucher, onClose, onSMSFallback }) {
  const [elapsed, setElapsed] = useState(0);
  const [smsSent, setSmsSent] = useState(false);
  const intervalRef = useRef(null);

  // Live-animating timestamp bar — counts up from voucher creation
  useEffect(() => {
    const created = voucher.created_at ? new Date(voucher.created_at).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - created) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [voucher]);

  function formatElapsed(s) {
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  }

  const sigDisplay = voucher.crypto_signature?.slice(0, 16) || '—';
  const sigFull    = voucher.crypto_signature || '—';

  async function handleSMSFallback() {
    const url = generateSMSDraftURL(voucher.sms_token);
    // Try native sms: scheme first
    window.open(url, '_blank');
    setSmsSent(true);
    try {
      await removeFromQueue(voucher.voucher_uuid);
      if (onSMSFallback) onSMSFallback();
    } catch (err) {
      console.error('Failed to remove voucher from offline queue:', err);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480, padding: 0, overflow: 'hidden' }}>

        {/* ── Green success header ─────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg, #00b09b, #1a9e4c)',
          padding: '2rem',
          textAlign: 'center',
          position: 'relative',
        }}>
          {/* Animated pulse ring */}
          <div style={{
            width: 80, height: 80, margin: '0 auto 1rem',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2.5rem',
            animation: 'voucherPulse 2s ease-in-out infinite',
          }}>✅</div>

          <div style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Payment Recorded
          </div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Offline Wallet Transaction
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div style={{ padding: '1.5rem', background: 'var(--bg-800)' }}>

          {/* Amount + Merchant */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '1rem 1.25rem',
            background: 'var(--bg-700)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            marginBottom: '1rem',
          }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Merchant
              </div>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginTop: '0.15rem' }}>
                {voucher.merchant_label || voucher.merchant_id}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Amount Deducted
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.5rem', color: '#2ecc71', letterSpacing: '-0.03em', marginTop: '0.15rem' }}>
                {voucher.currency === 'USD' ? '$' : '₹'}{parseFloat(voucher.amount).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Crypto reference */}
          <div style={{
            padding: '0.875rem 1rem',
            background: 'rgba(108,99,255,0.06)',
            border: '1px solid rgba(108,99,255,0.2)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1rem',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
              🔐 Cryptographic Reference
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--accent)',
              letterSpacing: '0.04em', wordBreak: 'break-all', lineHeight: 1.6,
            }}>
              {sigFull}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: '0.4rem' }}>
              SHA-256 · {NONCE_LABEL} · {voucher.voucher_uuid?.slice(0, 8)}
            </div>
          </div>

          {/* ── Live timestamp bar ──────────────────────────────────── */}
          <div style={{
            padding: '0.875rem 1rem',
            background: 'var(--bg-700)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            marginBottom: '1rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ⏱ Anti-Screenshot Timer
              </span>
              <span style={{
                fontFamily: 'monospace', fontSize: '0.85rem',
                color: elapsed < 300 ? 'var(--green)' : elapsed < 600 ? 'var(--yellow)' : 'var(--red)',
                fontWeight: 700,
              }}>
                {formatElapsed(elapsed)}
              </span>
            </div>
            {/* Progress bar — fades from green → red over 10 minutes */}
            <div style={{ height: 6, background: 'var(--bg-600)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, (elapsed / 600) * 100)}%`,
                background: elapsed < 300
                  ? 'linear-gradient(90deg, #2ecc71, #27ae60)'
                  : elapsed < 600
                    ? 'linear-gradient(90deg, #f39c12, #e67e22)'
                    : 'linear-gradient(90deg, #e74c3c, #c0392b)',
                borderRadius: 3,
                transition: 'width 1s linear, background 2s ease',
              }} />
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: '0.4rem', textAlign: 'center' }}>
              Voucher valid for merchant presentation · Ref: {voucher.voucher_uuid?.slice(0, 12).toUpperCase()}
            </div>
          </div>

          {/* SMS Token */}
          {voucher.sms_token && (
            <div style={{
              padding: '0.875rem 1rem',
              background: 'rgba(243,156,18,0.06)',
              border: '1px solid rgba(243,156,18,0.2)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.25rem',
            }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                📱 SMS Token (low-bandwidth backup)
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-1)', letterSpacing: '0.05em' }}>
                {voucher.sms_token}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              id="btn-voucher-sms"
              className={`btn ${smsSent ? 'btn-success' : 'btn-secondary'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={handleSMSFallback}
            >
              {smsSent ? '✅ SMS Draft Opened' : '📱 SMS Fallback'}
            </button>
            <button
              id="btn-voucher-close"
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={onClose}
            >
              Done ✓
            </button>
          </div>

          <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--text-3)', marginTop: '1rem' }}>
            Will auto-sync when internet is restored · Queue ID: {voucher.voucher_uuid?.slice(0, 8)}
          </div>
        </div>
      </div>
    </div>
  );
}

const NONCE_LABEL = 'SW_WALLET_V1';

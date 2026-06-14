// src/components/SettleUpModal.jsx — Direct payment integrations (Razorpay, Personal Wallet, UPI, PayPal)
import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

function generateUPI(vpa, amount) {
  return `upi://pay?pa=${encodeURIComponent(vpa)}&am=${amount}&tn=EquiShareSettle&cu=INR`;
}
function generateVenmo(handle, amount) {
  const h = handle?.replace('@', '');
  return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(h)}&amount=${amount}&note=EquiShareSettle`;
}
function generatePayPal(handle, amount) {
  return `https://paypal.me/${handle}/${amount}`;
}

export default function SettleUpModal({ settlement, onClose }) {
  const { activeGroup, refreshGroup, toast, currentUser } = useApp();
  const [recording, setRecording] = useState(false);
  const [payingRazorpay, setPayingRazorpay] = useState(false);
  const [payingWallet, setPayingWallet] = useState(false);
  const [paymentType, setPaymentType] = useState('manual');
  
  const [walletBalance, setWalletBalance] = useState(0);

  const { from, to, amount } = settlement;
  const amt = amount.toFixed(2);

  // Load user's personal wallet balance on mount
  useEffect(() => {
    api.getPersonalInfo()
      .then(data => setWalletBalance(data.wallet?.balance || 0))
      .catch(() => {});
  }, []);

  const paymentLinks = [];
  if (to?.upi_vpa) paymentLinks.push({ type: 'upi', label: 'UPI Pay', icon: '🇮🇳', color: '#ff6b35', url: generateUPI(to.upi_vpa, amt) });
  if (to?.venmo_handle) paymentLinks.push({ type: 'venmo', label: 'Venmo', icon: '💙', color: '#3d95ce', url: generateVenmo(to.venmo_handle, amt) });
  paymentLinks.push({ type: 'paypal', label: 'PayPal.me', icon: '💛', color: '#ffc439', url: generatePayPal(to?.venmo_handle || 'user', amt) });

  async function handleRecord(pType) {
    setRecording(true);
    try {
      await api.recordSettlement({
        groupId: activeGroup.id,
        fromUser: from.id,
        toUser: to.id,
        amount: parseFloat(amount),
        paymentType: pType,
      });
      await refreshGroup();
      toast('✅ Settlement recorded!', 'success');
      onClose();
    } catch { 
      toast('Failed to record', 'error'); 
    } finally { 
      setRecording(false); 
    }
  }

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handlePayRazorpay = async () => {
    setPayingRazorpay(true);
    try {
      const orderData = await api.createSettleOrder({
        amount: parseFloat(amount),
        toUser: to.id
      });

      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'EquiShare Settlement',
        description: `Paying ₹${amt} to ${to.name}`,
        order_id: orderData.orderId,
        handler: async function (response) {
          try {
            await api.verifySettlePayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              amount: parseFloat(amount),
              groupId: activeGroup.id,
              fromUser: from.id,
              toUser: to.id,
              isMock: orderData.isMock
            });
            await refreshGroup();
            toast('✅ Settlement paid & verified via Razorpay!', 'success');
            onClose();
          } catch (verifyErr) {
            toast('❌ Payment verification failed!', 'error');
            setPayingRazorpay(false);
          }
        },
        prefill: {
          name: from.name,
          email: from.email,
        },
        theme: {
          color: '#6c63ff',
        },
        modal: {
          ondismiss: function() {
            setPayingRazorpay(false);
          }
        }
      };

      if (orderData.isMock) {
        toast('🛠️ Test mode: Simulating settlement payment...', 'info');
        setTimeout(async () => {
          try {
            await api.verifySettlePayment({
              razorpay_order_id: orderData.orderId,
              razorpay_payment_id: `pay_settle_mock_${Date.now()}`,
              razorpay_signature: 'mock_sig',
              amount: parseFloat(amount),
              groupId: activeGroup.id,
              fromUser: from.id,
              toUser: to.id,
              isMock: true
            });
            await refreshGroup();
            toast('✅ Settlement paid & verified (Simulated)!', 'success');
            onClose();
          } catch (err) {
            toast('Simulation verification failed', 'error');
            setPayingRazorpay(false);
          }
        }, 1000);
      } else {
        const loaded = await loadRazorpayScript();
        if (!loaded) {
          toast('Razorpay SDK failed to load. Please check your internet connection.', 'error');
          setPayingRazorpay(false);
          return;
        }
        const rzp = new window.Razorpay(options);
        rzp.open();
      }
    } catch (err) {
      toast(err.message || 'Razorpay initialization failed', 'error');
      setPayingRazorpay(false);
    }
  };

  const handlePayWallet = async () => {
    setPayingWallet(true);
    try {
      await api.settlePersonalDebt({
        groupId: activeGroup.id,
        fromUser: from.id,
        toUser: to.id,
        amount: parseFloat(amount)
      });
      await refreshGroup();
      toast('💸 Debt settled using personal wallet balance!', 'success');
      onClose();
    } catch (err) {
      toast(err.response?.data?.error || err.message, 'error');
    } finally {
      setPayingWallet(false);
    }
  };

  const isCurrentUserPayer = currentUser?.id === from.id;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">💳 Settle Up</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ textAlign: 'center', padding: '1rem 0 1.5rem', background: 'var(--bg-700)', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: '0.5rem' }}>Amount to settle</div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent)' }}>₹{amt}</div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginTop: '0.5rem' }}>
            <strong>{from?.name}</strong> → <strong>{to?.name}</strong>
          </div>
        </div>

        <div className="section-title" style={{ marginBottom: '0.75rem' }}>Real Payment Integrations</div>

        {/* Personal Wallet Option */}
        <div className="payment-link-card">
          <div className="payment-logo">💳</div>
          <div className="payment-info">
            <div className="payment-name">Personal Wallet</div>
            <div className="payment-url">Available Balance: ₹{walletBalance.toFixed(2)}</div>
          </div>
          <div>
            {isCurrentUserPayer ? (
              walletBalance >= amount ? (
                <button 
                  className="btn btn-success btn-sm" 
                  onClick={handlePayWallet}
                  disabled={payingWallet}
                >
                  {payingWallet ? '⏳' : 'Use Wallet'}
                </button>
              ) : (
                <span className="badge badge-red" style={{ fontSize: '0.7rem' }}>Low Balance</span>
              )
            ) : (
              <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>Only Payer can pay</span>
            )}
          </div>
        </div>

        {/* Razorpay Checkout Option */}
        <div className="payment-link-card">
          <div className="payment-logo">⚡</div>
          <div className="payment-info">
            <div className="payment-name">Razorpay checkout</div>
            <div className="payment-url">Pay via Cards, UPI, Netbanking</div>
          </div>
          <div>
            {isCurrentUserPayer ? (
              <button 
                className="btn btn-primary btn-sm" 
                onClick={handlePayRazorpay}
                disabled={payingRazorpay}
              >
                {payingRazorpay ? '⏳ Paying...' : 'Pay Instant'}
              </button>
            ) : (
              <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>Only Payer can pay</span>
            )}
          </div>
        </div>

        <div className="section-title" style={{ marginBottom: '0.75rem', marginTop: '1.5rem' }}>Alternate Payment Intent Links</div>

        {paymentLinks.map(link => (
          <div key={link.type} className="payment-link-card">
            <div className="payment-logo">{link.icon}</div>
            <div className="payment-info">
              <div className="payment-name">{link.label}</div>
              <div className="payment-url">{link.url}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <a href={link.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" onClick={() => setPaymentType(link.type)}>
                Open →
              </a>
              <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(link.url); toast('Link copied!', 'success'); }}>
                📋
              </button>
            </div>
          </div>
        ))}

        <hr className="divider" />
        <button className="btn btn-success w-full" onClick={() => handleRecord(paymentType)} disabled={recording}>
          {recording ? '⏳ Recording…' : '✅ Mark as Settled manually'}
        </button>
        <button className="btn btn-secondary w-full" style={{ marginTop: '0.5rem' }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

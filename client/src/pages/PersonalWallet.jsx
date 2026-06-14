// src/pages/PersonalWallet.jsx
import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

export default function PersonalWallet() {
  const { currentUser, users, toast } = useApp();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Forms state
  const [amountToAdd, setAmountToAdd] = useState('');
  const [addingFunds, setAddingFunds] = useState(false);

  const [sendAmount, setSendAmount] = useState('');
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendingFunds, setSendingFunds] = useState(false);

  useEffect(() => {
    loadWalletInfo();
  }, []);

  const loadWalletInfo = async () => {
    try {
      const data = await api.getPersonalInfo();
      setWallet(data.wallet);
      setTransactions(data.transactions);
    } catch (err) {
      toast('Failed to load wallet info', 'error');
    } finally {
      setLoading(false);
    }
  };

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

  const handleAddFunds = async (e) => {
    e.preventDefault();
    const amount = parseFloat(amountToAdd);
    if (isNaN(amount) || amount <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }

    setAddingFunds(true);
    try {
      const orderData = await api.createPersonalOrder(amount);
      
      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'EquiShare Personal Wallet',
        description: `Top-up for ${currentUser.name}`,
        order_id: orderData.orderId,
        handler: async function (response) {
          try {
            await api.verifyPersonalPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              amount: amount,
              isMock: orderData.isMock
            });
            toast('💰 Wallet topped up successfully!', 'success');
            setAmountToAdd('');
            loadWalletInfo();
          } catch (verifyErr) {
            toast('❌ Payment verification failed!', 'error');
          } finally {
            setAddingFunds(false);
          }
        },
        prefill: {
          name: currentUser.name,
          email: currentUser.email,
        },
        theme: {
          color: '#6c63ff',
        },
        modal: {
          ondismiss: function() {
            setAddingFunds(false);
          }
        }
      };

      if (orderData.isMock) {
        // Automatically simulate payment success in mock mode
        toast('🛠️ Test mode: Simulating payment success...', 'info');
        setTimeout(async () => {
          try {
            await api.verifyPersonalPayment({
              razorpay_order_id: orderData.orderId,
              razorpay_payment_id: `pay_mock_${Date.now()}`,
              razorpay_signature: 'mock_sig',
              amount: amount,
              isMock: true
            });
            toast('💰 Wallet topped up successfully (Simulated)!', 'success');
            setAmountToAdd('');
            setAddingFunds(false);
            loadWalletInfo();
          } catch (err) {
            toast('Simulation verification failed', 'error');
            setAddingFunds(false);
          }
        }, 1000);
      } else {
        const loaded = await loadRazorpayScript();
        if (!loaded) {
          toast('Razorpay SDK failed to load. Please check your internet connection.', 'error');
          setAddingFunds(false);
          return;
        }
        const rzp = new window.Razorpay(options);
        rzp.open();
      }
    } catch (err) {
      toast(err.message || 'Failed to initialize payment', 'error');
      setAddingFunds(false);
    }
  };

  const handleSendFunds = async (e) => {
    e.preventDefault();
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }
    if (!sendRecipient) {
      toast('Please select or enter a recipient', 'error');
      return;
    }

    if (wallet && wallet.balance < amount) {
      toast('Insufficient wallet balance', 'error');
      return;
    }

    setSendingFunds(true);
    try {
      const res = await api.transferPersonalFunds({
        targetEmailOrId: sendRecipient,
        amount: amount,
      });
      toast(`✅ ${res.message}`, 'success');
      setSendAmount('');
      setSendRecipient('');
      loadWalletInfo();
    } catch (err) {
      toast(err.response?.data?.error || err.message, 'error');
    } finally {
      setSendingFunds(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="empty-icon spin">⚙️</div>
        <p>Loading personal wallet…</p>
      </div>
    );
  }

  const otherUsers = users.filter(u => u.id !== currentUser.id);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Personal Wallet 💳</h2>
          <p className="page-subtitle">Real-time deposit, transfer, and settlement funds</p>
        </div>
      </div>

      <div className="grid-2 mb-3">
        {/* Wallet Balance Hero Card */}
        <div className="wallet-hero" style={{ margin: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="wallet-hero-label">YOUR PERSONAL BALANCE</div>
            <div className="wallet-hero-balance">
              ₹{wallet?.balance?.toFixed(2) || '0.00'}
            </div>
            <div className="wallet-hero-sub">
              Linked to: {currentUser.email}
            </div>
          </div>
          <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>🛡️</span>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>
              Secured payments processed via Razorpay API checkout.
            </span>
          </div>
        </div>

        {/* Add Funds form */}
        <div className="card">
          <div className="section-title">💰 Top Up Wallet</div>
          <form onSubmit={handleAddFunds}>
            <div className="form-group">
              <label className="form-label" htmlFor="topup-amount">Amount in INR (₹)</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input
                  id="topup-amount"
                  type="number"
                  min="1"
                  step="1"
                  className="form-input"
                  placeholder="Enter amount to add"
                  value={amountToAdd}
                  onChange={(e) => setAmountToAdd(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addingFunds}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {addingFunds ? '⏳ Opening...' : '💳 Pay Now'}
                </button>
              </div>
            </div>
          </form>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.5rem' }}>
            Note: Razorpay Sandbox triggers payment simulation if active environment credentials aren't set.
          </div>
        </div>
      </div>

      <div className="grid-2 mb-3">
        {/* Send Money P2P */}
        <div className="card">
          <div className="section-title">📤 Send Money to Friend</div>
          <form onSubmit={handleSendFunds}>
            <div className="form-group">
              <label className="form-label" htmlFor="recipient-select">Select Group Friend</label>
              <select
                id="recipient-select"
                className="form-select"
                value={sendRecipient}
                onChange={(e) => setSendRecipient(e.target.value)}
              >
                <option value="">-- Choose member --</option>
                {otherUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', flex: 1, textAlign: 'center' }}>
                — OR enter email manually —
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '0.5rem' }}>
              <label className="form-label" htmlFor="recipient-email">Recipient Email Address</label>
              <input
                id="recipient-email"
                type="email"
                className="form-input"
                placeholder="friend@email.com"
                value={typeof sendRecipient === 'string' && !sendRecipient.match(/^\d+$/) ? sendRecipient : ''}
                onChange={(e) => setSendRecipient(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="transfer-amount">Amount (₹)</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input
                  id="transfer-amount"
                  type="number"
                  min="1"
                  step="1"
                  className="form-input"
                  placeholder="0.00"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={sendingFunds || !sendRecipient || !sendAmount}
                >
                  {sendingFunds ? '⏳ Sending...' : '💸 Send Funds'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Transaction History */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="section-title">📜 Wallet Activity Logs</div>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '350px', paddingRight: '0.25rem' }}>
            {transactions.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <div className="empty-icon">📜</div>
                <p style={{ fontSize: '0.85rem' }}>No recent wallet transactions found.</p>
              </div>
            ) : (
              transactions.map((tx) => {
                const isIncoming = tx.receiver_id === currentUser.id && tx.sender_id !== currentUser.id;
                const isPrefund = tx.type === 'group_prefund';
                const isSettlement = tx.type === 'settlement';
                
                let txLabel = '';
                let txBadgeClass = 'badge-gray';
                let txSign = '';
                let txColorClass = 'text-muted';

                if (tx.type === 'deposit') {
                  txLabel = 'Deposit via Razorpay';
                  txBadgeClass = 'badge-green';
                  txSign = '+';
                  txColorClass = 'text-green';
                } else if (tx.type === 'transfer') {
                  if (isIncoming) {
                    txLabel = `Received from ${tx.sender_name || 'Friend'}`;
                    txBadgeClass = 'badge-green';
                    txSign = '+';
                    txColorClass = 'text-green';
                  } else {
                    txLabel = `Sent to ${tx.receiver_name || 'Friend'}`;
                    txBadgeClass = 'badge-red';
                    txSign = '-';
                    txColorClass = 'text-red';
                  }
                } else if (isSettlement) {
                  if (isIncoming) {
                    txLabel = `Settle up from ${tx.sender_name || 'Friend'}`;
                    txBadgeClass = 'badge-green';
                    txSign = '+';
                    txColorClass = 'text-green';
                  } else {
                    txLabel = `Settle up to ${tx.receiver_name || 'Friend'}`;
                    txBadgeClass = 'badge-red';
                    txSign = '-';
                    txColorClass = 'text-red';
                  }
                } else if (isPrefund) {
                  txLabel = 'Prefund to Group Wallet';
                  txBadgeClass = 'badge-purple';
                  txSign = '-';
                  txColorClass = 'text-red';
                }

                return (
                  <div key={tx.id} className="voucher-row" style={{ padding: '0.75rem' }}>
                    <div className="voucher-icon" style={{ fontSize: '1rem', width: '32px', height: '32px' }}>
                      {tx.type === 'deposit' ? '📥' : isIncoming ? '💸' : '📤'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {txLabel}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: '0.1rem' }}>
                        {tx.created_at} {tx.reference_id && `· Ref: ${tx.reference_id.slice(0, 12)}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className={`font-bold ${txColorClass}`} style={{ fontSize: '0.875rem' }}>
                        {txSign}₹{tx.amount.toFixed(2)}
                      </div>
                      <span className={`badge ${txBadgeClass}`} style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>
                        {tx.type}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

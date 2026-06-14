// src/pages/GroupDetail.jsx — Full group view with all tabs
import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';
import AddExpenseModal from '../components/AddExpenseModal';
import SettleUpModal from '../components/SettleUpModal';
import ShoppingPanel from '../components/ShoppingPanel';
import WalletPanel from '../components/WalletPanel';
import { Avatar } from '../components/Sidebar';

const COLORS = ['#6c63ff','#ff6584','#43e97b','#f39c12','#3498db','#9b59b6'];

function getColor(id) { return COLORS[id % COLORS.length]; }

const EXPENSE_ICONS = { 'Hotel': '🏨', 'Lunch': '🍽️', 'Taxi': '🚕', 'Rickshaw': '🛺', 'Shopping': '🛍️', 'Drinks': '🍺', 'Beach': '🏖️' };
function getExpenseIcon(desc) {
  for (const [k, v] of Object.entries(EXPENSE_ICONS)) {
    if (desc.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return '💸';
}

function getInitials(name) { return name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'; }

export default function GroupDetail() {
  const { activeGroup, expenses, balances, settlements, refreshGroup, toast, offline, removeMember, currentUser } = useApp();
  const [tab, setTab] = useState('expenses');
  const [showAdd, setShowAdd] = useState(false);
  const [showSettle, setShowSettle] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [expandedLedgerUserId, setExpandedLedgerUserId] = useState(null);

  const [integrity, setIntegrity] = useState({ healthy: true, anomalies: [] });
  const [healing, setHealing] = useState(false);
  const [healSuccess, setHealSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    async function auditDb() {
      try {
        const res = await api.checkGroupIntegrity(activeGroup.id);
        if (active) {
          setIntegrity(res);
        }
      } catch (err) {
        console.error('Group integrity check error:', err);
      }
    }
    
    if (activeGroup?.id) {
      auditDb();
    }
    return () => { active = false; };
  }, [activeGroup?.id, expenses]);

  async function triggerHeal() {
    setHealing(true);
    try {
      await api.healGroup(activeGroup.id, integrity.anomalies);
      toast('🛠️ AI Self-Healing complete! DB repaired successfully.', 'success');
      setHealSuccess(true);
      setTimeout(async () => {
        await refreshGroup();
        const check = await api.checkGroupIntegrity(activeGroup.id);
        setIntegrity(check);
        setHealSuccess(false);
      }, 1500);
    } catch (err) {
      console.error(err);
      toast('Failed to repair database.', 'error');
    } finally {
      setHealing(false);
    }
  }

  if (!activeGroup) return null;

  async function handleDelete(id) {
    setDeleting(id);
    try {
      await api.deleteExpense(id);
      await refreshGroup();
      toast('Expense removed', 'info');
    } catch { toast('Failed to delete', 'error'); }
    finally { setDeleting(null); }
  }

  const renderLedgerBreakdown = (userId, currency) => {
    const activeExpenses = expenses.filter(e => e.status !== 'deleted');
    const ledgerItems = [];

    for (const exp of activeExpenses) {
      const isPayer = Number(exp.paid_by) === Number(userId);
      const splitObj = exp.splits?.find(s => Number(s.user_id) === Number(userId));
      const amountOwed = splitObj ? splitObj.amount_owed : 0;

      if (isPayer || amountOwed > 0) {
        let paidAmt = isPayer ? exp.total : 0;
        let owedAmt = amountOwed;

        // Multicurrency conversions
        const expCurr = exp.currency || 'INR';
        if (expCurr !== currency) {
          if (expCurr === 'USD' && currency === 'INR') {
            paidAmt *= 83;
            owedAmt *= 83;
          } else if (expCurr === 'INR' && currency === 'USD') {
            paidAmt /= 83;
            owedAmt /= 83;
          }
        }

        const net = paidAmt - owedAmt;

        ledgerItems.push({
          id: exp.id,
          description: exp.description,
          date: exp.created_at?.slice(0, 10) || '',
          paid: paidAmt,
          owed: owedAmt,
          net: net,
          originalCurrency: exp.currency || 'INR',
          originalTotal: exp.total
        });
      }
    }

    if (ledgerItems.length === 0) {
      return (
        <div style={{ padding: '0.75rem', color: 'var(--text-3)', fontSize: '0.75rem', background: 'rgba(255,255,255,0.01)', borderRadius: 'var(--radius-sm)', marginTop: '0.5rem' }}>
          No expenses recorded for this user.
        </div>
      );
    }

    return (
      <div style={{
        marginTop: '0.5rem',
        padding: '0.875rem 1rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--accent)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          📄 Detailed Ledger Breakdown (Rohan's Request)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {ledgerItems.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', borderBottom: '1px dashed rgba(255,255,255,0.05)', paddingBottom: '0.4rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{item.description}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>
                  {item.date} {item.originalCurrency !== currency && `(Original: ${item.originalCurrency === 'USD' ? '$' : '₹'}${item.originalTotal})`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', textAlign: 'right' }}>
                <div style={{ width: '70px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', display: 'block' }}>Paid</span>
                  <span style={{ fontWeight: 500 }}>{currency === 'INR' ? '₹' : '$'}{item.paid.toFixed(2)}</span>
                </div>
                <div style={{ width: '70px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', display: 'block' }}>Share</span>
                  <span style={{ fontWeight: 500 }}>{currency === 'INR' ? '₹' : '$'}{item.owed.toFixed(2)}</span>
                </div>
                <div style={{ width: '70px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', display: 'block' }}>Net</span>
                  <span style={{
                    fontWeight: 700,
                    color: item.net > 0 ? 'var(--green)' : item.net < 0 ? 'var(--red)' : 'var(--text-2)'
                  }}>
                    {item.net > 0 ? '+' : ''}{currency === 'INR' ? '₹' : '$'}{item.net.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const groupCurrency = balances[0]?.currency || 'INR';
  const totalSpend = expenses.reduce((a, e) => {
    let amt = e.total;
    if (e.currency === 'USD' && groupCurrency === 'INR') amt = e.total * 83;
    if (e.currency === 'INR' && groupCurrency === 'USD') amt = e.total / 83;
    return a + amt;
  }, 0);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">{activeGroup.name}</h2>
          <p className="page-subtitle">
            {activeGroup.members?.length || 0} members · {groupCurrency === 'INR' ? '₹' : '$'}{totalSpend.toFixed(2)} total spend
            {offline && <span className="badge badge-red" style={{ marginLeft: '0.5rem' }}>📴 Offline</span>}
          </p>
        </div>
        <div className="flex gap-1">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowSettle('choose')}>💳 Settle Up</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Expense</button>
        </div>
      </div>

      {/* AI Self-Healing Diagnostic Alert */}
      {!integrity.healthy && (
        <div className="card mb-3" style={{ background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)', border: '1px solid rgba(244, 63, 94, 0.3)' }}>
          <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span>⚠️</span> AI Integrity Alert: Database Inconsistencies Detected
              </h4>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>
                We found {integrity.anomalies.length} anomaly/anomalies in this group's transactions (mismatched totals or invalid member links).
              </p>
            </div>
            <button className="btn btn-danger btn-sm" onClick={triggerHeal} disabled={healing || healSuccess}>
              {healing ? '🛠️ Repairing...' : healSuccess ? '✅ Repaired!' : '⚡ Autonomous Repair'}
            </button>
          </div>
        </div>
      )}

      {/* Members strip */}
      <div className="card mb-3" style={{ padding: '1rem 1.25rem' }}>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginRight: '0.5rem' }}>Members:</span>
          {activeGroup.members?.filter(m => !m.left_at).map((m) => (
            <div key={m.id} className="flex items-center gap-1"
              style={{ background: 'var(--bg-700)', borderRadius: 20, padding: '0.2rem 0.6rem 0.2rem 0.35rem', border: '1px solid var(--border)' }}>
              <div className="avatar" style={{ width: 24, height: 24, background: getColor(m.id), fontSize: '0.6rem' }}>
                {getInitials(m.name)}
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>{m.name}</span>
              <button
                id={`remove-member-${m.id}`}
                title={`Remove ${m.name}`}
                onClick={async () => {
                  if (!window.confirm(`Remove ${m.name} from this group?`)) return;
                  try {
                    await removeMember(activeGroup.id, m.id);
                    toast(`${m.name} removed from group`, 'info');
                  } catch { toast('Failed to remove member', 'error'); }
                }}
                style={{ color: 'var(--text-3)', fontSize: '0.7rem', marginLeft: '0.25rem', lineHeight: 1 }}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[
          { id: 'expenses', label: '💸 Expenses' },
          { id: 'balances', label: '⚖️ Balances' },
          { id: 'settle',   label: '✅ Settle Up' },
          { id: 'shopping', label: '🛒 Shopping' },
          { id: 'wallet',   label: '🏦 Wallet' },
        ].map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Expenses Tab */}
      {tab === 'expenses' && (
        <div>
          {expenses.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💸</div>
              <p>No expenses yet. Add the first one!</p>
            </div>
          ) : (
            expenses.map(exp => (
              <div key={exp.id} className="expense-item">
                <div className="expense-icon">{getExpenseIcon(exp.description)}</div>
                <div className="expense-info">
                  <div className="expense-desc">{exp.description}</div>
                  <div className="expense-meta">
                    Paid by <strong>{exp.paid_by_name}</strong> · {exp.split_type} split
                    {exp.status === 'pending_sync' && <span className="badge badge-yellow" style={{ marginLeft: '0.5rem' }}>⏳ Pending</span>}
                  </div>
                </div>
                <div className="expense-amount">
                  <div className="expense-total">{exp.currency === 'INR' ? '₹' : '$'}{exp.total.toFixed(2)}</div>
                  <div className="expense-owed text-muted">{exp.splits?.length || 0} split(s)</div>
                </div>
                <button className="btn btn-danger btn-sm btn-icon"
                  onClick={() => handleDelete(exp.id)}
                  disabled={deleting === exp.id || exp.id?.toString().startsWith('offline')}>
                  {deleting === exp.id ? '⏳' : '🗑️'}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Balances Tab */}
      {tab === 'balances' && (
        <div>
          <div className="section-title" style={{ marginBottom: '1rem' }}>Net Balances (Click row to see ledger breakdown)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {balances.map((b, i) => {
              const isExpanded = expandedLedgerUserId === b.user.id;
              return (
                <div key={b.user.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    className="balance-row"
                    onClick={() => setExpandedLedgerUserId(isExpanded ? null : b.user.id)}
                    style={{
                      cursor: 'pointer',
                      background: isExpanded ? 'rgba(255,255,255,0.03)' : 'var(--bg-card)',
                      border: isExpanded ? '1px solid var(--accent)' : '1px solid var(--border)',
                      padding: '0.875rem 1.25rem',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.15s ease',
                      margin: 0
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="avatar" style={{ background: getColor(b.user.id), width: 38, height: 38, fontSize: '0.85rem' }}>
                        {getInitials(b.user.name)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {b.user.name} {b.user.left_at && <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', fontWeight: 400 }}>(Left Flat)</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>
                          Paid {b.currency === 'INR' ? '₹' : '$'}{b.totalPaid.toFixed(2)} · Owes {b.currency === 'INR' ? '₹' : '$'}{b.totalOwed.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div>
                        <div style={{
                          fontWeight: 700,
                          color: b.netBalance > 0 ? 'var(--green)' : b.netBalance < 0 ? 'var(--red)' : 'var(--text-2)',
                        }}>
                          {b.netBalance > 0 ? '+' : ''}{b.currency === 'INR' ? '₹' : '$'}{Math.abs(b.netBalance).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>
                          {b.netBalance > 0 ? 'gets back' : b.netBalance < 0 ? 'owes' : 'settled'}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && renderLedgerBreakdown(b.user.id, b.currency)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Settle Tab */}
      {tab === 'settle' && (
        <div>
          <div className="section-title">Simplified Debts</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
            Minimum transactions to settle all debts (greedy max-heap algorithm)
          </p>
          {settlements.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🎉</div>
              <p>All settled up! No outstanding debts.</p>
            </div>
          ) : (
            settlements.map((s, i) => (
              <div key={i} className="settlement-arrow">
                <div className="flex items-center gap-1">
                  <div className="avatar" style={{ background: getColor(s.from?.id || i), width: 36, height: 36, fontSize: '0.8rem' }}>
                    {getInitials(s.from?.name)}
                  </div>
                  <strong>{s.from?.name}</strong>
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div className="arrow-icon">→</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)' }}>{s.currency === 'INR' ? '₹' : '$'}{s.amount.toFixed(2)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="avatar" style={{ background: getColor(s.to?.id || i + 1), width: 36, height: 36, fontSize: '0.8rem' }}>
                    {getInitials(s.to?.name)}
                  </div>
                  <strong>{s.to?.name}</strong>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => setShowSettle(s)}>
                  💳 Pay
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Shopping Tab */}
      {tab === 'shopping' && <ShoppingPanel />}

      {/* Wallet Tab */}
      {tab === 'wallet' && (
        <WalletPanel groupId={activeGroup.id} currentUser={currentUser} />
      )}

      {/* Modals */}
      {showAdd && <AddExpenseModal onClose={() => setShowAdd(false)} />}
      {showSettle && showSettle !== 'choose' && <SettleUpModal settlement={showSettle} onClose={() => setShowSettle(null)} />}
      {/* Dev Tool: Simulate Anomaly */}
      <div style={{ marginTop: '3rem', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '1.5rem', display: 'flex', justifyContent: 'center' }}>
        <button
          className="btn btn-secondary btn-sm"
          style={{ opacity: 0.3, fontSize: '0.7rem' }}
          onClick={async () => {
            try {
              await api.simulateError('mismatched_splits', activeGroup.id);
              toast('💥 Simulated anomaly injected! Auto-refreshing in 1s...', 'info');
              setTimeout(() => window.location.reload(), 1000);
            } catch {
              toast('Failed to inject anomaly', 'error');
            }
          }}
        >
          ⚙️ Dev: Inject Split Sum Mismatch Anomaly
        </button>
      </div>
    </div>
  );
}

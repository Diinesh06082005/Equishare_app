// src/pages/ReceiptScanner.jsx — Drag-and-drop AI receipt itemization
import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

export default function ReceiptScanner({ setActivePage }) {
  const { activeGroup, refreshGroup, toast } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [assignments, setAssignments] = useState({}); // itemIndex -> [userId]
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const members = activeGroup?.members || [];

  async function processFile(file) {
    if (!file) return;
    setScanning(true);
    setReceipt(null);
    try {
      const result = await api.scanReceipt(file.name);
      setReceipt(result);
      // Init assignments: each item -> all members
      const init = {};
      result.items.forEach((_, i) => { init[i] = members.map(m => m.id); });
      setAssignments(init);
      toast(`🧾 Receipt scanned: ${result.restaurant} (${result.confidence * 100}% confidence)`, 'success');
    } catch { toast('Scan failed', 'error'); }
    finally { setScanning(false); }
  }

  function toggleAssignment(itemIdx, userId) {
    setAssignments(a => {
      const cur = a[itemIdx] || [];
      const next = cur.includes(userId) ? cur.filter(u => u !== userId) : [...cur, userId];
      return { ...a, [itemIdx]: next };
    });
  }

  function calcSplit() {
    if (!receipt) return {};
    const totals = {};
    receipt.items.forEach((item, i) => {
      const assigned = assignments[i] || [];
      if (assigned.length === 0) return;
      const share = item.price / assigned.length;
      assigned.forEach(uid => { totals[uid] = (totals[uid] || 0) + share; });
    });
    return totals;
  }

  async function handleCreateExpense() {
    if (!activeGroup) { toast('Select a group first', 'warn'); return; }
    const totals = calcSplit();
    const grandTotal = receipt.total;
    const splits = Object.entries(totals).map(([uid, amount]) => ({
      userId: parseInt(uid), amount: Math.round(amount * 100) / 100,
    }));
    if (splits.length === 0) { toast('Assign items to at least one member', 'warn'); return; }

    const paidBy = members[0]?.id;
    setSaving(true);
    try {
      await api.createExpense({
        groupId: activeGroup.id,
        description: `🧾 ${receipt.restaurant}`,
        total: grandTotal,
        paidBy,
        splitType: 'exact',
        splits,
      });
      await refreshGroup();
      toast('✅ Receipt expense created!', 'success');
      setReceipt(null);
    } catch (err) { toast(err.response?.data?.error || err.message, 'error'); }
    finally { setSaving(false); }
  }

  const splitTotals = calcSplit();

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">🧾 Receipt Scanner</h2>
          <p className="page-subtitle">AI-powered receipt itemization with per-person assignment</p>
        </div>
        {activeGroup && <span className="badge badge-purple">Group: {activeGroup.name}</span>}
      </div>

      {/* Drop Zone */}
      {!receipt && (
        <div
          className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
            onChange={e => processFile(e.target.files[0])} />
          {scanning ? (
            <>
              <div style={{ fontSize: '3rem', animation: 'spin 1s linear infinite' }}>🔍</div>
              <p className="drop-zone-text" style={{ marginTop: '1rem' }}>AI scanning receipt…</p>
            </>
          ) : (
            <>
              <div className="drop-zone-icon">📸</div>
              <p className="drop-zone-text">
                <strong>Drag & drop</strong> a receipt image or <strong>click to browse</strong>
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.5rem' }}>
                Supports JPG, PNG, PDF · Mock AI processes in ~1 second
              </p>
            </>
          )}
        </div>
      )}

      {/* Demo quick scan */}
      {!receipt && !scanning && (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => processFile({ name: 'demo_receipt.jpg' })}>
            ⚡ Quick Demo Scan
          </button>
        </div>
      )}

      {/* Receipt Results */}
      {receipt && (
        <div>
          <div className="card mb-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{receipt.restaurant}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-2)' }}>{receipt.date} · {receipt.items.length} items</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--accent)' }}>${receipt.total.toFixed(2)}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>Total</div>
              </div>
            </div>
          </div>

          {members.length === 0 && (
            <div style={{ background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--yellow)' }}>
              ⚠️ Select a group first to assign items to members.
            </div>
          )}

          <div className="section-title">Assign Items to Members</div>
          <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-2)' }}>
            Click member chips to toggle who consumed each item. Tax items split proportionally.
          </div>

          {receipt.items.map((item, i) => (
            <div key={i} className={`receipt-item ${item.isTax ? '' : 'selectable'}`}>
              <div className="receipt-item-name">
                {item.name}
                {item.isTax && <span className="badge badge-yellow" style={{ marginLeft: '0.5rem' }}>Tax/Fee</span>}
              </div>
              <div className="receipt-item-price">${item.price.toFixed(2)}</div>
              {!item.isTax && members.length > 0 && (
                <div style={{ display: 'flex', gap: '0.3rem', marginLeft: '0.75rem' }}>
                  {members.map(m => {
                    const assigned = (assignments[i] || []).includes(m.id);
                    return (
                      <button key={m.id}
                        onClick={() => toggleAssignment(i, m.id)}
                        style={{
                          padding: '0.2rem 0.5rem', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600,
                          border: `1px solid ${assigned ? 'var(--accent)' : 'var(--border)'}`,
                          background: assigned ? 'rgba(108,99,255,0.2)' : 'var(--bg-600)',
                          color: assigned ? 'var(--accent)' : 'var(--text-3)',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}>
                        {m.name.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {/* Split summary */}
          {members.length > 0 && (
            <div className="card mt-2 mb-3">
              <div className="section-title">Individual Totals</div>
              <div className="grid-3">
                {members.map(m => (
                  <div key={m.id} style={{ textAlign: 'center', padding: '0.75rem', background: 'var(--bg-700)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>
                      ${(splitTotals[m.id] || 0).toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginTop: '0.25rem' }}>{m.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => setReceipt(null)}>← Rescan</button>
            {activeGroup && (
              <button className="btn btn-primary" onClick={handleCreateExpense} disabled={saving}>
                {saving ? '⏳ Creating…' : '✅ Create Expense from Receipt'}
              </button>
            )}
            {!activeGroup && (
              <button className="btn btn-primary" onClick={() => setActivePage('groups')}>
                Select a Group First →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

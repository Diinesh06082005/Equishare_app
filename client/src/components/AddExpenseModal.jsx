// src/components/AddExpenseModal.jsx
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

const SPLIT_TYPES = [
  { id: 'equal', icon: '⚖️', label: 'Equal' },
  { id: 'exact', icon: '🎯', label: 'Exact' },
  { id: 'percentage', icon: '%', label: 'Percent' },
  { id: 'shares', icon: '🔢', label: 'Shares' },
];

export default function AddExpenseModal({ onClose }) {
  const { activeGroup, users, refreshGroup, toast, offline } = useApp();
  const members = activeGroup?.members || [];

  const [form, setForm] = useState({
    description: '', total: '', paidBy: members[0]?.id || '',
    splitType: 'equal',
  });
  const [customSplits, setCustomSplits] = useState(
    members.map(m => ({ userId: m.id, name: m.name, value: '' }))
  );
  const [saving, setSaving] = useState(false);

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function updateSplit(uid, val) {
    setCustomSplits(cs => cs.map(s => s.userId === uid ? { ...s, value: val } : s));
  }

  function getSplitPayload() {
    if (form.splitType === 'equal') return {};
    if (form.splitType === 'exact')
      return { splits: customSplits.map(s => ({ userId: s.userId, amount: parseFloat(s.value) || 0 })) };
    if (form.splitType === 'percentage')
      return { splits: customSplits.map(s => ({ userId: s.userId, percentage: parseFloat(s.value) || 0 })) };
    if (form.splitType === 'shares')
      return { splits: customSplits.map(s => ({ userId: s.userId, shares: parseFloat(s.value) || 1 })) };
    return {};
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.total || !form.description || !form.paidBy) return;
    setSaving(true);
    try {
      await api.createExpense({
        groupId: activeGroup.id,
        description: form.description,
        total: parseFloat(form.total),
        paidBy: Number(form.paidBy),
        splitType: form.splitType,
        isOffline: offline,
        ...getSplitPayload(),
      });
      await refreshGroup();
      toast(offline ? '📴 Expense queued offline' : '✅ Expense added!', 'success');
      onClose();
    } catch (err) {
      toast(err.response?.data?.error || err.message || 'Failed', 'error');
    } finally { setSaving(false); }
  }

  const total = parseFloat(form.total) || 0;
  const perPerson = members.length > 0 ? (total / members.length).toFixed(2) : '0.00';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">💸 Add Expense</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Description *</label>
            <input className="form-input" value={form.description} onChange={e => setField('description', e.target.value)}
              placeholder="e.g. Hotel Stay, Dinner, Taxi…" required />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Total Amount ($) *</label>
              <input className="form-input" type="number" step="0.01" min="0.01" value={form.total}
                onChange={e => setField('total', e.target.value)} placeholder="0.00" required />
            </div>
            <div className="form-group">
              <label className="form-label">Paid By *</label>
              <select className="form-select" value={form.paidBy} onChange={e => setField('paidBy', e.target.value)} required>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* Split type */}
          <div className="form-group">
            <label className="form-label">Split Method</label>
            <div className="split-types">
              {SPLIT_TYPES.map(st => (
                <button key={st.id} type="button"
                  className={`split-type-btn ${form.splitType === st.id ? 'active' : ''}`}
                  onClick={() => setField('splitType', st.id)}>
                  <span className="split-type-icon">{st.icon}</span>
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Equal preview */}
          {form.splitType === 'equal' && total > 0 && (
            <div style={{ background: 'var(--bg-700)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-2)' }}>
              ⚖️ Each of {members.length} members pays <strong style={{ color: 'var(--accent)' }}>${perPerson}</strong>
            </div>
          )}

          {/* Custom split inputs */}
          {form.splitType !== 'equal' && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="form-label" style={{ marginBottom: '0.5rem' }}>
                {form.splitType === 'exact' && 'Enter exact amounts ($)'}
                {form.splitType === 'percentage' && 'Enter percentages (must sum to 100%)'}
                {form.splitType === 'shares' && 'Enter share weights'}
              </div>
              {customSplits.map(s => (
                <div key={s.userId} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span style={{ minWidth: 80, fontSize: '0.85rem', fontWeight: 500 }}>{s.name}</span>
                  <input className="form-input" type="number" step="0.01" min="0"
                    value={s.value} onChange={e => updateSplit(s.userId, e.target.value)}
                    placeholder={form.splitType === 'shares' ? '1' : '0'}
                    style={{ maxWidth: 120 }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                    {form.splitType === 'percentage' ? '%' : form.splitType === 'shares' ? 'shares' : '$'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {offline && (
            <div style={{ background: 'rgba(255,101,132,0.1)', border: '1px solid rgba(255,101,132,0.25)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.875rem', fontSize: '0.8rem', color: 'var(--accent-2)', marginBottom: '1rem' }}>
              📴 You are offline — this expense will be queued and synced later.
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '⏳ Saving…' : '+ Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

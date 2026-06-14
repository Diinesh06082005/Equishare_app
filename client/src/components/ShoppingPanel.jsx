// src/components/ShoppingPanel.jsx — Shared shopping list with "convert to expense" modal
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

export default function ShoppingPanel() {
  const { activeGroup, shoppingList, refreshGroup, toast } = useApp();
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);
  const [convertItem, setConvertItem] = useState(null);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseTotal, setExpenseTotal] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [converting, setConverting] = useState(false);

  const members = activeGroup?.members || [];

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.trim()) return;
    setAdding(true);
    try {
      await api.addShoppingItem({ groupId: activeGroup.id, name: newItem, addedBy: members[0]?.id });
      await refreshGroup();
      setNewItem('');
      toast('Item added! 🛒', 'success');
    } catch { toast('Failed to add item', 'error'); }
    finally { setAdding(false); }
  }

  async function toggleItem(item) {
    if (!item.checked) {
      setConvertItem(item);
      setExpenseDesc(item.name);
    } else {
      await api.updateShoppingItem(item.id, { checked: false });
      await refreshGroup();
    }
  }

  async function handleConvert(createExpense) {
    if (!convertItem) return;
    try {
      if (createExpense && expenseTotal && paidBy) {
        const exp = await api.createExpense({
          groupId: activeGroup.id,
          description: expenseDesc || convertItem.name,
          total: parseFloat(expenseTotal),
          paidBy: Number(paidBy),
          splitType: 'equal',
        });
        await api.updateShoppingItem(convertItem.id, { checked: true, expenseId: exp.id });
        toast('✅ Converted to expense!', 'success');
      } else {
        await api.updateShoppingItem(convertItem.id, { checked: true });
        toast('Item checked off ✓', 'info');
      }
      await refreshGroup();
    } catch { toast('Failed', 'error'); }
    finally { setConvertItem(null); setExpenseTotal(''); setPaidBy(''); }
  }

  async function deleteItem(id) {
    try {
      await api.deleteShoppingItem(id);
      await refreshGroup();
    } catch { toast('Failed to delete', 'error'); }
  }

  const unchecked = shoppingList.filter(i => !i.checked);
  const checked = shoppingList.filter(i => i.checked);

  return (
    <div>
      <form onSubmit={addItem} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <input className="form-input" value={newItem} onChange={e => setNewItem(e.target.value)}
          placeholder="Add item… e.g. Sunscreen, Water bottles" style={{ flex: 1 }} />
        <button type="submit" className="btn btn-primary" disabled={adding}>{adding ? '⏳' : '+ Add'}</button>
      </form>

      {unchecked.length === 0 && checked.length === 0 && (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>Shopping list is empty!</p></div>
      )}

      {unchecked.map(item => (
        <div key={item.id} className="shop-item">
          <input type="checkbox" checked={false} onChange={() => toggleItem(item)} />
          <span className="shop-name">{item.name}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{item.added_by_name}</span>
          {item.expense_id && <span className="badge badge-green">💸</span>}
          <button className="btn btn-danger btn-sm btn-icon" onClick={() => deleteItem(item.id)}>🗑️</button>
        </div>
      ))}

      {checked.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', margin: '1rem 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Completed ({checked.length})
          </div>
          {checked.map(item => (
            <div key={item.id} className="shop-item checked">
              <input type="checkbox" checked onChange={() => toggleItem(item)} />
              <span className="shop-name">{item.name}</span>
              {item.expense_id && <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>💸 Expense</span>}
              <button className="btn btn-danger btn-sm btn-icon" onClick={() => deleteItem(item.id)}>🗑️</button>
            </div>
          ))}
        </>
      )}

      {/* Convert to Expense Modal */}
      {convertItem && (
        <div className="modal-overlay" onClick={() => setConvertItem(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">🛒 → 💸 Convert to Expense?</div>
              <button className="modal-close" onClick={() => setConvertItem(null)}>×</button>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginBottom: '1.25rem' }}>
              Would you like to log "<strong>{convertItem.name}</strong>" as a shared expense?
            </p>
            <div className="form-group">
              <label className="form-label">Expense Description</label>
              <input className="form-input" value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Total Amount ($)</label>
              <input className="form-input" type="number" step="0.01" min="0" value={expenseTotal} onChange={e => setExpenseTotal(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label className="form-label">Paid By</label>
              <select className="form-select" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => handleConvert(false)}>Just Check Off</button>
              <button className="btn btn-primary" onClick={() => handleConvert(true)} disabled={!expenseTotal || !paidBy}>
                ✓ Create Expense
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

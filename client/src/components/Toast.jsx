// src/components/Toast.jsx
import { useApp } from '../context/AppContext';

const ICONS = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };

export default function ToastContainer() {
  const { toasts, dispatch } = useApp();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{ICONS[t.type] || 'ℹ️'}</span>
          <span>{t.message}</span>
          <button onClick={() => dispatch({ type: 'REMOVE_TOAST', id: t.id })}
            style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: '1rem' }}>×</button>
        </div>
      ))}
    </div>
  );
}

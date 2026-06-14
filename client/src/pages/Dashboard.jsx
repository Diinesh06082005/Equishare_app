// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Avatar } from '../components/Sidebar';
import { getFinancialInsights } from '../api';

export default function Dashboard({ setActivePage }) {
  const { groups, balances, activeGroup, selectGroup, users } = useApp();
  const [insights, setInsights] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalGroups = groups.length;
  const totalExpenses = groups.reduce((a, g) => a, 0);

  // Compute global "you owe" / "owed to you" from all group balances
  const netAmount = balances.reduce((acc, b) => acc + b.netBalance, 0);

  useEffect(() => {
    let active = true;
    async function fetchInsights() {
      setLoading(true);
      setError('');
      try {
        const data = await getFinancialInsights(balances, totalGroups);
        if (active) {
          setInsights(data.insights || 'No insights available right now.');
        }
      } catch (err) {
        console.error(err);
        if (active) {
          setError('Failed to fetch AI insights. Click to retry.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    
    if (balances && balances.length > 0) {
      fetchInsights();
    } else {
      setInsights('Add expenses inside your groups to receive customized budgeting suggestions and settlement plans.');
    }
    
    return () => { active = false; };
  }, [balances, totalGroups]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard 🏠</h2>
          <p className="page-subtitle">Your financial snapshot at a glance</p>
        </div>
        <button className="btn btn-primary" onClick={() => setActivePage('groups')}>
          + New Group
        </button>
      </div>

      {/* Stats */}
      <div className="grid-4 mb-3">
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{totalGroups}</div>
          <div className="stat-label">Active Groups</div>
        </div>
        <div className="stat-card green">
          <div className="stat-icon">💰</div>
          <div className="stat-value">{users.length}</div>
          <div className="stat-label">Members Total</div>
        </div>
        <div className={`stat-card ${netAmount >= 0 ? 'green' : 'red'}`}>
          <div className="stat-icon">{netAmount >= 0 ? '📈' : '📉'}</div>
          <div className="stat-value">${Math.abs(netAmount).toFixed(2)}</div>
          <div className="stat-label">{netAmount >= 0 ? 'You Are Owed' : 'You Owe'}</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">0</div>
          <div className="stat-label">Pending Sync</div>
        </div>
      </div>

      {/* AI Financial Advisor */}
      <div className="card mb-3" style={{ background: 'linear-gradient(135deg, rgba(10, 12, 25, 0.6) 0%, rgba(108, 99, 255, 0.05) 100%)', border: '1px solid rgba(108, 99, 255, 0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>✨</span> AI Financial Advisor
          </h3>
          <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>Gemini Active</span>
        </div>
        
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-2)', fontSize: '0.85rem' }}>
            <span className="spin">⏳</span> Analyzing balances and generating custom advice...
          </div>
        ) : error ? (
          <div style={{ color: 'var(--accent-2)', fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => window.location.reload()}>
            ⚠️ {error} (Click to refresh)
          </div>
        ) : (
          <div style={{ color: 'var(--text-2)', fontSize: '0.85rem', lineHeight: '1.6' }}>
            {insights.split('\n').map((line, idx) => (
              <p key={idx} style={{ margin: '0.25rem 0' }}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Groups Grid */}
      <div className="section-title">Your Groups</div>
      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">👥</div>
          <p>No groups yet. Create one to start splitting!</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setActivePage('groups')}>
            Create Your First Group
          </button>
        </div>
      ) : (
        <div className="grid-3">
          {groups.map((g, i) => (
            <div key={g.id} className="group-card" onClick={() => { selectGroup(g); setActivePage('group'); }}>
              <div className="group-card-icon">
                {['🏖️','🏠','🎉','🍕','✈️','🎮'][i % 6]}
              </div>
              <div className="group-name">{g.name}</div>
              <div className="group-meta">
                <span>👤 {g.member_count} members</span>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <span className="badge badge-purple">View Details →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

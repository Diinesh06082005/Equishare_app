// src/pages/LoginPage.jsx — Authentication UI
import { useState } from 'react';
import * as api from '../api';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let result;
      if (mode === 'register') {
        if (!name.trim()) { setError('Name is required'); setLoading(false); return; }
        result = await api.register({ name: name.trim(), email: email.trim() });
      } else {
        result = await api.login({ email: email.trim() });
      }
      localStorage.setItem('sw_token', result.token);
      localStorage.setItem('sw_user', JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  // Quick-login with demo accounts
  const DEMO_ACCOUNTS = [
    { name: 'Aisha',  email: 'aisha@demo.com'  },
    { name: 'Rohan',  email: 'rohan@demo.com'  },
    { name: 'Priya',  email: 'priya@demo.com'  },
    { name: 'Meera',  email: 'meera@demo.com'  },
    { name: 'Dev',    email: 'dev@demo.com'    },
    { name: 'Sam',    email: 'sam@demo.com'    },
  ];

  async function quickLogin(account) {
    setLoading(true);
    setError('');
    try {
      const result = await api.login({ email: account.email });
      localStorage.setItem('sw_token', result.token);
      localStorage.setItem('sw_user', JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
      setError(err?.response?.data?.error || 'Demo login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-900)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: 64, height: 64,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2rem', margin: '0 auto 1rem',
            boxShadow: '0 8px 32px rgba(108,99,255,0.4)',
          }}>💸</div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.03em' }}>EquiShare</h1>
          <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Smart shared expense tracking
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '2rem' }}>
          {/* Toggle */}
          <div className="tabs" style={{ marginBottom: '1.5rem' }}>
            <button
              id="tab-login"
              className={`tab-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => { setMode('login'); setError(''); }}
            >Sign In</button>
            <button
              id="tab-register"
              className={`tab-btn ${mode === 'register' ? 'active' : ''}`}
              onClick={() => { setMode('register'); setError(''); }}
            >Register</button>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label" htmlFor="login-name">Full Name</label>
                <input
                  id="login-name"
                  className="form-input"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                className="form-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)',
                borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem',
                color: 'var(--red)', fontSize: '0.85rem', marginBottom: '1rem',
              }}>
                ⚠️ {error}
              </div>
            )}

            <button
              id="btn-auth-submit"
              type="submit"
              className="btn btn-primary w-full"
              style={{ justifyContent: 'center', width: '100%' }}
              disabled={loading}
            >
              {loading ? '⏳ Please wait…' : mode === 'login' ? '→ Sign In' : '✓ Create Account'}
            </button>
          </form>

          {/* Demo accounts */}
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', textAlign: 'center', marginBottom: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              — Quick Demo Login —
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {DEMO_ACCOUNTS.map(a => (
                <button
                  key={a.email}
                  id={`demo-${a.name.toLowerCase()}`}
                  className="btn btn-secondary btn-sm"
                  onClick={() => quickLogin(a)}
                  disabled={loading}
                  style={{ fontSize: '0.75rem', justifyContent: 'center' }}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.72rem', marginTop: '1.5rem' }}>
          Shared Expenses App · Assignment Build
        </p>
      </div>
    </div>
  );
}

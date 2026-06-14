// src/App.jsx
import { useState, useEffect } from 'react';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import ToastContainer from './components/Toast';
import AIChatAssistant from './components/AIChatAssistant';
import Dashboard from './pages/Dashboard';
import GroupsPage from './pages/GroupsPage';
import GroupDetail from './pages/GroupDetail';
import ReceiptScanner from './pages/ReceiptScanner';
import OfflineSync from './pages/OfflineSync';
import LoginPage from './pages/LoginPage';
import ImportPage from './pages/ImportPage';
import PersonalWallet from './pages/PersonalWallet';
import { getQueue, removeFromQueue } from './services/walletEngine';
import * as api from './api';

function AppShell({ currentUser, onLogout }) {
  const [activePage, setActivePage] = useState('dashboard');

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':       return <Dashboard setActivePage={setActivePage} />;
      case 'groups':          return <GroupsPage setActivePage={setActivePage} />;
      case 'group':           return <GroupDetail setActivePage={setActivePage} />;
      case 'receipt':         return <ReceiptScanner setActivePage={setActivePage} />;
      case 'offline':         return <OfflineSync />;
      case 'import':          return <ImportPage />;
      case 'personal-wallet': return <PersonalWallet />;
      default:                return <Dashboard setActivePage={setActivePage} />;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        currentUser={currentUser}
        onLogout={onLogout}
      />
      <main className="main-content">
        {renderPage()}
      </main>
      <ToastContainer />
      <AIChatAssistant />
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('sw_user');
    if (stored) {
      try { setCurrentUser(JSON.parse(stored)); } catch {}
    }
    setAuthChecked(true);
  }, []);

  function handleLogin(user) {
    setCurrentUser(user);
  }

  function handleLogout() {
    localStorage.removeItem('sw_token');
    localStorage.removeItem('sw_user');
    setCurrentUser(null);
  }

  // ── Global online listener — auto-reconcile offline wallet queue ──
  useEffect(() => {
    async function onOnline() {
      const queue = await getQueue();
      if (!queue.length) return;

      // Group by groupId
      const byGroup = {};
      for (const v of queue) {
        if (!byGroup[v.group_id]) byGroup[v.group_id] = [];
        byGroup[v.group_id].push(v);
      }

      for (const [groupId, vouchers] of Object.entries(byGroup)) {
        try {
          const result = await api.reconcileWallet({ groupId: Number(groupId), vouchers });
          for (const r of result.results) {
            if (r.status === 'RECONCILED') await removeFromQueue(r.voucher_uuid);
          }
          const ok = result.results.filter(r => r.status === 'RECONCILED').length;
          console.log(`[Wallet] Auto-reconciled ${ok} voucher(s) for group ${groupId}`);
        } catch (err) {
          console.warn('[Wallet] Auto-reconcile failed:', err.message);
        }
      }
    }

    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // ── Global error listener for self-healing AI agent ──
  useEffect(() => {
    const handleError = (event) => {
      if (event.message?.includes('ResizeObserver') || event.message?.includes('Script error')) return;
      const errorDetails = {
        message: event.message || (event.error && event.error.message) || 'Unknown error',
        stack: event.error && event.error.stack,
        component: 'Global Interceptor',
        route: window.location.pathname
      };
      try {
        const caughtErrors = JSON.parse(localStorage.getItem('sw_caught_errors') || '[]');
        caughtErrors.push({ ...errorDetails, timestamp: new Date().toISOString(), resolved: false });
        localStorage.setItem('sw_caught_errors', JSON.stringify(caughtErrors));
        window.dispatchEvent(new Event('storage'));
      } catch (err) {
        console.error('Failed to log error to self-healing agent:', err);
      }
    };
    const handleRejection = (event) => {
      const reason = event.reason || {};
      handleError({
        message: reason.message || 'Unhandled Promise Rejection',
        error: reason
      });
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (!authChecked) return null; // wait for localStorage check

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <AppProvider currentUser={currentUser}>
      <AppShell currentUser={currentUser} onLogout={handleLogout} />
    </AppProvider>
  );
}

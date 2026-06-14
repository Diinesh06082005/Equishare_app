// src/components/Sidebar.jsx
import { useApp } from '../context/AppContext';

const COLORS = ['#6c63ff','#ff6584','#43e97b','#f39c12','#3498db','#e74c3c','#9b59b6'];

export function Avatar({ name, size = 36, index = 0 }) {
  const bg = COLORS[index % COLORS.length];
  const initials = name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?';
  return (
    <div className="avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.35 }}>
      {initials}
    </div>
  );
}

const ICONS = {
  dashboard: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '1.05rem', height: '1.05rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  ),
  groups: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '1.05rem', height: '1.05rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.109A11.386 11.386 0 0110.089 20M3.12 18.254a9.382 9.382 0 002.625.372 9.336 9.336 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M3.12 18.254a11.386 11.386 0 004.838 1.747m0 0A11.956 11.956 0 0112 21c-2.07 0-4.007-.525-5.698-1.446m0 0A10.747 10.747 0 013.12 18.254M8.25 11.25a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5zm7.5 0a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z" />
    </svg>
  ),
  'personal-wallet': (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '1.05rem', height: '1.05rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 8.25h19M2.5 9h19m-16.5 5.25h6m-6 2.25h3m-3.375-12h17.25c.621 0 1.125.504 1.125 1.125v13.5c0 .621-.504 1.125-1.125 1.125H3.375A1.125 1.125 0 012.25 18V5.625c0-.621.504-1.125 1.125-1.125z" />
    </svg>
  ),
  import: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '1.05rem', height: '1.05rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
    </svg>
  ),
  receipt: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '1.05rem', height: '1.05rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  offline: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '1.05rem', height: '1.05rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.284 16.284A3 3 0 0012 21a3 3 0 003.716-4.716M12 14.25a.75.75 0 100-1.5.75.75 0 000 1.5zM3.75 13.5c0-4.556 3.694-8.25 8.25-8.25s8.25 3.694 8.25 8.25M6.75 13.5a5.25 5.25 0 0110.5 0" />
    </svg>
  ),
  groupItem: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" style={{ width: '0.95rem', height: '0.95rem' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A9 9 0 0112 3v.75m0 0A9 9 0 0021.75 12v.75m-9.75-9.75c-3.18 0-6 1.6-7.75 4M12 3.75a9 9 0 017.75 4m-15.5 0A9 9 0 002.25 12h19.5a9 9 0 00-19.5 0z" />
    </svg>
  )
};

export default function Sidebar({ activePage, setActivePage, currentUser, onLogout }) {
  const { groups, activeGroup, selectGroup, offline, toggleOffline } = useApp();

  const NAV_ITEMS = [
    { id: 'dashboard',       icon: ICONS.dashboard, label: 'Dashboard' },
    { id: 'groups',          icon: ICONS.groups, label: 'All Groups' },
    { id: 'personal-wallet', icon: ICONS['personal-wallet'], label: 'Personal Wallet' },
    { id: 'import',          icon: ICONS.import, label: 'Import CSV' },
    { id: 'receipt',         icon: ICONS.receipt, label: 'Receipt Scanner' },
    { id: 'offline',         icon: ICONS.offline, label: 'Offline & Sync' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">💸</div>
        <div>
          <h1>EquiShare</h1>
          <span>Smart expense splitting</span>
        </div>
      </div>

      {/* Current user */}
      {currentUser && (
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <Avatar name={currentUser.name} size={32} index={currentUser.id % COLORS.length} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentUser.name}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>{currentUser.email}</div>
          </div>
          <button
            id="btn-logout"
            title="Sign out"
            style={{ color: 'var(--text-3)', fontSize: '0.75rem', padding: '0.25rem' }}
            onClick={onLogout}
          >⏻</button>
        </div>
      )}

      <div style={{ padding: '0.75rem', flex: 1, overflow: 'auto' }}>
        <div className="sidebar-label" style={{ paddingTop: '0.5rem' }}>Navigation</div>
        {NAV_ITEMS.map(item => (
          <div key={item.id}
            id={`nav-${item.id}`}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            onClick={() => setActivePage(item.id)}>
            <span className="icon">{item.icon}</span>
            {item.label}
            {item.id === 'import' && (
              <span style={{ marginLeft: 'auto', fontSize: '0.6rem', background: 'rgba(108,99,255,0.2)', color: 'var(--accent)', padding: '0.1rem 0.4rem', borderRadius: 10, fontWeight: 700 }}>
                NEW
              </span>
            )}
          </div>
        ))}

        {groups.length > 0 && (
          <>
            <div className="sidebar-label" style={{ marginTop: '1rem' }}>Your Groups</div>
            {groups.map((g, i) => (
              <div key={g.id}
                id={`nav-group-${g.id}`}
                className={`nav-item ${activeGroup?.id === g.id && activePage === 'group' ? 'active' : ''}`}
                onClick={() => { selectGroup(g); setActivePage('group'); }}>
                <span className="icon">{ICONS.groupItem}</span>
                <span className="truncate">{g.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-3)' }}>{g.member_count}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{ padding: '0 0.75rem 0.75rem' }}>
        <div
          id="offline-toggle"
          className={`offline-badge ${offline ? '' : 'online'}`}
          onClick={toggleOffline}
          style={{ cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
          {offline ? '📴 Offline Mode' : '📶 Online'}
        </div>
      </div>
    </aside>
  );
}

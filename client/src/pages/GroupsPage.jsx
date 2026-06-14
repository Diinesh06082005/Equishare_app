// src/pages/GroupsPage.jsx — Create/list all groups + add guest users
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';
import { Avatar } from '../components/Sidebar';

const COLORS = ['#6c63ff','#ff6584','#43e97b','#f39c12','#3498db','#e74c3c','#9b59b6'];

export default function GroupsPage({ setActivePage }) {
  const { groups, users, loadGroups, loadUsers, selectGroup, toast } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [form, setForm] = useState({ name: '', memberIds: [] });
  const [userForm, setUserForm] = useState({ name: '', email: '', isGuest: false, upiVpa: '', venmoHandle: '' });
  const [saving, setSaving] = useState(false);
  const [inviteLink, setInviteLink] = useState(null);

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.createGroup({ name: form.name, memberIds: form.memberIds });
      await loadGroups();
      setShowCreate(false);
      setForm({ name: '', memberIds: [] });
      toast('Group created! 🎉', 'success');
    } catch { toast('Failed to create group', 'error'); }
    finally { setSaving(false); }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const user = await api.createUser(userForm);
      await loadUsers();
      if (user.invite_token) {
        const url = `${window.location.origin}/group/guest?token=${user.invite_token}`;
        setInviteLink({ user, url });
      }
      setShowAddUser(false);
      setUserForm({ name: '', email: '', isGuest: false, upiVpa: '', venmoHandle: '' });
      toast(`User "${user.name}" added!`, 'success');
    } catch (err) { toast(err.response?.data?.error || 'Failed to add user', 'error'); }
    finally { setSaving(false); }
  }

  function toggleMember(uid) {
    setForm(f => ({
      ...f,
      memberIds: f.memberIds.includes(uid) ? f.memberIds.filter(id => id !== uid) : [...f.memberIds, uid],
    }));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Groups 👥</h2>
          <p className="page-subtitle">Manage your expense-sharing groups</p>
        </div>
        <div className="flex gap-1">
          <button className="btn btn-secondary" onClick={() => setShowAddUser(true)}>+ Add Person</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Group</button>
        </div>
      </div>

      {/* Members list */}
      <div className="mb-3">
        <div className="section-title">All People ({users.length})</div>
        <div className="grid-4">
          {users.map((u, i) => (
            <div key={u.id} className="card card-sm flex items-center gap-1">
              <Avatar name={u.name} index={i} size={38} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }} className="truncate">{u.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{u.is_guest ? '👤 Guest' : u.email || 'No email'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Groups */}
      <div className="section-title">All Groups ({groups.length})</div>
      <div className="grid-3">
        {groups.map((g, i) => (
          <div key={g.id} className="group-card" onClick={() => { selectGroup(g); setActivePage('group'); }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
              {['🏖️','🏠','🎉','🍕','✈️','🎮','🎵','⛷️'][i % 8]}
            </div>
            <div className="group-name">{g.name}</div>
            <div className="group-meta"><span>👤 {g.member_count} members</span></div>
            <div style={{ marginTop: '0.75rem' }}>
              <span className="badge badge-purple">Open →</span>
            </div>
          </div>
        ))}
      </div>

      {/* Create Group Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Create New Group</div>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleCreateGroup}>
              <div className="form-group">
                <label className="form-label">Group Name</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Goa Trip 🏖️" required />
              </div>
              <div className="form-group">
                <label className="form-label">Add Members</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {users.map((u, i) => (
                    <div key={u.id}
                      onClick={() => toggleMember(u.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        padding: '0.35rem 0.75rem', borderRadius: '20px', cursor: 'pointer',
                        border: `1px solid ${form.memberIds.includes(u.id) ? 'var(--accent)' : 'var(--border)'}`,
                        background: form.memberIds.includes(u.id) ? 'rgba(108,99,255,0.15)' : 'var(--bg-700)',
                        fontSize: '0.8rem', fontWeight: 500, transition: 'all 0.2s',
                      }}>
                      <Avatar name={u.name} index={i} size={20} />
                      {u.name}
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳ Creating…' : '✓ Create Group'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Person Modal */}
      {showAddUser && (
        <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add Person</div>
              <button className="modal-close" onClick={() => setShowAddUser(false)}>×</button>
            </div>
            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" required />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <input type="checkbox" id="guestMode" checked={userForm.isGuest} onChange={e => setUserForm(f => ({ ...f, isGuest: e.target.checked }))} />
                <label htmlFor="guestMode" style={{ fontSize: '0.875rem', cursor: 'pointer' }}>
                  🔗 Guest User (generates invite link, no account needed)
                </label>
              </div>
              {!userForm.isGuest && (
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
                </div>
              )}
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">UPI VPA (India)</label>
                  <input className="form-input" value={userForm.upiVpa} onChange={e => setUserForm(f => ({ ...f, upiVpa: e.target.value }))} placeholder="name@upi" />
                </div>
                <div className="form-group">
                  <label className="form-label">Venmo Handle</label>
                  <input className="form-input" value={userForm.venmoHandle} onChange={e => setUserForm(f => ({ ...f, venmoHandle: e.target.value }))} placeholder="@username" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳…' : '+ Add Person'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Link Modal */}
      {inviteLink && (
        <div className="modal-overlay" onClick={() => setInviteLink(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">🔗 Guest Invite Link</div>
              <button className="modal-close" onClick={() => setInviteLink(null)}>×</button>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
              Share this link with <strong>{inviteLink.user.name}</strong> — they'll see their personalized ledger without needing an account.
            </p>
            <div className="invite-url">{inviteLink.url}</div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(inviteLink.url); toast('Copied!', 'success'); }}>📋 Copy Link</button>
              <button className="btn btn-secondary" onClick={() => setInviteLink(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

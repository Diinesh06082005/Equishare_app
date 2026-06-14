// src/pages/OfflineSync.jsx — Offline mode, QR code sync, Lamport peer simulation
import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';

export default function OfflineSync() {
  const { offline, toggleOffline, activeGroup, offlineQueue, loadOfflineQueue, toast } = useApp();
  const [qrData, setQrData] = useState(null);
  const [loadingQR, setLoadingQR] = useState(false);
  const [importPayload, setImportPayload] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { loadOfflineQueue(); }, []);

  async function generateQR() {
    if (!activeGroup) { toast('Select a group first', 'warn'); return; }
    setLoadingQR(true);
    try {
      const data = await api.getQRPayload(activeGroup.id);
      setQrData(data);
      if (!data.qrDataUrl) toast('No pending sync events to encode', 'info');
    } catch { toast('Failed to generate QR', 'error'); }
    finally { setLoadingQR(false); }
  }

  async function handleImport() {
    if (!importPayload.trim()) return;
    setImporting(true);
    try {
      const decoded = JSON.parse(atob(importPayload.trim()));
      const result = await api.pushOfflineEvents(decoded.events || []);
      toast(`✅ Imported ${result.merged} events (${result.skipped} skipped)`, 'success');
      setImportPayload('');
    } catch { toast('Invalid QR payload or import failed', 'error'); }
    finally { setImporting(false); }
  }

  async function flushQueue() {
    const queue = await api.getOfflineQueue();
    if (queue.length === 0) { toast('Queue is empty', 'info'); return; }
    setSyncing(true);
    try {
      const result = await api.pushOfflineEvents(queue);
      await api.clearOfflineQueue();
      await loadOfflineQueue();
      setSyncStatus(result);
      toast(`✅ Flushed ${result.merged} events`, 'success');
    } catch { toast('Sync failed', 'error'); }
    finally { setSyncing(false); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">📡 Offline & Sync</h2>
          <p className="page-subtitle">Off-grid sync, QR codes, and Lamport timestamp ordering</p>
        </div>
      </div>

      <div className="grid-2 mb-3">
        {/* Offline toggle */}
        <div className="card">
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{offline ? '📴' : '📶'}</div>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.05rem' }}>
            {offline ? 'Offline Mode Active' : 'Currently Online'}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
            {offline
              ? 'Expenses are queued in IndexedDB. Toggle back to sync automatically.'
              : 'All expenses sync in real-time. Toggle to simulate offline operation.'}
          </p>
          <button className={`btn ${offline ? 'btn-success' : 'btn-secondary'} w-full`} onClick={toggleOffline}>
            {offline ? '📶 Go Online & Sync' : '📴 Enable Offline Mode'}
          </button>
          {offlineQueue.length > 0 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--yellow)' }}>
              ⏳ {offlineQueue.length} event(s) pending sync
            </div>
          )}
        </div>

        {/* Queue inspector */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>🗄️ Offline Queue ({offlineQueue.length})</div>
          {offlineQueue.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>Queue is empty — no pending events.</div>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {offlineQueue.map((ev, i) => (
                <div key={i} style={{ padding: '0.5rem', background: 'var(--bg-700)', borderRadius: 'var(--radius-sm)', marginBottom: '0.4rem', fontSize: '0.78rem' }}>
                  <span className="badge badge-yellow">{ev.type}</span>
                  <span style={{ marginLeft: '0.5rem', color: 'var(--text-2)' }}>{ev.payload?.description || ev.queued_at}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary btn-sm w-full" style={{ marginTop: '0.75rem' }} onClick={flushQueue} disabled={syncing || offlineQueue.length === 0}>
            {syncing ? '⏳ Syncing…' : '⬆️ Flush Queue Now'}
          </button>
        </div>
      </div>

      <div className="grid-2">
        {/* QR Generator */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.05rem' }}>📲 QR Code Sync</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
            Encodes pending offline events as Base64 QR. Share with another device to transfer events without internet.
          </p>
          <button className="btn btn-primary w-full" onClick={generateQR} disabled={loadingQR}>
            {loadingQR ? '⏳ Generating…' : '🔲 Generate QR for Active Group'}
          </button>

          {qrData?.qrDataUrl && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <div className="qr-container">
                <img src={qrData.qrDataUrl} alt="Sync QR Code" />
                <div style={{ fontSize: '0.72rem', color: '#333' }}>{qrData.eventCount} event(s)</div>
              </div>
            </div>
          )}
          {qrData && !qrData.qrDataUrl && (
            <div style={{ marginTop: '0.75rem', color: 'var(--text-2)', fontSize: '0.8rem', textAlign: 'center' }}>
              ✓ No pending events to encode
            </div>
          )}
        </div>

        {/* QR Import */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.05rem' }}>📥 Import QR / Peer Sync</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
            Paste a Base64 QR payload (from another device or the generator above) to merge events using Lamport timestamp ordering.
          </p>
          <textarea
            className="form-input"
            rows={5}
            value={importPayload}
            onChange={e => setImportPayload(e.target.value)}
            placeholder="Paste Base64 QR payload here…"
            style={{ fontFamily: 'monospace', fontSize: '0.72rem', resize: 'vertical' }}
          />
          {qrData?.payload && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setImportPayload(qrData.payload)}>
              Use Generated Payload ↑
            </button>
          )}
          <button className="btn btn-primary w-full" style={{ marginTop: '0.75rem' }} onClick={handleImport} disabled={importing || !importPayload.trim()}>
            {importing ? '⏳ Importing…' : '⬇️ Import & Merge Events'}
          </button>

          {syncStatus && (
            <div style={{ marginTop: '0.75rem', background: 'var(--bg-700)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', fontSize: '0.8rem' }}>
              <div style={{ color: 'var(--green)' }}>✅ Merged: {syncStatus.merged}</div>
              <div style={{ color: 'var(--text-3)' }}>⏭ Skipped: {syncStatus.skipped}</div>
              <div style={{ color: 'var(--text-3)' }}>🕐 Server clock: {syncStatus.localClock}</div>
            </div>
          )}
        </div>
      </div>

      {/* Lamport explanation */}
      <div className="card" style={{ marginTop: '1.25rem', background: 'rgba(108,99,255,0.05)', border: '1px solid rgba(108,99,255,0.2)' }}>
        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>⏱️ Lamport Clock Ordering</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', lineHeight: 1.7 }}>
          Each event carries a Lamport timestamp. When merging peer logs, events are sorted by timestamp before insertion — ensuring causal ordering even when devices are out of sync.
          The server clock advances as: <code style={{ background: 'var(--bg-700)', padding: '0.1rem 0.3rem', borderRadius: 4 }}>clock = max(local, remote) + 1</code>.
          Duplicate events are detected by matching group_id + description + created_at and skipped automatically.
        </p>
      </div>
    </div>
  );
}

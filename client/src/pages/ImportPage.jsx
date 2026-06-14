// src/pages/ImportPage.jsx — CSV Import UI with interactive approval & anomaly checks
import { useState, useRef, useEffect } from 'react';
import * as api from '../api';
import { useApp } from '../context/AppContext';

const SEVERITY_COLOR = {
  error:   'var(--red)',
  warning: 'var(--yellow)',
  info:    'var(--accent)',
};
const SEVERITY_BG = {
  error:   'rgba(231,76,60,0.08)',
  warning: 'rgba(243,156,18,0.08)',
  info:    'rgba(108,99,255,0.08)',
};
const SEVERITY_ICON = { error: '❌', warning: '⚠️', info: 'ℹ️' };

export default function ImportPage() {
  const { groups, toast } = useApp();
  const [dragOver, setDragOver]   = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading]     = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState([]);
  const [result, setResult]       = useState(null);
  const [activeAnomaly, setActiveAnomaly] = useState(null);
  const fileRef = useRef();

  // Set default group selection once groups load
  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0].id.toString());
    }
  }, [groups, selectedGroup]);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setSelectedFile(f);
  }

  function onFileChange(e) {
    if (e.target.files[0]) setSelectedFile(e.target.files[0]);
  }

  async function handlePreview() {
    if (!selectedFile) { toast('Please select a CSV file', 'error'); return; }
    setLoading(true);
    setPreviewData(null);
    setResult(null);
    try {
      const data = await api.validateCSV(selectedFile);
      setPreviewData(data);
      // Auto-select all rows except duplicates
      const defaultSelected = data.parsedRows
        .map((row, idx) => {
          const isDuplicate = data.anomalies.some(
            a => a.line_number === row.line_number && a.code === 'DUPLICATE_EXPENSE'
          );
          return isDuplicate ? null : idx;
        })
        .filter(idx => idx !== null);
      setSelectedRowIndices(defaultSelected);
      toast(`🔍 CSV parsed successfully! Review conflicts and select rows to import.`, 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Validation failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!selectedGroup) { toast('Please select a target group', 'error'); return; }
    if (selectedRowIndices.length === 0) { toast('Please select at least one row to import', 'warning'); return; }
    setLoading(true);
    try {
      const approvedRows = previewData.parsedRows.filter((_, idx) => selectedRowIndices.includes(idx));
      const response = await api.commitImport({
        groupId: Number(selectedGroup),
        rows: approvedRows,
        filename: previewData.filename,
        summary: previewData.summary,
        anomalies: previewData.anomalies,
      });

      setResult({
        summary: {
          total_lines: previewData.summary.total_lines,
          imported: response.imported_count,
          skipped_rows: previewData.parsedRows.length - response.imported_count,
        },
        anomalies: previewData.anomalies,
        imported_expenses: response.imported_expenses,
      });
      setPreviewData(null);
      toast(`✅ Successfully imported ${response.imported_count} expenses!`, 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Import failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  const handleRowToggle = (index) => {
    if (selectedRowIndices.includes(index)) {
      setSelectedRowIndices(selectedRowIndices.filter(i => i !== index));
    } else {
      setSelectedRowIndices([...selectedRowIndices, index]);
    }
  };

  const handleToggleAll = () => {
    if (!previewData) return;
    if (selectedRowIndices.length === previewData.parsedRows.length) {
      setSelectedRowIndices([]);
    } else {
      setSelectedRowIndices(previewData.parsedRows.map((_, i) => i));
    }
  };

  const handleToggleNonDuplicates = () => {
    if (!previewData) return;
    const nonDuplicates = previewData.parsedRows
      .map((row, idx) => {
        const isDuplicate = previewData.anomalies.some(
          a => a.line_number === row.line_number && a.code === 'DUPLICATE_EXPENSE'
        );
        return isDuplicate ? null : idx;
      })
      .filter(idx => idx !== null);
    setSelectedRowIndices(nonDuplicates);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">📥 Interactive CSV Import</h2>
          <p className="page-subtitle">Upload expenses_export.csv — preview anomalies and selectively approve duplicates before saving</p>
        </div>
      </div>

      {/* Upload Area */}
      {!previewData && !result && (
        <div className="card mb-3">
          <div
            id="csv-drop-zone"
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current.click()}
          >
            <div className="drop-zone-icon">📂</div>
            {selectedFile ? (
              <div>
                <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '1rem', marginBottom: '0.25rem' }}>
                  {selectedFile.name}
                </div>
                <div className="drop-zone-text">{(selectedFile.size / 1024).toFixed(1)} KB · Click to change</div>
              </div>
            ) : (
              <div className="drop-zone-text">
                <strong>Drop expenses_export.csv here</strong> or click to browse
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>CSV files only · Max 10 MB</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={onFileChange} id="csv-file-input" />

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button
              id="btn-import-csv"
              className="btn btn-primary"
              onClick={handlePreview}
              disabled={loading || !selectedFile}
              style={{ whiteSpace: 'nowrap' }}
            >
              {loading ? '⏳ Parsing…' : '🔍 Upload & Preview'}
            </button>
          </div>
        </div>
      )}

      {/* Interactive Preview & Approval Screen */}
      {previewData && (
        <div className="card mb-3">
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>👀 Import Preview:</span>
            <span style={{ fontSize: '0.9rem', color: 'var(--accent)' }}>{previewData.filename}</span>
          </h3>

          <div className="grid-2 mb-3" style={{ gap: '1.5rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="import-group-select">Import Into Group</label>
              <select
                id="import-group-select"
                className="form-select"
                value={selectedGroup}
                onChange={e => setSelectedGroup(e.target.value)}
              >
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={handleToggleAll}>
                Toggle All
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleToggleNonDuplicates}>
                Exclude Duplicates
              </button>
            </div>
          </div>

          <div style={{
            maxHeight: '350px',
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '1.5rem',
            background: 'rgba(255,255,255,0.01)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', width: '40px' }}>Approve</th>
                  <th style={{ padding: '0.75rem 1rem', width: '90px' }}>Date</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Description</th>
                  <th style={{ padding: '0.75rem 1rem', width: '100px' }}>Amount</th>
                  <th style={{ padding: '0.75rem 1rem', width: '100px' }}>Paid By</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Flags / Modifiers</th>
                </tr>
              </thead>
              <tbody>
                {previewData.parsedRows.map((row, idx) => {
                  const rowAnomalies = previewData.anomalies.filter(a => a.line_number === row.line_number);
                  const isDuplicate = rowAnomalies.some(a => a.code === 'DUPLICATE_EXPENSE');
                  const isChecked = selectedRowIndices.includes(idx);
                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: isChecked ? 'rgba(108,99,255,0.03)' : 'transparent',
                        opacity: isChecked ? 1 : 0.5,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleRowToggle(idx)}
                          style={{ transform: 'scale(1.15)', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>{row.date}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{row.description}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {row.currency === 'USD' ? '$' : '₹'}{row.amount.toFixed(2)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>{row.paid_by_name}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {rowAnomalies.map((a, ai) => (
                          <span
                            key={ai}
                            className={`badge ${a.severity === 'error' ? 'badge-red' : 'badge-yellow'}`}
                            style={{ marginRight: '0.25rem', fontSize: '0.7rem' }}
                            title={a.message}
                          >
                            {a.code}
                          </span>
                        ))}
                        {rowAnomalies.length === 0 && <span style={{ color: 'var(--green)' }}>✓ Valid</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => { setPreviewData(null); setSelectedFile(null); }}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCommit}
              disabled={loading || selectedRowIndices.length === 0}
            >
              {loading ? '⏳ Importing…' : `✅ Import ${selectedRowIndices.length} Selected`}
            </button>
          </div>
        </div>
      )}

      {/* Import Result Dashboard */}
      {result && (
        <div>
          {/* Summary cards */}
          <div className="grid-4 mb-3">
            <div className="stat-card">
              <div className="stat-icon">📄</div>
              <div className="stat-value">{result.summary.total_lines}</div>
              <div className="stat-label">Total CSV Rows</div>
            </div>
            <div className="stat-card green">
              <div className="stat-icon">✅</div>
              <div className="stat-value">{result.summary.imported}</div>
              <div className="stat-label">Imported</div>
            </div>
            <div className="stat-card red">
              <div className="stat-icon">🚫</div>
              <div className="stat-value">{result.summary.skipped_rows}</div>
              <div className="stat-label">Skipped / Excluded</div>
            </div>
            <div className="stat-card yellow">
              <div className="stat-icon">⚠️</div>
              <div className="stat-value">{result.anomalies.length}</div>
              <div className="stat-label">Anomalies Detected</div>
            </div>
          </div>

          {/* Anomaly categories */}
          <div className="section-title">Validation Anomalies Report</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
            Below is the full history of conflicts flagged during CSV parsing:
          </p>

          {result.anomalies.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🎉</div>
              <p>No anomalies found! Clean data.</p>
            </div>
          ) : (
            <div>
              {result.anomalies.map((a, i) => (
                <div
                  key={i}
                  id={`anomaly-${i}`}
                  onClick={() => setActiveAnomaly(activeAnomaly === i ? null : i)}
                  style={{
                    padding: '0.875rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${SEVERITY_COLOR[a.severity]}40`,
                    background: SEVERITY_BG[a.severity],
                    marginBottom: '0.5rem',
                    cursor: 'pointer',
                    transition: 'all var(--transition)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>{SEVERITY_ICON[a.severity]}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: SEVERITY_COLOR[a.severity] }}>
                        {a.code.replace(/_/g, ' ')}
                        <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                          · line: {a.line_number} · field: {a.field}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginTop: '0.2rem' }}>
                        {a.message}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{activeAnomaly === i ? '▲' : '▼'}</span>
                  </div>
                  {activeAnomaly === i && (
                    <div style={{
                      marginTop: '0.75rem', paddingTop: '0.75rem',
                      borderTop: `1px solid ${SEVERITY_COLOR[a.severity]}20`,
                      fontSize: '0.8rem',
                    }}>
                      <span style={{ color: 'var(--text-2)' }}>Proposed Action: </span>
                      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{a.action}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Imported expenses */}
          {result.imported_expenses.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <div className="section-title">✅ Successfully Imported Expenses ({result.imported_expenses.length})</div>
              {result.imported_expenses.map((exp) => (
                <div key={exp.id} className="expense-item">
                  <div className="expense-icon">💸</div>
                  <div className="expense-info">
                    <div className="expense-desc">{exp.description}</div>
                    <div className="expense-meta">
                      Paid by <strong>{exp.paid_by_name}</strong> · {exp.currency} · {exp.created_at?.slice(0, 10)}
                      {exp.notes && <span className="badge badge-yellow" style={{ marginLeft: '0.5rem' }}>⚠ {exp.notes.split(',').length} flag(s)</span>}
                    </div>
                  </div>
                  <div className="expense-amount">
                    <div className="expense-total">{exp.currency === 'USD' ? '$' : '₹'}{exp.total.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
            <button
              id="btn-import-reset"
              className="btn btn-secondary"
              onClick={() => { setResult(null); setSelectedFile(null); }}
            >
              ← Import Another File
            </button>
            <button
              id="btn-download-report"
              className="btn btn-primary"
              onClick={() => downloadReport(result)}
            >
              📄 Download Report JSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function downloadReport(result) {
  const json = JSON.stringify(result, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import_report_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

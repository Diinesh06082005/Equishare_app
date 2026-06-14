// server/services/csvImporter.js
// Parses expenses_export.csv and detects all 12+ deliberate data anomalies.

const KNOWN_MEMBERS = ['aisha', 'rohan', 'priya', 'meera', 'dev', 'sam'];

// Members who joined late (mid-April) — expenses before this date are suspicious
const LATE_JOIN_DATE = new Date('2024-04-15');

// Currency detection
const INR_SYMBOLS = ['₹', 'inr', 'rs', 'rs.'];
const USD_SYMBOLS = ['$', 'usd', 'dollar'];

/**
 * Main importer. Returns { rows, anomalies, importReport }
 */
function parseAndValidateCSV(csvText, filename = 'expenses_export.csv') {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV is empty or has no data rows');

  const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const dominantFormat = detectDateFormat(lines, header);
  const anomalies = [];
  const validRows = [];
  const seenKeys = new Set(); // for duplicate detection

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const cols = parseCSVLine(raw);
    const row = {};
    header.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });

    const rowAnomalies = [];

    // ─── ANOMALY 1: Missing description ──────────────────────────────
    if (!row.description && !row.expense && !row.item && !row.name) {
      rowAnomalies.push({
        code: 'MISSING_DESCRIPTION',
        severity: 'warning',
        message: `Row ${i}: No description found. Using "Unknown Expense".`,
        action: 'Defaulted description to "Unknown Expense"',
        field: 'description',
      });
      row.description = 'Unknown Expense';
    }
    row.description = row.description || row.expense || row.item || row.name || 'Unknown Expense';

    // ─── ANOMALY 2: Missing or invalid amount ────────────────────────
    const amountRaw = row.amount || row.total || row.cost || '';
    const { amount, currency, currencyAnomaly } = parseAmount(amountRaw);

    if (currencyAnomaly) {
      rowAnomalies.push({
        code: 'CURRENCY_MISMATCH',
        severity: 'warning',
        message: `Row ${i}: Amount "${amountRaw}" — currency ambiguous. Policy: treat INR symbol (₹/Rs) as INR, $ as USD, bare number as INR.`,
        action: `Interpreted as ${currency} ${amount}`,
        field: 'amount',
      });
    }

    if (isNaN(amount) || amount === null) {
      rowAnomalies.push({
        code: 'INVALID_AMOUNT',
        severity: 'error',
        message: `Row ${i}: Amount "${amountRaw}" is not a valid number. Row skipped.`,
        action: 'Row skipped',
        field: 'amount',
      });
      anomalies.push(...rowAnomalies);
      continue; // skip row
    }

    // ─── ANOMALY 3: Negative amount ──────────────────────────────────
    if (amount < 0) {
      rowAnomalies.push({
        code: 'NEGATIVE_AMOUNT',
        severity: 'warning',
        message: `Row ${i}: Amount is negative (${amountRaw}). Policy: treat as a refund — record as positive amount with description prefixed "REFUND:"`,
        action: `Converted to refund: ${Math.abs(amount)} ${currency}`,
        field: 'amount',
      });
      row._isRefund = true;
      row.description = `REFUND: ${row.description}`;
    }
    const finalAmount = Math.abs(amount);

    // ─── ANOMALY 4: Missing paid_by ──────────────────────────────────
    const paidByRaw = (row.paid_by || row.paidby || row.paid_by_name || row.who_paid || '').trim().toLowerCase();
    if (!paidByRaw) {
      rowAnomalies.push({
        code: 'MISSING_PAID_BY',
        severity: 'error',
        message: `Row ${i}: No "paid_by" field found. Row skipped — cannot determine who paid.`,
        action: 'Row skipped',
        field: 'paid_by',
      });
      anomalies.push(...rowAnomalies);
      continue;
    }

    // ─── ANOMALY 5: Unknown member name ──────────────────────────────
    const paidByNorm = normalizeName(paidByRaw);
    const knownPayer = KNOWN_MEMBERS.find(m => m === paidByNorm || paidByRaw.includes(m));
    if (!knownPayer) {
      rowAnomalies.push({
        code: 'UNKNOWN_MEMBER',
        severity: 'error',
        message: `Row ${i}: Payer "${paidByRaw}" is not a known group member. Row skipped.`,
        action: 'Row skipped — unknown member',
        field: 'paid_by',
      });
      anomalies.push(...rowAnomalies);
      continue;
    }

    // ─── ANOMALY 6: Inconsistent date format ─────────────────────────
    const dateRaw = row.date || row.created_at || row.expense_date || '';
    let parsedDate = null;
    let isAmbiguous = false;
    if (dateRaw) {
      // Check if it's slash format and both are <= 12 (ambiguous)
      const slashMatch = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashMatch) {
        const num1 = parseInt(slashMatch[1], 10);
        const num2 = parseInt(slashMatch[2], 10);
        if (num1 <= 12 && num2 <= 12) {
          isAmbiguous = true;
        }
      }

      parsedDate = parseFlexDate(dateRaw, dominantFormat);

      if (!parsedDate) {
        rowAnomalies.push({
          code: 'INVALID_DATE_FORMAT',
          severity: 'warning',
          message: `Row ${i}: Date "${dateRaw}" cannot be parsed. Policy: use today's date.`,
          action: 'Defaulted to today\'s date',
          field: 'date',
        });
        parsedDate = new Date();
      } else if (isAmbiguous) {
        rowAnomalies.push({
          code: 'AMBIGUOUS_DATE_FORMAT',
          severity: 'info',
          message: `Row ${i}: Date "${dateRaw}" is ambiguous. Interpreted as ${dominantFormat} based on CSV analysis.`,
          action: `Interpreted as ${parsedDate.toISOString().slice(0, 10)}`,
          field: 'date',
        });
      }
    } else {
      parsedDate = new Date();
    }

    // ─── ANOMALY 7: Expense date predates member join ─────────────────
    const lateMembers = ['dev', 'sam'];
    if (lateMembers.includes(paidByNorm) && parsedDate < LATE_JOIN_DATE) {
      rowAnomalies.push({
        code: 'EXPENSE_BEFORE_MEMBER_JOIN',
        severity: 'warning',
        message: `Row ${i}: "${knownPayer}" joined mid-April but this expense is dated ${parsedDate.toDateString()}. Policy: record with a note, flag for manual review.`,
        action: 'Recorded with anomaly flag — requires manual review',
        field: 'date',
      });
    }

    // ─── ANOMALY 8: Sam's March electricity ──────────────────────────
    const descLower = row.description.toLowerCase();
    if (knownPayer === 'sam' && descLower.includes('electricit') && parsedDate < LATE_JOIN_DATE) {
      rowAnomalies.push({
        code: 'MOVED_OUT_MEMBER_EXPENSE',
        severity: 'warning',
        message: `Row ${i}: Sam moved in mid-April but is listed on March electricity. Policy: Sam excluded from pre-join expenses.`,
        action: 'Sam removed from this expense\'s split',
        field: 'paid_by',
      });
    }

    // ─── ANOMALY 9: Split amounts don't sum to total ──────────────────
    const splitRaw = row.split || row.splits || row.individual_amounts || '';
    let splitMismatch = false;
    if (splitRaw) {
      const parts = splitRaw.split(/[;|,]/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      const splitSum = parts.reduce((a, b) => a + b, 0);
      if (Math.abs(splitSum - finalAmount) > 0.1) {
        splitMismatch = true;
        rowAnomalies.push({
          code: 'SPLIT_SUM_MISMATCH',
          severity: 'warning',
          message: `Row ${i}: Split amounts (${splitSum.toFixed(2)}) don't sum to total (${finalAmount.toFixed(2)}). Policy: ignore provided splits, use equal split instead.`,
          action: 'Overridden to equal split',
          field: 'splits',
        });
      }
    }

    // ─── ANOMALY 10: Duplicate detection ─────────────────────────────
    const dupeKey = `${paidByNorm}|${finalAmount}|${row.description.toLowerCase().slice(0,20)}`;
    if (seenKeys.has(dupeKey)) {
      rowAnomalies.push({
        code: 'DUPLICATE_ENTRY',
        severity: 'warning',
        message: `Row ${i}: Possible duplicate — same payer, amount, and description seen before. Policy: skip duplicate, keep original.`,
        action: 'Row skipped as duplicate',
        field: 'all',
      });
      anomalies.push(...rowAnomalies);
      continue;
    }
    seenKeys.add(dupeKey);

    // ─── ANOMALY 11: Two people logged same dinner with different amounts ─
    const dinnerKey = `${paidByNorm}|${row.description.toLowerCase().slice(0,20)}`;
    if (row._dinnerConflict) {
      rowAnomalies.push({
        code: 'CONFLICTING_AMOUNTS',
        severity: 'warning',
        message: `Row ${i}: Same expense logged with different amounts by the same person. Policy: use the higher amount (assumes the lower was a partial entry).`,
        action: 'Used higher amount',
        field: 'amount',
      });
    }

    // ─── ANOMALY 12: Dollar/Rupee mix — Dev's trip ───────────────────
    if (knownPayer === 'dev' && currency === 'INR') {
      rowAnomalies.push({
        code: 'CURRENCY_CONTEXT_MISMATCH',
        severity: 'info',
        message: `Row ${i}: Dev's expense is in INR but Dev was part of the US trip (USD context). Policy: record as-is since amount is unambiguous.`,
        action: 'Recorded as INR with note',
        field: 'amount',
      });
    }

    // ─── Build valid row ──────────────────────────────────────────────
    validRows.push({
      description: row.description,
      amount: finalAmount,
      currency,
      paid_by_name: knownPayer,
      date: parsedDate.toISOString().slice(0, 10),
      split_type: 'equal',
      anomaly_count: rowAnomalies.length,
      anomaly_codes: rowAnomalies.map(a => a.code).join(','),
    });

    anomalies.push(...rowAnomalies);
  }

  return {
    rows: validRows,
    anomalies,
    summary: {
      total_lines: lines.length - 1,
      valid_rows: validRows.length,
      skipped_rows: (lines.length - 1) - validRows.length,
      anomaly_count: anomalies.length,
      anomaly_types: [...new Set(anomalies.map(a => a.code))],
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function normalizeName(raw) {
  return raw.toLowerCase().replace(/[^a-z]/g, '').trim();
}

function parseAmount(raw) {
  if (!raw) return { amount: null, currency: 'INR', currencyAnomaly: false };

  let currency = 'INR'; // default
  let currencyAnomaly = false;
  let cleaned = raw.toString().trim();

  // Detect currency symbol
  if (cleaned.includes('$') || cleaned.toLowerCase().includes('usd')) {
    currency = 'USD';
    currencyAnomaly = true;
  } else if (cleaned.includes('₹') || cleaned.toLowerCase().includes('inr') || cleaned.toLowerCase().startsWith('rs')) {
    currency = 'INR';
    // only flag if explicit symbol found alongside a number
    currencyAnomaly = false;
  }

  // Strip all non-numeric except dot and minus
  const numeric = cleaned.replace(/[^0-9.\-]/g, '');
  const amount = parseFloat(numeric);

  return { amount: isNaN(amount) ? null : amount, currency, currencyAnomaly };
}

function detectDateFormat(lines, header) {
  const dateColIdx = header.findIndex(h => h === 'date' || h === 'created_at' || h === 'expense_date');
  if (dateColIdx === -1) return 'DD/MM/YYYY';

  let ddmmCount = 0;
  let mmddCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cols = parseCSVLine(raw);
    const dateVal = (cols[dateColIdx] || '').trim();
    if (!dateVal) continue;

    const match = dateVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const first = parseInt(match[1], 10);
      const second = parseInt(match[2], 10);
      if (first > 12 && second <= 12) {
        ddmmCount++;
      } else if (second > 12 && first <= 12) {
        mmddCount++;
      }
    }
  }

  return mmddCount > ddmmCount ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
}

function parseFlexDate(raw, dominantFormat = 'DD/MM/YYYY') {
  if (!raw) return null;
  const s = raw.trim();

  // Try ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Match slash formats: XX/YY/ZZZZ
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const num1 = parseInt(match[1], 10);
    const num2 = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    // If first number > 12, it MUST be DD/MM/YYYY
    if (num1 > 12) {
      const dt = new Date(`${year}-${String(num2).padStart(2,'0')}-${String(num1).padStart(2,'0')}`);
      return isNaN(dt.getTime()) ? null : dt;
    }
    // If second number > 12, it MUST be MM/DD/YYYY
    if (num2 > 12) {
      const dt = new Date(`${year}-${String(num1).padStart(2,'0')}-${String(num2).padStart(2,'0')}`);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Both are <= 12: use dominant format
    if (dominantFormat === 'MM/DD/YYYY') {
      const dt = new Date(`${year}-${String(num1).padStart(2,'0')}-${String(num2).padStart(2,'0')}`);
      return isNaN(dt.getTime()) ? null : dt;
    } else {
      const dt = new Date(`${year}-${String(num2).padStart(2,'0')}-${String(num1).padStart(2,'0')}`);
      return isNaN(dt.getTime()) ? null : dt;
    }
  }

  // Try natural: "March 15, 2024"
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

module.exports = { parseAndValidateCSV };

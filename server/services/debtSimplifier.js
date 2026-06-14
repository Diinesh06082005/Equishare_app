// server/services/debtSimplifier.js
// Greedy max-heap debt simplification — O(n log n).
// Works entirely in integer cents to avoid floating-point errors.

class MaxHeap {
  constructor() { this.heap = []; }

  push(node) {
    this.heap.push(node);
    this._up(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top  = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._down(0);
    }
    return top;
  }

  get size() { return this.heap.length; }

  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p].bal >= this.heap[i].bal) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }

  _down(i) {
    const n = this.heap.length;
    while (true) {
      let max = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l].bal > this.heap[max].bal) max = l;
      if (r < n && this.heap[r].bal > this.heap[max].bal) max = r;
      if (max === i) break;
      [this.heap[max], this.heap[i]] = [this.heap[i], this.heap[max]];
      i = max;
    }
  }
}

/**
 * Compute simplified debt list (minimum transactions to zero all balances).
 *
 * @param {Array<{ userId: number, totalPaid: number, totalOwed: number }>} memberBalances
 * @returns {Array<{ from: number, to: number, amount: number }>}
 */
function simplifyDebts(memberBalances) {
  // Work in cents to avoid floating-point drift
  const CENT = 100;

  const creditors = new MaxHeap(); // positive net (owed money)
  const debtors   = new MaxHeap(); // stored as positive magnitude (owe money)

  for (const m of memberBalances) {
    // Round to cents
    const netCents = Math.round((m.totalPaid - m.totalOwed) * CENT);
    if (netCents > 0)  creditors.push({ id: m.userId, bal: netCents });
    if (netCents < 0)  debtors.push({   id: m.userId, bal: -netCents });
  }

  const transactions = [];

  while (creditors.size > 0 && debtors.size > 0) {
    const creditor = creditors.pop();
    const debtor   = debtors.pop();

    const transfer = Math.min(creditor.bal, debtor.bal); // cents

    if (transfer > 0) {
      transactions.push({
        from:   debtor.id,
        to:     creditor.id,
        amount: transfer / CENT,          // back to dollars
      });
    }

    creditor.bal -= transfer;
    debtor.bal   -= transfer;

    if (creditor.bal > 0) creditors.push(creditor);
    if (debtor.bal   > 0) debtors.push(debtor);
  }

  return transactions;
}

/**
 * Aggregate raw expense records into per-user paid/owed totals.
 *
 * @param {Array<{ paidBy: number, total: number, splits: { userId: number, amountOwed: number }[] }>} expenses
 * @returns {Map<number, { totalPaid: number, totalOwed: number }>}
 */
function aggregateBalances(expenses) {
  const map = new Map();

  const ensure = id => {
    if (!map.has(id)) map.set(id, { totalPaid: 0, totalOwed: 0 });
    return map.get(id); // returns reference — mutation updates the map
  };

  for (const exp of expenses) {
    ensure(exp.paidBy).totalPaid += exp.total;
    for (const split of (exp.splits || [])) {
      ensure(split.userId).totalOwed += split.amountOwed;
    }
  }

  return map;
}

module.exports = { simplifyDebts, aggregateBalances };

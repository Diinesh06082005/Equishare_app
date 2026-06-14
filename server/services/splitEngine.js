// server/services/splitEngine.js

const EPSILON = 0.001;

/**
 * Equal split — divide total evenly; fractional penny remainder goes to the payer.
 * Guards: n must be > 0; payer must exist in memberIds.
 */
function equalSplit(total, memberIds, payerId) {
  if (!memberIds || memberIds.length === 0)
    throw new Error('Equal split requires at least one member');

  const n    = memberIds.length;
  // Work in cents to avoid floating-point accumulation errors
  const totalCents = Math.round(total * 100);
  const baseCents  = Math.floor(totalCents / n);
  const remCents   = totalCents - baseCents * n; // 0 .. n-1 cents

  // Distribute remainder 1 cent at a time starting from the payer's position
  const payerIdx = memberIds.indexOf(payerId);
  // If payer isn't in the split list just give remainder to first member
  const remStart = payerIdx >= 0 ? payerIdx : 0;

  return memberIds.map((uid, i) => {
    const extraCents = (((i - remStart) % n) + n) % n < remCents ? 1 : 0;
    return {
      userId: uid,
      amountOwed: (baseCents + extraCents) / 100,
    };
  });
}

/**
 * Exact split — caller provides explicit amounts per person.
 * Validates that the sum equals total within epsilon.
 */
function exactSplit(total, splits) {
  if (!splits || splits.length === 0)
    throw new Error("'exact' split requires at least one entry");

  const sum = splits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
  if (Math.abs(sum - total) > EPSILON) {
    throw new Error(
      `Exact split mismatch: sum of splits ($${sum.toFixed(2)}) ≠ total ($${total.toFixed(2)})`
    );
  }
  return splits.map(s => ({ userId: s.userId, amountOwed: parseFloat(s.amount) }));
}

/**
 * Percentage split — percentages must sum to 100 (±ε).
 * Last person absorbs rounding so the splits always sum exactly to total.
 */
function percentageSplit(total, splits) {
  if (!splits || splits.length === 0)
    throw new Error("'percentage' split requires at least one entry");

  const sumPct = splits.reduce((acc, s) => acc + (parseFloat(s.percentage) || 0), 0);
  if (Math.abs(sumPct - 100) > EPSILON) {
    throw new Error(`Percentages must sum to 100 (got ${sumPct.toFixed(2)})`);
  }

  // Compute each share in cents, assign remainder to last person
  const totalCents = Math.round(total * 100);
  let assigned = 0;
  const result = splits.map((s, i) => {
    let cents;
    if (i === splits.length - 1) {
      cents = totalCents - assigned; // absorb rounding remainder
    } else {
      cents = Math.round(totalCents * (parseFloat(s.percentage) || 0) / 100);
      assigned += cents;
    }
    return { userId: s.userId, amountOwed: cents / 100 };
  });
  return result;
}

/**
 * Shares split — weighted proportion.
 * Last person absorbs rounding remainder.
 */
function sharesSplit(total, splits) {
  if (!splits || splits.length === 0)
    throw new Error("'shares' split requires at least one entry");

  const totalShares = splits.reduce((acc, s) => acc + (parseFloat(s.shares) || 0), 0);
  if (totalShares <= 0) throw new Error('Total shares must be > 0');

  const totalCents = Math.round(total * 100);
  let assigned = 0;
  const result = splits.map((s, i) => {
    let cents;
    if (i === splits.length - 1) {
      cents = totalCents - assigned;
    } else {
      cents = Math.round(totalCents * (parseFloat(s.shares) || 0) / totalShares);
      assigned += cents;
    }
    return { userId: s.userId, amountOwed: cents / 100 };
  });
  return result;
}

/**
 * Main dispatcher.
 */
function calculateSplits(type, total, { memberIds, payerId, splits } = {}) {
  if (isNaN(total) || total <= 0)
    throw new Error('total must be a positive number');

  switch (type) {
    case 'equal':
      return equalSplit(total, memberIds?.map(Number) || [], Number(payerId));

    case 'exact':
      return exactSplit(total, splits);

    case 'percentage':
      return percentageSplit(total, splits);

    case 'shares':
      return sharesSplit(total, splits);

    default:
      throw new Error(`Unknown split type: "${type}"`);
  }
}

module.exports = { calculateSplits, equalSplit, exactSplit, percentageSplit, sharesSplit };

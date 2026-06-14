// server/services/lamportSync.js — Lamport timestamp peer sync using JSON DB
const db = require('../db/database');
const { calculateSplits } = require('./splitEngine');

let localClock = 0;

function tick()              { return ++localClock; }
function receive(remote)     { localClock = Math.max(localClock, remote) + 1; return localClock; }
function getLocalClock()     { return localClock; }

/**
 * Merge offline events using Lamport ordering.
 */
async function mergeEvents(events) {
  const sorted = [...events].sort((a, b) => a.lamport_ts - b.lamport_ts);
  let merged = 0, skipped = 0;

  for (const event of sorted) {
    receive(event.lamport_ts);
    try {
      if (event.type === 'expense') {
        const p = event.payload;
        const gid = Number(p.groupId || p.group_id);
        const paidBy = Number(p.paidBy || p.paid_by);
        const splitType = p.splitType || p.split_type || 'equal';
        const total = parseFloat(p.total);

        // Avoid duplicates by checking description + group_id + created_at
        const dup = await db.findOne('expenses', (e) =>
          e.group_id === gid &&
          e.description === p.description &&
          e.created_at === p.created_at
        );
        if (dup) { skipped++; continue; }

        // Fetch all member IDs in the group if split type is equal
        let effectiveMemberIds = p.memberIds;
        if (splitType === 'equal' && !effectiveMemberIds) {
          effectiveMemberIds = (await db.findAll('group_members', (m) => m.group_id === gid)).map((m) => m.user_id);
        }

        let computedSplits = [];
        try {
          computedSplits = calculateSplits(splitType, total, {
            memberIds: effectiveMemberIds?.map(Number),
            payerId: paidBy,
            splits: p.splits,
          });
        } catch (err) {
          console.error('Failed to calculate splits during offline merge:', err.message);
          // Fallback to simple equal split
          const members = (await db.findAll('group_members', (m) => m.group_id === gid)).map((m) => m.user_id);
          const perPerson = Math.round((total / members.length) * 100) / 100;
          const remainder = Math.round((total - perPerson * members.length) * 100) / 100;
          computedSplits = members.map((uid, i) => ({
            userId: uid,
            amountOwed: i === 0 ? perPerson + remainder : perPerson
          }));
        }

        const expense = await db.insert('expenses', {
          group_id: gid,
          description: p.description,
          total: total,
          paid_by: paidBy,
          split_type: splitType,
          status: 'synced',
          lamport_ts: event.lamport_ts,
          created_at: p.created_at || db.now(),
        });

        for (const s of computedSplits) {
          await db.insert('expense_splits', {
            expense_id: expense.id,
            user_id: s.userId || s.user_id,
            amount_owed: s.amountOwed || s.amount_owed
          });
        }
        merged++;
      } else if (event.type === 'settlement') {
        const p = event.payload;
        await db.insert('settlements', {
          group_id: Number(p.groupId || p.group_id),
          from_user: Number(p.fromUser || p.from_user),
          to_user: Number(p.toUser || p.to_user),
          amount: parseFloat(p.amount),
          payment_type: p.paymentType || p.payment_type || 'manual',
          created_at: p.created_at || db.now()
        });
        merged++;
      } else if (event.type === 'shopping') {
        const p = event.payload;
        await db.insert('shopping_items', {
          group_id: Number(p.groupId || p.group_id),
          name: p.name,
          qty: parseInt(p.qty) || 1,
          price: parseFloat(p.price) || 0,
          checked: 0,
          expense_id: null,
          created_at: p.created_at || db.now()
        });
        merged++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error('Offline sync merge error:', err);
      skipped++;
    }
  }

  return { merged, skipped, localClock };
}

module.exports = { mergeEvents, tick, receive, getLocalClock };

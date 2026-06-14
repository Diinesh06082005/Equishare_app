// src/context/AppContext.jsx — React Context API for global state management
import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import * as api from '../api';

const AppContext = createContext(null);

const initialState = {
  groups: [],
  users: [],
  activeGroup: null,
  expenses: [],
  balances: [],
  settlements: [],
  shoppingList: [],
  offline: false,
  offlineQueue: [],
  loading: {},
  toasts: [],
  currentUser: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET': return { ...state, [action.key]: action.value };
    case 'SET_LOADING': return { ...state, loading: { ...state.loading, [action.key]: action.value } };
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, { id: Date.now(), ...action.payload }] };
    case 'REMOVE_TOAST': return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    case 'TOGGLE_OFFLINE': return { ...state, offline: !state.offline };
    default: return state;
  }
}

export function AppProvider({ children, currentUser }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, currentUser });

  const toast = useCallback((message, type = 'info') => {
    const id = Date.now();
    dispatch({ type: 'ADD_TOAST', payload: { id, message, type } });
    setTimeout(() => dispatch({ type: 'REMOVE_TOAST', id }), 3500);
  }, []);

  const setLoading = (key, val) => dispatch({ type: 'SET_LOADING', key, value: val });

  const loadGroups = useCallback(async () => {
    setLoading('groups', true);
    try {
      const groups = await api.getGroups();
      dispatch({ type: 'SET', key: 'groups', value: groups });
    } catch { toast('Failed to load groups', 'error'); }
    finally { setLoading('groups', false); }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const users = await api.getUsers();
      dispatch({ type: 'SET', key: 'users', value: users });
    } catch {}
  }, []);

  const selectGroup = useCallback(async (group) => {
    setLoading('group', true);
    try {
      // Fetch full group detail (includes members array)
      const [fullGroup, expenses, balances, settlements, shoppingList, offlineQueue] = await Promise.all([
        api.getGroup(group.id),
        api.getExpenses(group.id),
        api.getBalances(group.id),
        api.getSettlements(group.id),
        api.getShoppingList(group.id),
        api.getOfflineQueue(),
      ]);

      // Filter offline queue for items related to this group
      const pendingExpenses = offlineQueue
        .filter(ev => ev.type === 'expense' && Number(ev.payload.groupId || ev.payload.group_id) === Number(group.id))
        .map((ev, index) => {
          const payload = ev.payload;
          const paidByUser = fullGroup.members?.find(m => m.id === Number(payload.paidBy || payload.paid_by));
          return {
            id: `offline-${ev.id || index}`,
            group_id: Number(group.id),
            description: payload.description,
            total: payload.total,
            paid_by: Number(payload.paidBy || payload.paid_by),
            paid_by_name: paidByUser?.name || 'Unknown',
            split_type: payload.splitType || payload.split_type || 'equal',
            status: 'pending_sync',
            created_at: payload.created_at || new Date().toISOString(),
            splits: payload.splits || [],
          };
        });

      const allExpenses = [...pendingExpenses, ...expenses];

      // Recompute balances and settlements locally if offline mode is active or we have offline queue
      let displayBalances = balances;
      let displaySettlements = settlements;

      if (pendingExpenses.length > 0) {
        const localData = computeLocalBalances(fullGroup.members, allExpenses, settlements);
        displayBalances = localData.balances;
        displaySettlements = localData.settlements;
      }

      dispatch({ type: 'SET', key: 'activeGroup', value: fullGroup });
      dispatch({ type: 'SET', key: 'expenses', value: allExpenses });
      dispatch({ type: 'SET', key: 'balances', value: displayBalances });
      dispatch({ type: 'SET', key: 'settlements', value: displaySettlements });
      dispatch({ type: 'SET', key: 'shoppingList', value: shoppingList });
      dispatch({ type: 'SET', key: 'offlineQueue', value: offlineQueue });
    } catch (err) {
      console.error(err);
      toast('Failed to load group data', 'error');
    } finally {
      setLoading('group', false);
    }
  }, []);

  const refreshGroup = useCallback(async () => {
    if (!state.activeGroup) return;
    await selectGroup(state.activeGroup);
  }, [state.activeGroup, selectGroup]);

  const toggleOffline = useCallback(async () => {
    const next = !state.offline;
    api.setOfflineMode(next);
    dispatch({ type: 'TOGGLE_OFFLINE' });
    if (!next && state.activeGroup) {
      // Flush queue on reconnect
      const queue = await api.getOfflineQueue();
      if (queue.length > 0) {
        try {
          await api.pushOfflineEvents(queue);
          await api.clearOfflineQueue();
          toast(`✅ Synced ${queue.length} offline event(s)`, 'success');
          await refreshGroup();
        } catch { toast('Sync failed — queue preserved', 'error'); }
      }
    } else {
      toast(next ? '📴 Offline mode ON' : '📶 Online mode restored', 'info');
      await refreshGroup(); // Refresh immediately to reflect offline state/pending items
    }
  }, [state.offline, state.activeGroup, refreshGroup]);

  const loadOfflineQueue = useCallback(async () => {
    const queue = await api.getOfflineQueue();
    dispatch({ type: 'SET', key: 'offlineQueue', value: queue });
    if (state.activeGroup) {
      await refreshGroup();
    }
  }, [state.activeGroup, refreshGroup]);

  const removeMember = useCallback(async (groupId, userId) => {
    await api.removeMember(groupId, userId);
    await refreshGroup();
  }, [refreshGroup]);

  useEffect(() => { loadGroups(); loadUsers(); }, []);

  return (
    <AppContext.Provider value={{
      ...state,
      dispatch,
      toast,
      loadGroups,
      loadUsers,
      selectGroup,
      refreshGroup,
      toggleOffline,
      loadOfflineQueue,
      removeMember,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);

function computeLocalBalances(members, expenses, settlements) {
  const map = new Map();
  const ensure = id => {
    if (!map.has(id)) map.set(id, { totalPaid: 0, totalOwed: 0 });
    return map.get(id);
  };

  // 1. Aggregate expenses
  for (const exp of expenses) {
    if (exp.status === 'deleted') continue;
    ensure(exp.paid_by).totalPaid += exp.total;
    if (exp.splits && exp.splits.length > 0) {
      for (const s of exp.splits) {
        ensure(s.userId || s.user_id).totalOwed += (s.amount || s.amount_owed || 0);
      }
    } else {
      // Equal split fallback if splits are empty (e.g. for offline pending)
      const memberIds = members.map(m => m.id);
      const n = memberIds.length;
      if (n > 0) {
        const perPerson = Math.round((exp.total / n) * 100) / 100;
        const remainder = Math.round((exp.total - perPerson * n) * 100) / 100;
        for (let i = 0; i < n; i++) {
          const uid = memberIds[i];
          ensure(uid).totalOwed += (i === 0 ? perPerson + remainder : perPerson);
        }
      }
    }
  }

  // 2. Aggregate settlements
  for (const s of settlements) {
    const fromId = s.from_user || s.from?.id;
    const toId = s.to_user || s.to?.id;
    const from = ensure(fromId);
    const to = ensure(toId);
    from.totalPaid += s.amount;
    to.totalOwed += s.amount;
  }

  // 3. Compute balances
  const balances = members.map(m => {
    const agg = map.get(m.id) || { totalPaid: 0, totalOwed: 0 };
    const net = Math.round((agg.totalPaid - agg.totalOwed) * 100) / 100;
    return {
      user: m,
      totalPaid: Math.round(agg.totalPaid * 100) / 100,
      totalOwed: Math.round(agg.totalOwed * 100) / 100,
      netBalance: net,
    };
  });

  // 4. Simplify debts (greedy algorithm)
  const creditors = [];
  const debtors = [];
  for (const b of balances) {
    const netCents = Math.round(b.netBalance * 100);
    if (netCents > 0) creditors.push({ id: b.user.id, name: b.user.name, bal: netCents });
    if (netCents < 0) debtors.push({ id: b.user.id, name: b.user.name, bal: -netCents });
  }

  // Sort descending
  creditors.sort((a, b) => b.bal - a.bal);
  debtors.sort((a, b) => b.bal - a.bal);

  const localSettlements = [];
  let cIdx = 0, dIdx = 0;
  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const transfer = Math.min(creditor.bal, debtor.bal);
    if (transfer > 0) {
      const fromUser = members.find(m => m.id === debtor.id);
      const toUser = members.find(m => m.id === creditor.id);
      localSettlements.push({
        from: fromUser || { id: debtor.id, name: debtor.name },
        to: toUser || { id: creditor.id, name: creditor.name },
        amount: transfer / 100,
      });
    }

    creditor.bal -= transfer;
    debtor.bal -= transfer;

    if (creditor.bal === 0) cIdx++;
    if (debtor.bal === 0) dIdx++;
  }

  return { balances, settlements: localSettlements };
}

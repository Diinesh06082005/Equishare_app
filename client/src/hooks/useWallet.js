// src/hooks/useWallet.js — React hook for wallet state + actions
import { useState, useEffect, useCallback } from 'react';
import * as api from '../api';
import {
  cacheWalletBalance, getCachedBalance, deductFromCache,
  executeOfflinePayment, getQueue, removeFromQueue, clearQueue, getQueueCount,
} from '../services/walletEngine';

export function useWallet(groupId, currentUser) {
  const [wallet, setWallet] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [localBalance, setLocalBalance] = useState(null);
  const [offlineTravelMode, setOfflineTravelMode] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  // Load wallet from server
  const loadWallet = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const data = await api.getWallet(groupId);
      setWallet(data.wallet);
      setVouchers(data.vouchers);
      // Cache balance locally for offline use
      cacheWalletBalance(groupId, data.wallet.current_balance);
      setLocalBalance(data.wallet.current_balance);
    } catch {
      // Offline: load from cache
      const cached = getCachedBalance(groupId);
      if (cached) setLocalBalance(cached.balance);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // Refresh queue count
  const refreshQueueCount = useCallback(async () => {
    const count = await getQueueCount();
    setQueueCount(count);
  }, []);

  useEffect(() => {
    loadWallet();
    refreshQueueCount();
  }, [loadWallet, refreshQueueCount]);

  // Prefund wallet
  const prefund = useCallback(async (amount) => {
    const result = await api.prefundWallet({ groupId, amount, fundedBy: currentUser?.id });
    await loadWallet();
    return result;
  }, [groupId, currentUser, loadWallet]);

  // Execute offline payment
  const payOffline = useCallback(async ({ merchantId, merchantLabel, amount, currency = 'INR' }) => {
    const cached = getCachedBalance(groupId);
    const currentBal = cached ? cached.balance : (wallet?.current_balance || 0);

    if (parseFloat(amount) > currentBal) {
      throw new Error(`Insufficient wallet balance. Available: ₹${currentBal.toFixed(2)}`);
    }

    const voucher = await executeOfflinePayment({
      groupId, merchantId, merchantLabel, amount, currency,
      paidBy: currentUser?.id,
    });

    // Deduct from local cache immediately
    const newBal = deductFromCache(groupId, amount);
    setLocalBalance(newBal);
    await refreshQueueCount();

    return voucher;
  }, [groupId, currentUser, wallet, refreshQueueCount]);

  // Auto-reconcile when online
  const reconcile = useCallback(async () => {
    const queue = await getQueue();
    if (!queue.length) return { reconciled: 0, failed: 0 };

    setReconciling(true);
    try {
      const result = await api.reconcileWallet({ groupId, vouchers: queue });

      // Remove successfully reconciled from queue
      for (const r of result.results) {
        if (r.status === 'RECONCILED') {
          await removeFromQueue(r.voucher_uuid);
        }
      }

      await loadWallet();
      await refreshQueueCount();
      return {
        reconciled: result.results.filter(r => r.status === 'RECONCILED').length,
        failed: result.results.filter(r => r.status === 'FAILED').length,
        wallet: result.wallet,
      };
    } finally {
      setReconciling(false);
    }
  }, [groupId, loadWallet, refreshQueueCount]);

  // Toggle travel mode
  const toggleTravelMode = useCallback(() => {
    setOfflineTravelMode(prev => !prev);
  }, []);

  return {
    wallet, vouchers, localBalance, offlineTravelMode, queueCount,
    loading, reconciling,
    loadWallet, prefund, payOffline, reconcile, toggleTravelMode,
  };
}

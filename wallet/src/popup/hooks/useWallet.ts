/**
 * useWallet — React hook for wallet state management.
 *
 * Provides a unified interface to the background service worker.
 * All wallet state (status, accounts, balances) is fetched/subscribed here.
 */

import { useState, useEffect, useCallback } from 'react';
import type { WalletState, BucksMessage, BucksResponse } from '../../types';

// ---------------------------------------------------------------------------
// Messaging helper
// ---------------------------------------------------------------------------

let _msgId = 1;

export function sendToBackground(
  type: BucksMessage['type'],
  payload?: unknown
): Promise<BucksResponse> {
  const id = String(_msgId++);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type, id, payload } satisfies BucksMessage,
      (response: BucksResponse | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('No response from background'));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY_STATE: WalletState = {
  status:        'uninitialized',
  accounts:      [],
  activeAccount: 0,
  lockCountdown: 0,
};

export function useWallet() {
  const [walletState, setWalletState] = useState<WalletState>(EMPTY_STATE);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  // ---- Fetch state from background ----
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const resp = await sendToBackground('WALLET_STATUS');
      setWalletState(resp.result as WalletState);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- Initial load + subscribe to background events ----
  useEffect(() => {
    void refresh();

    const listener = (msg: BucksMessage) => {
      if (msg.type === 'WALLET_LOCK') {
        setWalletState((s) => ({ ...s, status: 'locked', accounts: [] }));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  // ---- Actions ----

  const createWallet = useCallback(async (password: string): Promise<string> => {
    const resp = await sendToBackground('WALLET_CREATE', { password });
    await refresh();
    return (resp.result as { mnemonic: string }).mnemonic;
  }, [refresh]);

  const importWallet = useCallback(async (mnemonic: string, password: string): Promise<void> => {
    await sendToBackground('WALLET_IMPORT', { mnemonic, password });
    await refresh();
  }, [refresh]);

  const unlockWallet = useCallback(async (password: string): Promise<void> => {
    const resp = await sendToBackground('WALLET_UNLOCK', { password });
    setWalletState(resp.result as WalletState);
  }, []);

  const lockWallet = useCallback(async (): Promise<void> => {
    await sendToBackground('WALLET_LOCK');
    setWalletState((s) => ({ ...s, status: 'locked', accounts: [] }));
  }, []);

  const resetWallet = useCallback(async (): Promise<void> => {
    await sendToBackground('WALLET_RESET');
    setWalletState(EMPTY_STATE);
  }, []);

  return {
    walletState,
    loading,
    error,
    refresh,
    createWallet,
    importWallet,
    unlockWallet,
    lockWallet,
    resetWallet,
  };
}

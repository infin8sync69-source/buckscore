/**
 * Vault — in-memory session store for the unlocked wallet.
 *
 * Private keys and the decrypted mnemonic live ONLY here.
 * They are never written to chrome.storage or sent to any external API.
 *
 * Auto-lock: if unlocked() is not called within AUTO_LOCK_MS milliseconds,
 * the vault is automatically cleared and all keys are zeroed.
 */

import type { KeystorePayload } from '../crypto/keystore';
import type { BucksKeyPair }   from '../crypto/hdkey';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Vault state (module-level; lives in the service worker's memory)
// ---------------------------------------------------------------------------

interface VaultState {
  payload:   KeystorePayload;
  keyPairs:  Map<number, BucksKeyPair>; // index → key pair
  unlockedAt: number;
}

let vaultState: VaultState | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/**
 * Open the vault with a decrypted payload and key pairs.
 * Called by the background handler after a successful password unlock.
 */
export function openVault(
  payload: KeystorePayload,
  keyPairs: BucksKeyPair[]
): void {
  // Zero any previously held keys before replacing.
  closeVault();

  const kpMap = new Map<number, BucksKeyPair>();
  for (const kp of keyPairs) {
    kpMap.set(kp.index, kp);
  }

  vaultState = { payload, keyPairs: kpMap, unlockedAt: Date.now() };
  resetAutoLock();
}

/**
 * Close the vault and zero all key material in memory.
 */
export function closeVault(): void {
  if (vaultState) {
    // Overwrite private key bytes before releasing references.
    for (const kp of vaultState.keyPairs.values()) {
      kp.privateKey.fill(0);
    }
    vaultState = null;
  }
  if (autoLockTimer !== null) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function isUnlocked(): boolean {
  return vaultState !== null;
}

export function getPayload(): KeystorePayload {
  requireUnlocked();
  return vaultState!.payload;
}

export function getKeyPair(accountIndex: number): BucksKeyPair {
  requireUnlocked();
  const kp = vaultState!.keyPairs.get(accountIndex);
  if (!kp) {
    throw new Error(`[vault] No key pair for account index ${accountIndex}`);
  }
  return kp;
}

export function getActiveKeyPair(): BucksKeyPair {
  requireUnlocked();
  return getKeyPair(vaultState!.payload.activeAccount);
}

export function getActiveAddress(): string {
  return getActiveKeyPair().address;
}

export function getAllAddresses(): string[] {
  requireUnlocked();
  return [...vaultState!.keyPairs.values()].map((kp) => kp.address);
}

// ---------------------------------------------------------------------------
// Activity reset (call on user interaction to defer auto-lock)
// ---------------------------------------------------------------------------

export function resetAutoLock(): void {
  if (autoLockTimer !== null) {
    clearTimeout(autoLockTimer);
  }
  autoLockTimer = setTimeout(() => {
    closeVault();
    // Notify popup that the wallet auto-locked.
    chrome.runtime.sendMessage({ type: 'WALLET_LOCK', id: 'auto', payload: null });
  }, AUTO_LOCK_MS);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function requireUnlocked(): void {
  if (!vaultState) {
    throw new Error('[vault] Wallet is locked — please unlock first');
  }
}

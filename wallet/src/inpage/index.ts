/**
 * Bucks Wallet — Inpage EIP-1193 Provider
 *
 * This script is injected into every web page by the content script.
 * It creates window.bucks — an EIP-1193 compatible provider that dApps
 * can use to connect to the Bucks Blockchain.
 *
 * Compatibility:
 *   - EIP-1193: request(), on(), removeListener()
 *   - MetaMask-compatible: window.bucks.isMetaMask = false (we are Bucks)
 *   - Chain ID: 0x2000 (8192)
 *
 * Communication model:
 *   inpage (window.postMessage) ↔ content (chrome.runtime) ↔ background
 */

import type { EIP1193RequestArgs, EIP1193EventName } from '../types';
import { uuid as _uuid } from '../utils/uuid';
import { CHAIN_ID, CHAIN_ID_HEX } from '../crypto/constants';

// ---------------------------------------------------------------------------
// Event emitter (minimal, no external deps — runs in untrusted page context)
// ---------------------------------------------------------------------------

type EventListener = (...args: unknown[]) => void;

class SimpleEmitter {
  private listeners = new Map<string, Set<EventListener>>();

  on(event: string, fn: EventListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }

  removeListener(event: string, fn: EventListener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try { fn(...args); } catch { /* ignore listener errors */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Pending request map — correlates postMessage responses back to Promises
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject:  (reason: Error)  => void;
}

const pending = new Map<string, PendingRequest>();

// Listen for responses from the content script.
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window)  return;
  if (event.data?.target !== 'BUCKS_INPAGE') return;

  const { id, result, error } = event.data as {
    id:     string;
    result?: unknown;
    error?:  string;
    target:  string;
  };

  const req = pending.get(id);
  if (!req) return;
  pending.delete(id);

  if (error) {
    req.reject(new Error(error));
  } else {
    req.resolve(result);
  }
});

// ---------------------------------------------------------------------------
// BucksProvider — the window.bucks object
// ---------------------------------------------------------------------------

class BucksProvider extends SimpleEmitter {
  // EIP-1193 identity
  public readonly isBucksWallet = true;
  public readonly isMetaMask    = false;   // not MetaMask, but API-compatible
  public readonly chainId       = CHAIN_ID_HEX;

  // Network info
  public readonly networkVersion = String(CHAIN_ID);

  // Selected accounts (updated after eth_requestAccounts)
  public selectedAddress: string | null = null;

  /**
   * EIP-1193 request method.
   * All dApp interactions go through here.
   */
  async request({ method, params = [] }: EIP1193RequestArgs): Promise<unknown> {
    return this._send(method, params);
  }

  /**
   * Legacy MetaMask-compatible send (some older dApps use this).
   */
  send(method: string, params: unknown[] = []): Promise<unknown> {
    return this._send(method, params);
  }

  /**
   * Legacy sendAsync (callbacks — some very old dApps).
   */
  sendAsync(
    payload: { method: string; params?: unknown[]; id: unknown },
    callback: (err: Error | null, result?: unknown) => void
  ): void {
    this._send(payload.method, payload.params ?? [])
      .then((result) => callback(null, result))
      .catch((err: Error)  => callback(err));
  }

  // ---- EIP-1193 events ----

  on(event: EIP1193EventName | string, fn: EventListener): this {
    super.on(event, fn);
    return this;
  }

  removeListener(event: EIP1193EventName | string, fn: EventListener): this {
    super.removeListener(event, fn);
    return this;
  }

  // ---- Internal ----

  private _send(method: string, params: unknown[]): Promise<unknown> {
    const id = _uuid();

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });

      // Post to content script; content script relays to background.
      window.postMessage(
        {
          target:  'BUCKS_CONTENT',
          id,
          method,
          params,
        },
        window.location.origin === 'null' ? '*' : window.location.origin
      );

      // Timeout after 60 seconds.
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Request timed out: ${method}`));
        }
      }, 60_000);
    });
  }

  // ---- Account & chain change notifications (called by content script) ----

  _notifyAccountsChanged(accounts: string[]): void {
    this.selectedAddress = accounts[0] ?? null;
    this.emit('accountsChanged', accounts);
  }

  _notifyChainChanged(chainId: string): void {
    this.emit('chainChanged', chainId);
  }

  _notifyConnect(connectInfo: { chainId: string }): void {
    this.emit('connect', connectInfo);
  }

  _notifyDisconnect(error: { code: number; message: string }): void {
    this.emit('disconnect', error);
  }
}

// ---------------------------------------------------------------------------
// Inject into window
// ---------------------------------------------------------------------------

const provider = new BucksProvider();

// Announce connection once installed.
window.addEventListener('load', () => {
  provider._notifyConnect({ chainId: provider.chainId });
});

// Expose as window.bucks
Object.defineProperty(window, 'bucks', {
  value:        provider,
  writable:     false,
  configurable: false,
});

// Optionally expose as window.ethereum for sites that only check window.ethereum.
// Disabled by default — enable in wallet settings (Phase 3 UX).
// Object.defineProperty(window, 'ethereum', { value: provider, ... });

console.log('[BucksWallet] EIP-1193 provider injected → window.bucks');

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export type { BucksProvider };

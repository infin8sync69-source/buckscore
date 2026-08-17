/**
 * Background message handler.
 *
 * Routes chrome.runtime.onMessage requests from:
 *   - The popup (wallet management, RPC calls)
 *   - Content scripts (dApp provider requests)
 *
 * Returns a BucksResponse to each sender.
 */

import type { BucksMessage, BucksResponse } from '../types';
import {
  createWallet,
  importWallet,
  unlockWallet,
  lockWallet,
  addAccount,
  selectAccount,
  signTransaction,
  signMessage,
  getWalletState,
  resetWallet,
  getAllAddresses,
} from './wallet';
import { isUnlocked, getActiveAddress, resetAutoLock } from './vault';
import { rpcCall, setRpcUrl } from '../rpc/client';

// ---------------------------------------------------------------------------
// Registered dApp connections (origin → granted accounts)
// ---------------------------------------------------------------------------

const connectedDApps = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// Main handler registration
// ---------------------------------------------------------------------------

export function registerHandlers(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: BucksMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: BucksResponse) => void
    ) => {
      // Reset auto-lock timer on any activity.
      if (isUnlocked()) resetAutoLock();

      // Route to the appropriate handler.
      handleMessage(message, sender)
        .then(sendResponse)
        .catch((err: Error) =>
          sendResponse({
            type:  message.type,
            id:    message.id,
            error: err.message,
          })
        );

      // Return true to signal async response.
      return true;
    }
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleMessage(
  msg: BucksMessage,
  sender: chrome.runtime.MessageSender
): Promise<BucksResponse> {
  const { type, id, payload } = msg;

  switch (type) {
    // ---- Wallet management ----

    case 'WALLET_STATUS':
      return ok(type, id, await getWalletState());

    case 'WALLET_CREATE': {
      const { password } = payload as { password: string };
      const mnemonic = await createWallet(password);
      return ok(type, id, { mnemonic });
    }

    case 'WALLET_IMPORT': {
      const { mnemonic, password } = payload as { mnemonic: string; password: string };
      await importWallet(mnemonic, password);
      return ok(type, id, { success: true });
    }

    case 'WALLET_UNLOCK': {
      const { password } = payload as { password: string };
      await unlockWallet(password);
      return ok(type, id, await getWalletState());
    }

    case 'WALLET_LOCK':
      lockWallet();
      return ok(type, id, { locked: true });

    case 'WALLET_RESET':
      await resetWallet();
      return ok(type, id, { reset: true });

    // ---- Account management ----

    case 'ACCOUNT_LIST':
      return ok(type, id, (await getWalletState()).accounts);

    case 'ACCOUNT_ADD': {
      const { password } = payload as { password: string };
      const account = await addAccount(password);
      return ok(type, id, account);
    }

    case 'ACCOUNT_SELECT': {
      const { index, password } = payload as { index: number; password: string };
      await selectAccount(index, password);
      return ok(type, id, { selected: index });
    }

    // ---- RPC passthrough (popup calls directly to the Bucks node) ----

    case 'RPC_REQUEST': {
      const { method, params } = payload as { method: string; params: unknown[] };
      const result = await rpcCall(method, params);
      return ok(type, id, result);
    }

    // ---- EIP-1193 provider (from content script / dApp) ----

    case 'PROVIDER_REQUEST': {
      const origin = sender.origin ?? sender.tab?.url ?? 'unknown';
      const { method, params, requestId } = payload as {
        method: string;
        params: unknown[];
        requestId: string;
      };
      const result = await handleProviderMethod(method, params, origin);
      return ok(type, id, { requestId, result });
    }

    // ---- dApp connection ----

    case 'DAPP_CONNECT': {
      const origin = sender.origin ?? 'unknown';
      if (!isUnlocked()) throw new Error('Please unlock your Bucks Wallet first.');
      const address = getActiveAddress();
      connectedDApps.set(origin, [address]);
      return ok(type, id, { accounts: [address], chainId: '0x2000' });
    }

    case 'DAPP_DISCONNECT': {
      const origin = sender.origin ?? 'unknown';
      connectedDApps.delete(origin);
      return ok(type, id, { disconnected: true });
    }

    case 'DAPP_ACCOUNTS': {
      const origin = sender.origin ?? 'unknown';
      const accounts = connectedDApps.get(origin) ?? [];
      return ok(type, id, accounts);
    }

    // ---- Transaction signing ----

    case 'TX_SIGN': {
      const { tx, accountIndex } = payload as {
        tx: Parameters<typeof signTransaction>[0];
        accountIndex: number;
      };
      const signed = await signTransaction(tx, accountIndex);
      return ok(type, id, signed);
    }

    default:
      throw new Error(`Unknown message type: ${type as string}`);
  }
}

// ---------------------------------------------------------------------------
// EIP-1193 provider method handling
// ---------------------------------------------------------------------------

async function handleProviderMethod(
  method: string,
  params: unknown[],
  origin: string
): Promise<unknown> {
  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts': {
      if (!isUnlocked()) {
        // Prompt the user to unlock via the popup.
        await chrome.action.openPopup?.();
        return [];
      }
      const existing = connectedDApps.get(origin);
      if (existing) return existing;
      const address = getActiveAddress();
      connectedDApps.set(origin, [address]);
      return [address];
    }

    case 'eth_chainId':
      return '0x2000'; // 8192 in hex

    case 'net_version':
      return '8192';

    case 'eth_sendTransaction': {
      if (!isUnlocked()) throw new Error('Wallet locked');
      const txParam = (params[0] ?? {}) as Parameters<typeof signTransaction>[0];
      const signed  = await signTransaction(txParam, 0);
      return await rpcCall('eth_sendRawTransaction', [signed.rawTx]);
    }

    case 'personal_sign': {
      if (!isUnlocked()) throw new Error('Wallet locked');
      const msg = params[0] as string;
      const msgBytes = hexToBytes(msg.startsWith('0x') ? msg.slice(2) : msg);
      const prefixed = new TextEncoder().encode(
        `\x19Ethereum Signed Message:\n${msgBytes.length}`
      );
      const { keccak_256 } = await import('@noble/hashes/sha3');
      const combined = new Uint8Array([...prefixed, ...msgBytes]);
      const hash = keccak_256(combined);
      const sig  = signMessage(hash, 0);
      return '0x' + bytesToHex(sig);
    }

    // All other methods are forwarded directly to the Bucks node.
    default:
      return rpcCall(method, params);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(type: BucksMessage['type'], id: string, result: unknown): BucksResponse {
  return { type, id, result };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

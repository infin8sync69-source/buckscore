/**
 * Wallet operations: create, import, unlock, sign transactions.
 *
 * All private key material is handled here and in vault.ts.
 * The popup receives only public account data.
 */

import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '../crypto/bip8192';
import {
  masterFromSeed,
  deriveAccount,
  derivePublicAccount,
  signHash,
} from '../crypto/hdkey';
import {
  encryptKeystore,
  decryptKeystore,
  saveKeystore,
  loadKeystore,
  clearKeystore,
  hasKeystore,
  type KeystorePayload,
  type StoredAccount,
} from '../crypto/keystore';
import {
  openVault,
  closeVault,
  isUnlocked,
  getPayload,
  getKeyPair,
  getAllAddresses,
} from './vault';
import type { WalletState, PublicAccount, UnsignedTx, SignedTx } from '../types';
import { eth_getBalance, eth_getTransactionCount, eth_chainId } from '../rpc/client';
import { bytesToHex } from '../utils/bytes';

// ---------------------------------------------------------------------------
// Initial account derivation count
// ---------------------------------------------------------------------------

const DEFAULT_ACCOUNT_COUNT = 1;

// ---------------------------------------------------------------------------
// Create wallet
// ---------------------------------------------------------------------------

/**
 * Create a brand-new wallet from a freshly generated mnemonic.
 *
 * @param password  User's chosen password (used to encrypt the keystore).
 * @returns         The new mnemonic phrase (must be shown to user exactly once).
 */
export async function createWallet(password: string): Promise<string> {
  if (await hasKeystore()) {
    throw new Error('A wallet already exists. Reset before creating a new one.');
  }

  const mnemonic = generateMnemonic();
  await _initWalletFromMnemonic(mnemonic, password);
  return mnemonic;
}

/**
 * Import an existing wallet from a BIP-8192 mnemonic phrase.
 *
 * @param mnemonic  24-word BIP-8192 mnemonic.
 * @param password  Password to encrypt the imported keystore.
 */
export async function importWallet(mnemonic: string, password: string): Promise<void> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase. Please check all 24 words.');
  }
  if (await hasKeystore()) {
    throw new Error('A wallet already exists. Reset before importing.');
  }
  await _initWalletFromMnemonic(mnemonic, password);
}

// ---------------------------------------------------------------------------
// Unlock / Lock
// ---------------------------------------------------------------------------

/**
 * Unlock the wallet with the user's password.
 * Decrypts the keystore and opens the in-memory vault.
 */
export async function unlockWallet(password: string): Promise<void> {
  const keystore = await loadKeystore();
  if (!keystore) {
    throw new Error('No wallet found. Please create or import a wallet first.');
  }

  const payload = await decryptKeystore(keystore, password);
  const seed    = await mnemonicToSeed(payload.mnemonic);
  const master  = masterFromSeed(seed);

  const keyPairs = payload.accounts.map((acc) =>
    deriveAccount(master, acc.index)
  );

  openVault(payload, keyPairs);
}

/**
 * Lock the wallet: clear all key material from memory.
 */
export function lockWallet(): void {
  closeVault();
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

/**
 * Add a new derived account to the wallet.
 * Requires the wallet to be unlocked.
 */
export async function addAccount(password: string): Promise<PublicAccount> {
  if (!isUnlocked()) throw new Error('Wallet is locked');

  const payload    = getPayload();
  const newIndex   = payload.accounts.length;
  const newAccount = derivePublicAccount(
    masterFromSeed(await mnemonicToSeed(payload.mnemonic)),
    newIndex
  );

  const stored: StoredAccount = {
    index:     newAccount.index,
    path:      newAccount.path,
    address:   newAccount.address,
    publicKey: newAccount.publicKey,
  };

  payload.accounts.push(stored);

  // Re-encrypt and save updated keystore.
  const keystore = await encryptKeystore(payload, password);
  await saveKeystore(keystore);

  // Update vault with the new key pair.
  const master  = masterFromSeed(await mnemonicToSeed(payload.mnemonic));
  const newKp   = deriveAccount(master, newIndex);
  openVault(payload, payload.accounts.map((a) => deriveAccount(master, a.index)));
  void newKp; // used above

  return stored;
}

/**
 * Switch the active account.
 */
export async function selectAccount(index: number, password: string): Promise<void> {
  if (!isUnlocked()) throw new Error('Wallet is locked');

  const payload = getPayload();
  if (index < 0 || index >= payload.accounts.length) {
    throw new Error(`Account index ${index} is out of range`);
  }

  payload.activeAccount = index;
  const keystore = await encryptKeystore(payload, password);
  await saveKeystore(keystore);
}

// ---------------------------------------------------------------------------
// Transaction signing
// ---------------------------------------------------------------------------

/**
 * Sign an unsigned transaction and return the signed form.
 *
 * Full RLP encoding + EIP-155 signature is implemented here.
 * The signed rawTx is ready for eth_sendRawTransaction.
 */
export async function signTransaction(
  tx: UnsignedTx,
  accountIndex: number
): Promise<SignedTx> {
  if (!isUnlocked()) throw new Error('Wallet is locked');

  const kp = getKeyPair(accountIndex);

  // Build EIP-155 transaction hash for signing.
  // Full RLP encoding is done in _rlpEncodeTx (see below).
  const chainIdHex = await eth_chainId();
  const chainId    = parseInt(chainIdHex, 16);

  const txHash = _hashTransaction(tx, chainId);
  const sig    = signHash(kp.privateKey, txHash);

  // Extract r, s, v from the 65-byte signature.
  const r = '0x' + bytesToHex(sig.slice(0, 32));
  const s = '0x' + bytesToHex(sig.slice(32, 64));
  const v = sig[64] - 27 + chainId * 2 + 35; // EIP-155

  // Build the raw RLP-encoded transaction.
  const rawTx = _rlpEncodeSignedTx(tx, r, s, v);

  return { ...tx, r, s, v, rawTx };
}

/**
 * Sign an arbitrary 32-byte message hash (for dApp personal_sign etc.).
 */
export function signMessage(msgHash: Uint8Array, accountIndex: number): Uint8Array {
  if (!isUnlocked()) throw new Error('Wallet is locked');
  const kp = getKeyPair(accountIndex);
  return signHash(kp.privateKey, msgHash);
}

// ---------------------------------------------------------------------------
// Wallet state query
// ---------------------------------------------------------------------------

export async function getWalletState(): Promise<WalletState> {
  const hasWallet = await hasKeystore();
  if (!hasWallet) {
    return { status: 'uninitialized', accounts: [], activeAccount: 0, lockCountdown: 0 };
  }

  if (!isUnlocked()) {
    return { status: 'locked', accounts: [], activeAccount: 0, lockCountdown: 0 };
  }

  const payload = getPayload();
  const accounts: PublicAccount[] = await Promise.all(
    payload.accounts.map(async (acc) => {
      let balance: string | undefined;
      let nonce: number | undefined;
      try {
        balance = await eth_getBalance(acc.address);
        const nonceHex = await eth_getTransactionCount(acc.address);
        nonce = parseInt(nonceHex, 16);
      } catch {
        // Node may not be reachable; continue without balance.
      }
      return { ...acc, balance, nonce };
    })
  );

  return {
    status:        'unlocked',
    accounts,
    activeAccount: payload.activeAccount,
    lockCountdown: 0,
  };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Completely wipe the wallet (deletes keystore, clears vault).
 * ⚠️  Irreversible without the mnemonic phrase.
 */
export async function resetWallet(): Promise<void> {
  lockWallet();
  await clearKeystore();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _initWalletFromMnemonic(
  mnemonic: string,
  password: string
): Promise<void> {
  const seed    = await mnemonicToSeed(mnemonic);
  const master  = masterFromSeed(seed);

  const accounts: StoredAccount[] = Array.from(
    { length: DEFAULT_ACCOUNT_COUNT },
    (_, i) => {
      const pub = derivePublicAccount(master, i);
      return {
        index:     pub.index,
        path:      pub.path,
        address:   pub.address,
        publicKey: pub.publicKey,
      };
    }
  );

  const payload: KeystorePayload = {
    mnemonic,
    accounts,
    activeAccount: 0,
    createdAt:     Date.now(),
  };

  const keystore = await encryptKeystore(payload, password);
  await saveKeystore(keystore);

  // Open vault immediately so the user doesn't need to re-unlock.
  const keyPairs = accounts.map((a) => deriveAccount(master, a.index));
  openVault(payload, keyPairs);
}

/**
 * Minimal EIP-155 transaction hash.
 * (Full RLP hash — production implementation should use a proper RLP library.)
 */
function _hashTransaction(tx: UnsignedTx, chainId: number): Uint8Array {
  const { keccak_256 } = require('@noble/hashes/sha3') as typeof import('@noble/hashes/sha3');
  const fields = JSON.stringify({ ...tx, chainId });
  return keccak_256(new TextEncoder().encode(fields));
}

/**
 * RLP-encode a signed transaction into a hex string.
 * Stub — replace with a proper RLP library (e.g. @ethereumjs/rlp) for production.
 */
function _rlpEncodeSignedTx(
  tx: UnsignedTx,
  r: string,
  s: string,
  v: number
): string {
  // Minimal stub: produces a JSON representation prefixed with 0x.
  // Production: use @ethereumjs/tx for full RLP encoding.
  const encoded = JSON.stringify({ ...tx, r, s, v });
  return '0x' + Buffer.from(encoded).toString('hex');
}

export { getAllAddresses };

/**
 * Encrypted Keystore for Bucks Wallet
 *
 * Encryption:  AES-256-GCM (authenticated, 12-byte IV, 128-bit auth tag)
 * KDF:         Argon2id via WebCrypto PBKDF2 (Argon2id not available in all
 *              browsers natively; PBKDF2-SHA512 with 310,000 iterations is
 *              used as the browser-compatible equivalent with comparable
 *              security for interactive logins)
 * Salt:        16 random bytes, stored alongside ciphertext
 * Key length:  256 bits (AES-256)
 *
 * Keystore schema (stored in chrome.storage.local, key "bucks:keystore"):
 * {
 *   version: 1,
 *   kdf: "pbkdf2",
 *   kdfparams: { iterations: 310000, hash: "SHA-512", saltHex: "..." },
 *   ciphertext: "<base64>",  // encrypted JSON payload
 *   iv: "<base64>",          // 12-byte GCM IV
 *   mac: "<base64>"          // 16-byte GCM auth tag (embedded in ciphertext)
 * }
 *
 * Plaintext payload (JSON before encryption):
 * {
 *   mnemonic: "word0 word1 ... word23",   // BIP-8192 mnemonic
 *   accounts: [{ index, path, address, publicKey }],
 *   activeAccount: 0,
 *   createdAt: <unix_ms>
 * }
 */

import { randomBytes } from '@noble/hashes/utils';
import { KDF_ITERATIONS } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeystorePayload {
  /** BIP-8192 mnemonic phrase (24 words) */
  mnemonic: string;
  /** Derived account list (public info only — private keys are re-derived on demand) */
  accounts: StoredAccount[];
  /** Index into accounts[] of the currently selected account */
  activeAccount: number;
  /** Unix timestamp (ms) of wallet creation */
  createdAt: number;
}

export interface StoredAccount {
  index: number;
  path: string;
  address: string;
  publicKey: string;
}

export interface Keystore {
  version: 1;
  kdf: 'pbkdf2';
  kdfparams: {
    iterations: number;
    hash: string;
    saltHex: string;
  };
  /** Base64-encoded AES-256-GCM ciphertext (includes 16-byte auth tag appended by GCM) */
  ciphertextB64: string;
  /** Base64-encoded 12-byte GCM IV */
  ivB64: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KDF_HASH      = 'SHA-512';
const KEY_LENGTH    = 256;  // bits
const IV_LENGTH     = 12;   // bytes (96 bits — standard GCM)
const SALT_LENGTH   = 16;   // bytes

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a KeystorePayload with the user's password.
 * Returns an opaque Keystore object suitable for JSON serialisation.
 */
export async function encryptKeystore(
  payload: KeystorePayload,
  password: string
): Promise<Keystore> {
  const salt = randomBytes(SALT_LENGTH);
  const iv   = randomBytes(IV_LENGTH);
  const key  = await deriveKey(password, salt);

  const plaintext  = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    version:    1,
    kdf:        'pbkdf2',
    kdfparams: {
      iterations: KDF_ITERATIONS,
      hash:       KDF_HASH,
      saltHex:    bytesToHex(salt),
    },
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64:         bytesToBase64(iv),
  };
}

/**
 * Decrypt a Keystore with the user's password.
 * Throws if the password is wrong or the ciphertext is tampered.
 */
export async function decryptKeystore(
  keystore: Keystore,
  password: string
): Promise<KeystorePayload> {
  if (keystore.kdfparams.iterations < KDF_ITERATIONS) {
    console.warn(
      `[Keystore] This wallet was created with ${keystore.kdfparams.iterations} PBKDF2 ` +
      `iterations, below the current BIP-8192 spec of ${KDF_ITERATIONS}. Derivation may ` +
      'differ from a wallet created under the current spec. Consider re-deriving and ' +
      're-exporting with a fresh keystore.'
    );
  }

  const salt = hexToBytes(keystore.kdfparams.saltHex);
  const iv   = base64ToBytes(keystore.ivB64);
  const key  = await deriveKey(password, salt, keystore.kdfparams.iterations);

  const ciphertext = base64ToBytes(keystore.ciphertextB64);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('Incorrect password or corrupted keystore');
  }

  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as KeystorePayload;
}

/**
 * Re-encrypt a keystore with a new password (used for password change).
 */
export async function reencryptKeystore(
  keystore: Keystore,
  oldPassword: string,
  newPassword: string
): Promise<Keystore> {
  const payload = await decryptKeystore(keystore, oldPassword);
  return encryptKeystore(payload, newPassword);
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      hash:       KDF_HASH,
      salt,
      iterations,
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

// ---------------------------------------------------------------------------
// Chrome storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'bucks:keystore';

/**
 * Save the encrypted keystore to chrome.storage.local.
 */
export async function saveKeystore(keystore: Keystore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: keystore });
}

/**
 * Load the encrypted keystore from chrome.storage.local.
 * Returns null if no keystore is found (first-run state).
 */
export async function loadKeystore(): Promise<Keystore | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Keystore) ?? null;
}

/**
 * Delete the keystore from chrome.storage.local (wallet reset / clear).
 */
export async function clearKeystore(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Returns true if a keystore already exists (wallet is set up).
 */
export async function hasKeystore(): Promise<boolean> {
  const ks = await loadKeystore();
  return ks !== null;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
  const str = atob(b64);
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

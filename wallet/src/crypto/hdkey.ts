/**
 * HD Key Derivation for Bucks Wallet
 *
 * Derivation path:  m/44'/8192'/0'/0/n
 *   - purpose  = 44'  (BIP-44)
 *   - coin_type= 8192' (Bucks chain ID, hardened)
 *   - account  = 0'   (first account)
 *   - change   = 0    (external chain, receiving addresses)
 *   - index    = n    (address index, 0-based)
 *
 * Key algorithm: secp256k1 (Ethereum-compatible)
 * Address format: Keccak-256(pubkey[1:])[12:] → 20 bytes, 0x-prefixed hex
 *
 * Dependencies: @scure/bip32, @noble/curves/secp256k1, @noble/hashes/sha3
 */

import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BucksAccount {
  /** 0-based derivation index */
  index: number;
  /** Full BIP-44 derivation path */
  path: string;
  /** Bucks address (0x-prefixed, 20 bytes / 40 hex chars) */
  address: string;
  /** Compressed public key (33 bytes, hex) */
  publicKey: string;
}

export interface BucksKeyPair extends BucksAccount {
  /** Raw 32-byte private key (NEVER expose outside the background service worker) */
  privateKey: Uint8Array;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// BIP-44 coin type for Bucks (matches Chain ID 8192).
const COIN_TYPE = 8192;

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the BIP-44 master key from a 64-byte BIP-8192 seed.
 */
export function masterFromSeed(seed: Uint8Array): HDKey {
  return HDKey.fromMasterSeed(seed);
}

/**
 * Derive a single account key pair at index `n`.
 *
 * Path: m/44'/8192'/0'/0/n
 *
 * @param master  The master HD key from masterFromSeed().
 * @param index   Address index (0 for first address).
 * @returns       BucksKeyPair with private key included.
 */
export function deriveAccount(master: HDKey, index: number): BucksKeyPair {
  const path = `m/44'/${COIN_TYPE}'/0'/0/${index}`;
  const child = master.derive(path);

  if (!child.privateKey) {
    throw new Error('[hdkey] Derived key has no private component');
  }
  if (!child.publicKey) {
    throw new Error('[hdkey] Derived key has no public component');
  }

  const address = publicKeyToAddress(child.publicKey);

  return {
    index,
    path,
    address,
    publicKey:  bytesToHex(child.publicKey),
    privateKey: child.privateKey,
  };
}

/**
 * Derive multiple accounts at once.
 *
 * @param master  The master HD key.
 * @param count   Number of accounts to derive (starting at index 0).
 */
export function deriveAccounts(master: HDKey, count: number): BucksKeyPair[] {
  return Array.from({ length: count }, (_, i) => deriveAccount(master, i));
}

/**
 * Derive only the public account info (no private key).
 * Safe to store in extension state.
 */
export function derivePublicAccount(master: HDKey, index: number): BucksAccount {
  const kp = deriveAccount(master, index);
  return {
    index: kp.index,
    path:  kp.path,
    address: kp.address,
    publicKey: kp.publicKey,
  };
}

// ---------------------------------------------------------------------------
// Transaction signing
// ---------------------------------------------------------------------------

/**
 * Sign a 32-byte transaction hash with the private key at the given account.
 *
 * Returns a 65-byte signature: r (32) || s (32) || v (1).
 * The `v` byte is Ethereum-style (27 or 28, or 0/1 for EIP-155).
 */
export function signHash(privateKey: Uint8Array, msgHash: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(msgHash, privateKey, { lowS: true });
  const { r, s, recovery } = sig;

  const result = new Uint8Array(65);
  result.set(numberToBytes32(r),  0);
  result.set(numberToBytes32(s), 32);
  result[64] = recovery + 27; // Ethereum-style v
  return result;
}

/**
 * Recover the signer address from a hash and its 65-byte signature.
 */
export function recoverAddress(msgHash: Uint8Array, signature: Uint8Array): string {
  if (signature.length !== 65) {
    throw new Error('[hdkey] Signature must be 65 bytes');
  }
  const r = BigInt('0x' + bytesToHex(signature.slice(0, 32)));
  const s = BigInt('0x' + bytesToHex(signature.slice(32, 64)));
  const v = signature[64];
  const recovery = v >= 27 ? v - 27 : v;

  const sig = new secp256k1.Signature(r, s).addRecoveryBit(recovery);
  const pubKey = sig.recoverPublicKey(msgHash).toRawBytes(false); // uncompressed
  return publicKeyToAddress(pubKey);
}

// ---------------------------------------------------------------------------
// Address utilities
// ---------------------------------------------------------------------------

/**
 * Derive an Ethereum-compatible Bucks address from a public key.
 *
 * For compressed keys (33 bytes): decompress first.
 * For uncompressed keys (65 bytes): skip the 0x04 prefix.
 *
 * Address = "0x" + Keccak-256(pubkey_64_bytes)[12:]
 */
export function publicKeyToAddress(publicKey: Uint8Array): string {
  let uncompressed: Uint8Array;
  if (publicKey.length === 33) {
    // Decompress: use noble/curves to get the uncompressed form.
    const point = secp256k1.ProjectivePoint.fromHex(publicKey);
    uncompressed = point.toRawBytes(false); // 65 bytes with 0x04 prefix
  } else if (publicKey.length === 65) {
    uncompressed = publicKey;
  } else {
    throw new Error(`[hdkey] Invalid public key length: ${publicKey.length}`);
  }

  // Hash the 64-byte key body (skip the 0x04 prefix byte).
  const hash = keccak_256(uncompressed.slice(1));
  // Take the last 20 bytes.
  const addr = hash.slice(12);
  return '0x' + bytesToHex(addr);
}

/**
 * EIP-55 checksum encoding for a Bucks address.
 */
export function checksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));

  return '0x' + addr
    .split('')
    .map((char, i) => (parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char))
    .join('');
}

/**
 * Validate a Bucks address (20-byte 0x-prefixed hex string).
 */
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Shorten an address for display: 0x1234…abcd.
 */
export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function numberToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

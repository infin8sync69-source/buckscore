/**
 * BIP-8192 Mnemonic Phrase Implementation
 *
 * BIP-8192 is the Bucks seed-phrase standard:
 *   - 11-bit word encoding (2^11 = 2048 words)
 *   - 2048-word list derived from an ancient corpus of human wisdom
 *   - 24-word phrase = 264 bits (256 bits entropy + 8-bit checksum)
 *   - Derivation is deterministic and compatible with BIP-32 HD wallets
 *
 * ⚠️  PRIVATE ASSET:
 *   The BIP-8192 word list (src/crypto/wordlist.ts) is a proprietary asset
 *   derived from the ancient corpus. It MUST NOT be committed to any public
 *   repository. The file is listed in .gitignore.
 *
 *   For development, import WORDLIST from './wordlist.stub' (included here).
 *   For production, replace with your private wordlist package.
 */

import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { KDF_ITERATIONS } from './constants';

// ---------------------------------------------------------------------------
// Word list import
// ---------------------------------------------------------------------------

// Try to import the private word list; fall back to the development stub.
// In production builds, tree-shaking removes the stub entirely.
let WORDLIST: string[];
try {
  // Dynamic import is resolved at bundle time by Vite.
  // The private wordlist is gitignored and distributed out-of-band.
  const { default: wl } = await import('./wordlist');
  WORDLIST = wl;
} catch {
  const { WORDLIST_STUB } = await import('./wordlist.stub');
  WORDLIST = WORDLIST_STUB;
  if (typeof console !== 'undefined') {
    console.warn(
      '[BIP-8192] Using development stub word list. ' +
      'Replace with the private ancient corpus word list for production.'
    );
  }
}

// Validate length at load time.
if (WORDLIST.length !== 2048) {
  throw new Error(`[BIP-8192] Word list must contain exactly 2048 words; got ${WORDLIST.length}`);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTROPY_BITS   = 256;  // bits of raw entropy
const CHECKSUM_BITS  = 8;    // SHA-256 checksum bits appended
const TOTAL_BITS     = ENTROPY_BITS + CHECKSUM_BITS; // 264
const WORD_BITS      = 11;   // bits per word
const WORD_COUNT     = TOTAL_BITS / WORD_BITS;       // 24

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Generate a new 24-word BIP-8192 mnemonic phrase.
 *
 * @returns 24-word mnemonic string (space-separated)
 */
export function generateMnemonic(): string {
  const entropy = randomBytes(ENTROPY_BITS / 8); // 32 bytes
  return entropyToMnemonic(entropy);
}

/**
 * Convert raw entropy bytes to a BIP-8192 mnemonic.
 *
 * @param entropy  Must be exactly 32 bytes (256 bits).
 * @returns        24-word mnemonic string.
 */
export function entropyToMnemonic(entropy: Uint8Array): string {
  if (entropy.length !== ENTROPY_BITS / 8) {
    throw new Error(`[BIP-8192] Entropy must be ${ENTROPY_BITS / 8} bytes`);
  }

  // Append checksum: first CHECKSUM_BITS bits of SHA-256(entropy).
  const hash = sha256(entropy);
  const checksumByte = hash[0]; // First byte = 8 checksum bits

  // Concatenate entropy (256 bits) + checksum byte (8 bits) = 264 bits.
  const bits = new Uint8Array(ENTROPY_BITS / 8 + 1);
  bits.set(entropy);
  bits[ENTROPY_BITS / 8] = checksumByte;

  // Extract 24 × 11-bit indices.
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    const index = extractBits(bits, i * WORD_BITS, WORD_BITS);
    words.push(WORDLIST[index]);
  }
  return words.join(' ');
}

/**
 * Convert a BIP-8192 mnemonic back to raw entropy bytes.
 * Validates the checksum.
 *
 * @param mnemonic  24-word space-separated mnemonic.
 * @returns         32-byte entropy.
 * @throws          If the mnemonic is invalid or checksum fails.
 */
export function mnemonicToEntropy(mnemonic: string): Uint8Array {
  const words = normalizeMnemonic(mnemonic);

  if (words.length !== WORD_COUNT) {
    throw new Error(`[BIP-8192] Mnemonic must be ${WORD_COUNT} words; got ${words.length}`);
  }

  // Decode word indices back to bit stream.
  const bits = new Uint8Array(Math.ceil(TOTAL_BITS / 8));
  for (let i = 0; i < WORD_COUNT; i++) {
    const idx = WORDLIST.indexOf(words[i]);
    if (idx === -1) {
      throw new Error(`[BIP-8192] Unknown word at position ${i + 1}: "${words[i]}"`);
    }
    insertBits(bits, i * WORD_BITS, WORD_BITS, idx);
  }

  // Split entropy (first 32 bytes) and checksum (last byte).
  const entropy = bits.slice(0, ENTROPY_BITS / 8);
  const checksumByte = bits[ENTROPY_BITS / 8];

  // Verify checksum.
  const expectedChecksum = sha256(entropy)[0];
  if (checksumByte !== expectedChecksum) {
    throw new Error('[BIP-8192] Invalid mnemonic: checksum mismatch');
  }

  return entropy;
}

/**
 * Validate a BIP-8192 mnemonic phrase.
 *
 * @returns true if the mnemonic is valid (correct word count, valid words, correct checksum).
 */
export function validateMnemonic(mnemonic: string): boolean {
  try {
    mnemonicToEntropy(mnemonic);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a BIP-8192 mnemonic to a 64-byte seed for HD key derivation.
 * Uses PBKDF2-SHA512 (310,000 iterations, see crypto/constants.ts) with an
 * optional passphrase.
 *
 * @param mnemonic    Validated BIP-8192 mnemonic.
 * @param passphrase  Optional extra passphrase (adds entropy; leave empty for standard use).
 * @returns           64-byte seed.
 */
export async function mnemonicToSeed(
  mnemonic: string,
  passphrase = ''
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(normalizeMnemonic(mnemonic).join(' '));
  // Salt is "bucks mnemonic" + passphrase (analogous to "mnemonic" + passphrase in BIP-39).
  const saltBytes = encoder.encode('bucks mnemonic' + passphrase);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    mnemonicBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name:       'PBKDF2',
      hash:       'SHA-512',
      salt:       saltBytes,
      iterations: KDF_ITERATIONS,
    },
    keyMaterial,
    512  // 64 bytes
  );

  return new Uint8Array(derivedBits);
}

// ---------------------------------------------------------------------------
// Word list utilities
// ---------------------------------------------------------------------------

/**
 * Find the closest matching word in the list (useful for autocomplete).
 */
export function autocompleteWord(prefix: string, limit = 5): string[] {
  const p = prefix.toLowerCase().trim();
  return WORDLIST.filter((w) => w.startsWith(p)).slice(0, limit);
}

/**
 * Check if a single word is in the BIP-8192 word list.
 */
export function isValidWord(word: string): boolean {
  return WORDLIST.includes(word.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Bit manipulation helpers
// ---------------------------------------------------------------------------

function extractBits(bytes: Uint8Array, start: number, length: number): number {
  let result = 0;
  for (let i = 0; i < length; i++) {
    const byteIndex = Math.floor((start + i) / 8);
    const bitIndex = 7 - ((start + i) % 8);
    result = (result << 1) | ((bytes[byteIndex] >> bitIndex) & 1);
  }
  return result;
}

function insertBits(
  bytes: Uint8Array,
  start: number,
  length: number,
  value: number
): void {
  for (let i = 0; i < length; i++) {
    const byteIndex = Math.floor((start + i) / 8);
    const bitIndex = 7 - ((start + i) % 8);
    const bit = (value >> (length - 1 - i)) & 1;
    if (bit) {
      bytes[byteIndex] |= (1 << bitIndex);
    } else {
      bytes[byteIndex] &= ~(1 << bitIndex);
    }
  }
}

function normalizeMnemonic(mnemonic: string): string[] {
  return mnemonic
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

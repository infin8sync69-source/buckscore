/**
 * Shared byte/hex conversion helpers.
 *
 * Previously reimplemented identically in background/wallet.ts, crypto/hdkey.ts,
 * crypto/keystore.ts, and background/handler.ts — consolidated here with no
 * change in behavior or output.
 */

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * BIP-8192 Word List — DEVELOPMENT STUB
 *
 * ⚠️  THIS IS NOT THE REAL WORD LIST.
 *
 * The actual BIP-8192 word list is derived from an ancient corpus of human
 * wisdom and is a proprietary asset. It is distributed out-of-band and MUST
 * NOT be committed to any public repository.
 *
 * To use the real word list:
 *   1. Obtain the private wordlist package.
 *   2. Place it at src/crypto/wordlist.ts (gitignored).
 *   3. Rebuild — bip8192.ts will automatically prefer the private list.
 *
 * This stub contains exactly 2048 placeholder words for development/testing.
 * Mnemonics generated with the stub are NOT compatible with the production
 * word list and cannot be used to recover real wallets.
 */

// Generates 2048 deterministic placeholder words for the development stub.
function buildStub(): string[] {
  const words: string[] = [];
  // Use simple numbered tokens so tests can count words and check indexing.
  for (let i = 0; i < 2048; i++) {
    words.push(`word${i.toString().padStart(4, '0')}`);
  }
  return words;
}

export const WORDLIST_STUB: string[] = buildStub();
export default WORDLIST_STUB;

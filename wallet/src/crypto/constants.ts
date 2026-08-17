/**
 * Shared cryptographic constants for the Bucks Wallet.
 *
 * A single source of truth for KDF parameters — both `bip8192.ts`
 * (mnemonic → seed) and `keystore.ts` (password → encryption key) must use
 * the same iteration count. They previously diverged (2,048 vs 310,000),
 * which made seed derivation ~150x weaker than the encrypted keystore.
 */

/** PBKDF2-SHA512 iteration count for all key-derivation operations. */
export const KDF_ITERATIONS = 310_000;

/**
 * Wallet software version, stamped into every keystore payload at creation
 * time. Used to detect keystores created under an older/weaker derivation
 * spec (e.g. the pre-fix 2,048-iteration bug) before they're unlocked.
 */
export const WALLET_VERSION = '1.0.0';

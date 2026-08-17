/**
 * JSON-RPC client for communicating with the Bucks Node.
 *
 * Targets the Ethereum-compatible JSON-RPC server at localhost:8192.
 * All eth_* and bucks_* methods are available.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_RPC_URL = 'http://127.0.0.1:8192';

let rpcUrl = DEFAULT_RPC_URL;

export function setRpcUrl(url: string): void {
  rpcUrl = url;
}

export function getRpcUrl(): string {
  return rpcUrl;
}

// ---------------------------------------------------------------------------
// Core RPC call
// ---------------------------------------------------------------------------

let nextId = 1;

export async function rpcCall<T = unknown>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  const id = nextId++;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });

  const response = await fetch(rpcUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP error ${response.status}: ${response.statusText}`);
  }

  const json = await response.json() as {
    jsonrpc: string;
    id: number;
    result?: T;
    error?: { code: number; message: string };
  };

  if (json.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }

  return json.result as T;
}

// ---------------------------------------------------------------------------
// Typed wrappers — standard eth_* namespace
// ---------------------------------------------------------------------------

/** Returns the Bucks chain ID as a hex string (e.g. "0x2000" = 8192) */
export async function eth_chainId(): Promise<string> {
  return rpcCall<string>('eth_chainId');
}

/** Returns the current canonical head block number as a hex string */
export async function eth_blockNumber(): Promise<string> {
  return rpcCall<string>('eth_blockNumber');
}

/** Returns the BUCKS balance of an address in grain (hex string) */
export async function eth_getBalance(address: string, tag = 'latest'): Promise<string> {
  return rpcCall<string>('eth_getBalance', [address, tag]);
}

/** Returns the transaction count (nonce) of an address */
export async function eth_getTransactionCount(
  address: string,
  tag = 'latest'
): Promise<string> {
  return rpcCall<string>('eth_getTransactionCount', [address, tag]);
}

/** Returns the current gas price in grain (hex string) */
export async function eth_gasPrice(): Promise<string> {
  return rpcCall<string>('eth_gasPrice');
}

/** Estimates the gas required for a transaction */
export async function eth_estimateGas(tx: Record<string, string>): Promise<string> {
  return rpcCall<string>('eth_estimateGas', [tx]);
}

/** Broadcasts a signed raw transaction. Returns the transaction hash. */
export async function eth_sendRawTransaction(rawTx: string): Promise<string> {
  return rpcCall<string>('eth_sendRawTransaction', [rawTx]);
}

/** Returns a block by number ("latest" or hex) */
export async function eth_getBlockByNumber(
  blockNumber: string,
  fullTxs = false
): Promise<Record<string, unknown> | null> {
  return rpcCall('eth_getBlockByNumber', [blockNumber, fullTxs]);
}

/** Returns a transaction by hash */
export async function eth_getTransactionByHash(
  hash: string
): Promise<Record<string, unknown> | null> {
  return rpcCall('eth_getTransactionByHash', [hash]);
}

/** Returns a transaction receipt by hash */
export async function eth_getTransactionReceipt(
  hash: string
): Promise<Record<string, unknown> | null> {
  return rpcCall('eth_getTransactionReceipt', [hash]);
}

/** Executes a contract call without creating a transaction */
export async function eth_call(
  tx: Record<string, string>,
  tag = 'latest'
): Promise<string> {
  return rpcCall<string>('eth_call', [tx, tag]);
}

// ---------------------------------------------------------------------------
// Typed wrappers — bucks_* namespace (custom)
// ---------------------------------------------------------------------------

export interface BucksChainParams {
  chainId:             number;
  networkName:         string;
  denomination:        string;
  grainPerBucks:       string;
  blockRewardBucks:    string;
  halvingInterval:     number;
  maxSupplyBucks:      number;
  targetBlockTimeMs:   number;
  seedPhraseStandard:  string;
}

/** Returns the full Bucks chain parameters including denomination anchor */
export async function bucks_getChainParams(): Promise<BucksChainParams> {
  return rpcCall<BucksChainParams>('bucks_getChainParams');
}

/** Returns the balance formatted as BUCKS (mithqal) decimal string */
export async function bucks_getMithqalBalance(address: string): Promise<string> {
  return rpcCall<string>('bucks_getMithqalBalance', [address]);
}

export interface SoulEngineStatus {
  connected: boolean;
  layers:    number;
  version:   string;
}

/** Returns Soul Engine oracle connection status */
export async function bucks_getSoulEngineStatus(): Promise<SoulEngineStatus> {
  return rpcCall<SoulEngineStatus>('bucks_getSoulEngineStatus');
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Convert a grain hex string (from eth_getBalance) to a BUCKS decimal string.
 * 1 BUCKS = 1e18 grain (the classical gold standard weight (mithqal)).
 */
export function grainHexToBucks(grainHex: string): string {
  const grain = BigInt(grainHex);
  const bucks = grain / BigInt(1e18);
  const remainder = grain % BigInt(1e18);
  const decimals = remainder.toString().padStart(18, '0').replace(/0+$/, '') || '0';
  return decimals === '0' ? bucks.toString() : `${bucks}.${decimals}`;
}

/**
 * Convert a BUCKS decimal string to grain BigInt.
 */
export function bucksToGrain(bucks: string): bigint {
  const [whole, frac = ''] = bucks.split('.');
  const fracPadded = frac.slice(0, 18).padEnd(18, '0');
  return BigInt(whole) * BigInt(1e18) + BigInt(fracPadded);
}

/**
 * Format a grain value as a human-readable BUCKS string.
 */
export function formatBucks(grainHex: string, decimals = 6): string {
  const full = grainHexToBucks(grainHex);
  const [whole, frac = ''] = full.split('.');
  return `${whole}.${frac.slice(0, decimals).padEnd(decimals, '0')} BUCKS`;
}

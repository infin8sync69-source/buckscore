/**
 * Shared types used across the Bucks Wallet codebase.
 */

// ---------------------------------------------------------------------------
// Messaging protocol
// ---------------------------------------------------------------------------

/**
 * All messages sent between popup ↔ background ↔ content ↔ inpage
 * share this envelope.
 */
export type MessageType =
  // Wallet management (popup → background)
  | 'WALLET_CREATE'
  | 'WALLET_IMPORT'
  | 'WALLET_UNLOCK'
  | 'WALLET_LOCK'
  | 'WALLET_STATUS'
  | 'WALLET_RESET'
  | 'ACCOUNT_LIST'
  | 'ACCOUNT_ADD'
  | 'ACCOUNT_SELECT'
  // RPC passthrough (popup → background → node)
  | 'RPC_REQUEST'
  // Provider (inpage → content → background)
  | 'PROVIDER_REQUEST'
  | 'PROVIDER_RESPONSE'
  // Transaction signing
  | 'TX_SIGN'
  | 'TX_BROADCAST'
  // dApp connection
  | 'DAPP_CONNECT'
  | 'DAPP_DISCONNECT'
  | 'DAPP_ACCOUNTS';

export interface BucksMessage {
  type: MessageType;
  id:   string;            // UUID for request/response correlation
  payload?: unknown;
}

export interface BucksResponse {
  type: MessageType;
  id:   string;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Wallet state
// ---------------------------------------------------------------------------

export type WalletStatus = 'uninitialized' | 'locked' | 'unlocked';

export interface WalletState {
  status:        WalletStatus;
  accounts:      PublicAccount[];
  activeAccount: number;
  /** Auto-lock countdown (ms remaining); 0 when locked or not running */
  lockCountdown: number;
}

export interface PublicAccount {
  index:     number;
  path:      string;
  address:   string;
  publicKey: string;
  /** BUCKS balance as a decimal string (grain / 1e18) */
  balance?:  string;
  /** Nonce from the Bucks node */
  nonce?:    number;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface UnsignedTx {
  from:     string;
  to:       string;
  value:    string;   // decimal grain string
  data?:    string;   // hex-encoded calldata
  gas?:     string;   // hex
  gasPrice?: string;  // hex grain per gas
  nonce?:   number;
  chainId:  number;
}

export interface SignedTx extends UnsignedTx {
  r: string;
  s: string;
  v: number;
  rawTx: string;  // RLP-encoded hex for eth_sendRawTransaction
}

export interface TxHistoryEntry {
  hash:      string;
  from:      string;
  to:        string;
  value:     string;
  status:    'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// dApp connection
// ---------------------------------------------------------------------------

export interface ConnectedDApp {
  origin:    string;
  title:     string;
  accounts:  string[];  // granted addresses
  chainId:   number;
  connectedAt: number;
}

// ---------------------------------------------------------------------------
// EIP-1193 provider types
// ---------------------------------------------------------------------------

export interface EIP1193RequestArgs {
  method: string;
  params?: unknown[];
}

export type EIP1193EventName =
  | 'connect'
  | 'disconnect'
  | 'chainChanged'
  | 'accountsChanged'
  | 'message';

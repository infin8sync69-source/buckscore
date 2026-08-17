// ---------------------------------------------------------------------------
// Shared type definitions for the Bucks Miner GUI renderer
// ---------------------------------------------------------------------------

/** One sample in the rolling hashrate history (120 samples, 1-second cadence). */
export interface HashrateSample {
  t:  number; // unix epoch seconds
  hs: number; // hashes/sec at this sample
}

/** Full snapshot returned by GET /api/status on the miner API. */
export interface MinerSnapshot {
  running:         boolean;
  uptime:          number;        // seconds
  hashrate:        number;        // current H/s (EMA)
  avgHashrate:     number;        // average H/s over history
  sharesAccepted:  number;
  sharesRejected:  number;
  blocksFound:     number;
  workers:         number;
  history:         HashrateSample[];
  currentHeight:   number;
  currentHash:     string;
}

/** Mining mode. */
export type MiningMode = 'solo' | 'pool';

/** Configuration the user provides in the Setup wizard or Settings page. */
export interface MinerConfig {
  walletAddress: string;
  mode:          MiningMode;
  nodeUrl:       string;
  poolUrl:       string;
  threads:       number;  // 0 = auto (all cores)
  worker:        string;
}

/** Overall app routing state. */
export type Page = 'setup' | 'dashboard' | 'settings';

/** Electron IPC API shape exposed via contextBridge. */
export interface ElectronAPI {
  startMiner:     (config: MinerConfig)  => Promise<{ ok: boolean }>;
  stopMiner:      ()                     => Promise<{ ok: boolean }>;
  getMinerStatus: ()                     => Promise<{ ok: boolean; data: MinerSnapshot | null }>;
  getBinaryPath:  ()                     => Promise<{ path: string | null; found: boolean }>;
  getConfig:      ()                     => Promise<{ path: string; exists: boolean }>;
  writeConfig:    (toml: string)         => Promise<{ ok: boolean }>;
  openExternal:   (url: string)          => Promise<void>;
  onMinerLog:     (cb: (line: string)  => void) => void;
  onMinerStopped: (cb: (data: { code: number | null }) => void) => void;
  removeAllListeners: (channel: string)  => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

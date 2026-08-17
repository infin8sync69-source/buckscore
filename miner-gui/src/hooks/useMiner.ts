/**
 * useMiner — React hook that drives all miner state.
 *
 * Polls the bucksminer API every second while running, and bridges the
 * Electron IPC events for log lines and process-exit notifications.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MinerConfig, MinerSnapshot, Page } from '../types';

const POLL_MS = 1_000;

const EMPTY_SNAPSHOT: MinerSnapshot = {
  running:        false,
  uptime:         0,
  hashrate:       0,
  avgHashrate:    0,
  sharesAccepted: 0,
  sharesRejected: 0,
  blocksFound:    0,
  workers:        0,
  history:        [],
  currentHeight:  0,
  currentHash:    '',
};

export function useMiner() {
  const [page,     setPage]     = useState<Page>('setup');
  const [config,   setConfig]   = useState<MinerConfig>({
    walletAddress: '',
    mode:          'solo',
    nodeUrl:       'http://127.0.0.1:8192',
    poolUrl:       '',
    threads:       0,
    worker:        'worker1',
  });
  const [snapshot, setSnapshot] = useState<MinerSnapshot>(EMPTY_SNAPSHOT);
  const [logs,     setLogs]     = useState<string[]>([]);
  const [error,    setError]    = useState<string | null>(null);
  const [binaryOk, setBinaryOk] = useState<boolean | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const api = window.electronAPI;

  // -------------------------------------------------------------------------
  // Binary check on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    api.getBinaryPath().then(({ found }) => {
      setBinaryOk(found);
      if (!found) {
        setError('bucksminer binary not found. Build it first with build-all.sh.');
      }
    });
  }, []);

  // -------------------------------------------------------------------------
  // IPC event listeners
  // -------------------------------------------------------------------------
  useEffect(() => {
    api.onMinerLog((line) => {
      setLogs((prev) => [...prev.slice(-499), line]);
    });
    api.onMinerStopped(() => {
      setSnapshot((s) => ({ ...s, running: false }));
      stopPoll();
    });
    return () => {
      api.removeAllListeners('miner:log');
      api.removeAllListeners('miner:stopped');
    };
  }, []);

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------
  const startPoll = useCallback(() => {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(async () => {
      const { ok, data } = await api.getMinerStatus();
      if (ok && data) setSnapshot(data);
    }, POLL_MS);
  }, []);

  const stopPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const startMining = useCallback(async (cfg: MinerConfig) => {
    setError(null);
    setLogs([]);
    setConfig(cfg);
    const { ok } = await api.startMiner(cfg);
    if (ok) {
      setSnapshot((s) => ({ ...s, running: true }));
      startPoll();
      setPage('dashboard');
    } else {
      setError('Failed to start bucksminer. Check the binary and config.');
    }
  }, [startPoll]);

  const stopMining = useCallback(async () => {
    await api.stopMiner();
    stopPoll();
    setSnapshot((s) => ({ ...s, running: false }));
  }, [stopPoll]);

  const saveConfig = useCallback(async (cfg: MinerConfig) => {
    setConfig(cfg);
    const toml = buildToml(cfg);
    await api.writeConfig(toml);
  }, []);

  return {
    page, setPage,
    config, setConfig,
    snapshot,
    logs,
    error, setError,
    binaryOk,
    startMining,
    stopMining,
    saveConfig,
  };
}

// ---------------------------------------------------------------------------
// TOML serializer (minimal — covers our miner config shape)
// ---------------------------------------------------------------------------
function buildToml(cfg: MinerConfig): string {
  return `[wallet]
address = "${cfg.walletAddress}"

[node]
rpc_url = "${cfg.nodeUrl}"

[pool]
url    = "${cfg.poolUrl}"
worker = "${cfg.worker}"

[mining]
mode    = "${cfg.mode}"
threads = ${cfg.threads}
submit_stale = false
work_poll_interval = 2000

[api]
enabled = true
addr    = "127.0.0.1:8194"

[log]
level  = "info"
format = "pretty"
`;
}

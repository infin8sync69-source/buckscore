/**
 * Dashboard.tsx — live mining dashboard.
 *
 * Shows: status indicator, live hashrate area chart (120s rolling window),
 * 4-stat grid, recent log console, and Start / Stop control.
 */

import React, { useRef, useEffect } from 'react';
import HashrateChart from '../components/HashrateChart';
import StatsPanel    from '../components/StatsPanel';
import type { MinerSnapshot, MinerConfig } from '../types';

interface Props {
  snapshot:    MinerSnapshot;
  config:      MinerConfig;
  logs:        string[];
  startMining: (cfg: MinerConfig) => Promise<void>;
  stopMining:  ()                 => Promise<void>;
}

function formatHps(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(3)} GH/s`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(3)} MH/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} KH/s`;
  return `${v.toFixed(0)} H/s`;
}

export default function Dashboard({ snapshot, config, logs, startMining, stopMining }: Props) {
  const { running, hashrate, currentHeight, currentHash } = snapshot;
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="scrollable flex-1 p-4 flex flex-col gap-4">

      {/* Top status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${running ? 'online' : 'offline'}`} />
          <span className="text-sm font-semibold" style={{ color: running ? 'var(--color-green)' : 'var(--color-text-muted)' }}>
            {running ? 'Mining' : 'Stopped'}
          </span>
          {running && (
            <span className="text-sm ml-2" style={{ color: 'var(--color-gold)' }}>
              {formatHps(hashrate)}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {running ? (
            <button className="btn btn-danger" onClick={stopMining}>
              ■ Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => startMining(config)}>
              ⛏ Resume
            </button>
          )}
        </div>
      </div>

      {/* Hashrate chart */}
      <div className="card">
        <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
          HASHRATE — 120s ROLLING WINDOW
        </div>
        <HashrateChart history={snapshot.history} />
      </div>

      {/* Stats */}
      <StatsPanel snapshot={snapshot} />

      {/* Current work */}
      {running && currentHeight > 0 && (
        <div className="card-sm flex flex-col gap-1 text-xs font-mono"
             style={{ color: 'var(--color-text-muted)' }}>
          <span>Block  <span style={{ color: 'var(--color-text)' }}>#{currentHeight}</span></span>
          <span className="truncate">Target <span style={{ color: 'var(--color-text)' }}>{currentHash.slice(0, 24)}…</span></span>
          <span>Mode   <span style={{ color: 'var(--color-text)' }}>{config.mode === 'solo' ? 'Solo · ' + config.nodeUrl : 'Pool · ' + config.poolUrl}</span></span>
        </div>
      )}

      {/* Log console */}
      <div>
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
          MINER LOG
        </div>
        <div className="log-console" ref={logRef}>
          {logs.length === 0
            ? <span style={{ color: 'var(--color-text-muted)' }}>Waiting for log output…</span>
            : logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))
          }
        </div>
      </div>

    </div>
  );
}

/**
 * StatsPanel — four key stat tiles arranged in a 2×2 grid.
 */

import React from 'react';
import type { MinerSnapshot } from '../types';

function formatHps(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GH/s`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MH/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} KH/s`;
  return `${v.toFixed(0)} H/s`;
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

interface StatTileProps {
  label: string;
  value: string;
  sub?:  string;
}

function StatTile({ label, value, sub }: StatTileProps) {
  return (
    <div className="card-sm flex flex-col">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{sub}</div>}
    </div>
  );
}

interface Props {
  snapshot: MinerSnapshot;
}

export default function StatsPanel({ snapshot }: Props) {
  const { hashrate, avgHashrate, sharesAccepted, sharesRejected, blocksFound, uptime, workers } = snapshot;
  const total   = sharesAccepted + sharesRejected;
  const rejectRate = total > 0 ? ((sharesRejected / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatTile
        label="Hashrate"
        value={formatHps(hashrate)}
        sub={`avg ${formatHps(avgHashrate)}`}
      />
      <StatTile
        label="Shares"
        value={`${sharesAccepted}✓`}
        sub={`${sharesRejected} rejected (${rejectRate}%)`}
      />
      <StatTile
        label="Blocks Found"
        value={String(blocksFound)}
        sub={`${workers} thread${workers !== 1 ? 's' : ''} active`}
      />
      <StatTile
        label="Uptime"
        value={formatUptime(uptime)}
      />
    </div>
  );
}

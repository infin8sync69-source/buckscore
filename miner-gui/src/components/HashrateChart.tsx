/**
 * HashrateChart — animated area chart of the rolling 120-second hashrate
 * history, powered by Recharts.
 */

import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { HashrateSample } from '../types';

interface Props {
  history: HashrateSample[];
}

function formatHps(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GH/s`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MH/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} KH/s`;
  return `${v.toFixed(0)} H/s`;
}

function formatTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

export default function HashrateChart({ history }: Props) {
  const data = history.map((s) => ({ t: s.t, hs: s.hs, label: formatTime(s.t) }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="gold-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"   stopColor="#c9a84c" stopOpacity={0.4} />
            <stop offset="95%"  stopColor="#c9a84c" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
          interval="preserveStartEnd"
          minTickGap={30}
        />
        <YAxis
          tickFormatter={formatHps}
          tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
          width={68}
        />
        <Tooltip
          formatter={(val: number) => [formatHps(val), 'Hashrate']}
          labelFormatter={(l) => `time ${l}`}
          contentStyle={{
            background:   'var(--color-surface)',
            border:       '1px solid var(--color-border)',
            borderRadius: '6px',
            fontSize:     '12px',
            color:        'var(--color-text)',
          }}
        />
        <Area
          type="monotone"
          dataKey="hs"
          stroke="#c9a84c"
          strokeWidth={2}
          fill="url(#gold-grad)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

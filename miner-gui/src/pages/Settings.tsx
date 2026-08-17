/**
 * Settings.tsx — edit miner config while not mining; saves to ~/.bucks/miner.toml.
 */

import React, { useState, useEffect } from 'react';
import type { MinerConfig } from '../types';

interface Props {
  config:      MinerConfig;
  snapshot:    { running: boolean };
  saveConfig:  (cfg: MinerConfig) => Promise<void>;
  setPage:     (page: 'setup' | 'dashboard' | 'settings') => void;
}

export default function Settings({ config: initCfg, snapshot, saveConfig, setPage }: Props) {
  const [cfg,   setCfg]   = useState<MinerConfig>({ ...initCfg });
  const [saved, setSaved] = useState(false);

  useEffect(() => { setCfg({ ...initCfg }); }, [initCfg]);

  const update = (k: keyof MinerConfig, v: string | number) =>
    setCfg((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    await saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isRunning = snapshot.running;

  return (
    <div className="scrollable flex-1 p-5 flex flex-col gap-5">
      <h2 className="font-semibold text-base">Settings</h2>

      {isRunning && (
        <div className="card-sm text-sm" style={{ borderColor: 'var(--color-gold)', color: 'var(--color-gold)' }}>
          ⚠ Stop the miner before changing settings.
        </div>
      )}

      {/* Wallet */}
      <section className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Wallet</h3>
        <div>
          <label className="label">Reward Address</label>
          <input
            className="input"
            disabled={isRunning}
            value={cfg.walletAddress}
            onChange={(e) => update('walletAddress', e.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
        </div>
      </section>

      {/* Node / Pool */}
      <section className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Network</h3>
        <div>
          <label className="label">Mining Mode</label>
          <div className="flex gap-2">
            {(['solo', 'pool'] as const).map((m) => (
              <button
                key={m}
                disabled={isRunning}
                className={`btn flex-1 ${cfg.mode === m ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => update('mode', m)}
              >
                {m === 'solo' ? '⛏ Solo' : '🔗 Pool'}
              </button>
            ))}
          </div>
        </div>
        {cfg.mode === 'solo' ? (
          <div>
            <label className="label">Node RPC URL</label>
            <input
              className="input"
              disabled={isRunning}
              value={cfg.nodeUrl}
              onChange={(e) => update('nodeUrl', e.target.value)}
              placeholder="http://127.0.0.1:8192"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="label">Pool Stratum URL</label>
              <input
                className="input"
                disabled={isRunning}
                value={cfg.poolUrl}
                onChange={(e) => update('poolUrl', e.target.value)}
                placeholder="stratum+tcp://pool.bucks.net:4444"
              />
            </div>
            <div>
              <label className="label">Worker Name</label>
              <input
                className="input"
                disabled={isRunning}
                value={cfg.worker}
                onChange={(e) => update('worker', e.target.value)}
                placeholder="worker1"
              />
            </div>
          </div>
        )}
      </section>

      {/* Performance */}
      <section className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Performance</h3>
        <div>
          <label className="label">CPU Threads (0 = all cores)</label>
          <input
            className="input"
            type="number"
            min={0}
            max={256}
            disabled={isRunning}
            value={cfg.threads}
            onChange={(e) => update('threads', parseInt(e.target.value, 10) || 0)}
          />
        </div>
      </section>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          className="btn btn-primary"
          disabled={isRunning}
          onClick={handleSave}
        >
          {saved ? '✓ Saved' : 'Save Configuration'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setPage('dashboard')}
        >
          ← Dashboard
        </button>
        <button
          className="btn btn-ghost ml-auto"
          disabled={isRunning}
          onClick={() => setPage('setup')}
        >
          Re-run Wizard
        </button>
      </div>

      <p className="text-xs mt-auto" style={{ color: 'var(--color-text-muted)' }}>
        Config saved to <code className="font-mono">~/.bucks/miner.toml</code>
      </p>
    </div>
  );
}

/**
 * Setup.tsx — 3-step first-run wizard.
 *
 * Step 1: Wallet address
 * Step 2: Mining mode (solo / pool) + node/pool URL
 * Step 3: Performance (threads) + review → Start
 */

import React, { useState } from 'react';
import type { MinerConfig } from '../types';

interface Props {
  config:       MinerConfig;
  binaryOk:     boolean | null;
  error:        string | null;
  startMining:  (cfg: MinerConfig) => Promise<void>;
  openExternal: (url: string) => void;
}

const TOTAL_STEPS = 3;

export default function Setup({ config: initConfig, binaryOk, error, startMining }: Props) {
  const [step, setStep] = useState(1);
  const [cfg,  setCfg]  = useState<MinerConfig>({ ...initConfig });
  const [busy, setBusy] = useState(false);

  const update = (k: keyof MinerConfig, v: string | number) =>
    setCfg((prev) => ({ ...prev, [k]: v }));

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  const handleStart = async () => {
    setBusy(true);
    await startMining(cfg);
    setBusy(false);
  };

  const canNext1 = /^0x[0-9a-fA-F]{40}$/.test(cfg.walletAddress);
  const canNext2 = cfg.mode === 'solo' ? !!cfg.nodeUrl : !!cfg.poolUrl;

  return (
    <div className="scrollable flex-1 p-6 flex flex-col items-center justify-center gap-6">

      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-gold)' }}>
          Bucks Miner Setup
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Configure once and start earning BUCKS
        </p>
      </div>

      {/* Binary warning */}
      {binaryOk === false && (
        <div className="card w-full max-w-lg" style={{ borderColor: 'var(--color-red)' }}>
          <p className="text-sm" style={{ color: 'var(--color-red)' }}>
            ⚠ bucksminer binary not found. Build it with{' '}
            <code className="font-mono text-xs">miner/build/build-all.sh</code> first.
          </p>
        </div>
      )}

      {/* Step indicators */}
      <div className="wizard-step-indicator">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={`step-dot ${step > i + 1 ? 'complete' : step === i + 1 ? 'active' : ''}`}
          />
        ))}
      </div>

      {/* Step cards */}
      <div className="card w-full max-w-lg">

        {/* ---- Step 1: Wallet address ---- */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold text-base">Step 1 — Wallet Address</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Mining rewards will be sent to this address. Use the Bucks Wallet extension to
              create or copy your address.
            </p>
            <div>
              <label className="label">Your BUCKS wallet address</label>
              <input
                className="input"
                placeholder="0x…"
                value={cfg.walletAddress}
                onChange={(e) => update('walletAddress', e.target.value)}
                spellCheck={false}
              />
              {cfg.walletAddress && !canNext1 && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-red)' }}>
                  Must be a valid 0x-prefixed 40-character hex address.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={!canNext1} onClick={next}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ---- Step 2: Mode & network ---- */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold text-base">Step 2 — Mining Mode</h2>

            {/* Mode toggle */}
            <div className="flex gap-2">
              {(['solo', 'pool'] as const).map((m) => (
                <button
                  key={m}
                  className={`btn flex-1 ${cfg.mode === m ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => update('mode', m)}
                >
                  {m === 'solo' ? '⛏ Solo' : '🔗 Pool'}
                </button>
              ))}
            </div>

            {cfg.mode === 'solo' ? (
              <div>
                <label className="label">Node RPC URL</label>
                <input
                  className="input"
                  value={cfg.nodeUrl}
                  onChange={(e) => update('nodeUrl', e.target.value)}
                  placeholder="http://127.0.0.1:8192"
                />
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  Run a Bucks node locally or point to a remote node.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="label">Pool Stratum URL</label>
                  <input
                    className="input"
                    value={cfg.poolUrl}
                    onChange={(e) => update('poolUrl', e.target.value)}
                    placeholder="stratum+tcp://pool.bucks.net:4444"
                  />
                </div>
                <div>
                  <label className="label">Worker name</label>
                  <input
                    className="input"
                    value={cfg.worker}
                    onChange={(e) => update('worker', e.target.value)}
                    placeholder="worker1"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <button className="btn btn-ghost" onClick={back}>← Back</button>
              <button className="btn btn-primary" disabled={!canNext2} onClick={next}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ---- Step 3: Performance & launch ---- */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-semibold text-base">Step 3 — Performance & Launch</h2>

            <div>
              <label className="label">CPU Threads (0 = auto)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={256}
                value={cfg.threads}
                onChange={(e) => update('threads', parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                0 uses all available CPU cores. Reduce if your computer feels sluggish.
              </p>
            </div>

            {/* Summary */}
            <div className="card-sm text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
              <div>Address : <span style={{ color: 'var(--color-text)' }}>{cfg.walletAddress.slice(0,10)}…</span></div>
              <div>Mode    : <span style={{ color: 'var(--color-text)' }}>{cfg.mode}</span></div>
              <div>{cfg.mode === 'solo' ? 'Node' : 'Pool'} URL : <span style={{ color: 'var(--color-text)' }}>{cfg.mode === 'solo' ? cfg.nodeUrl : cfg.poolUrl}</span></div>
              <div>Threads : <span style={{ color: 'var(--color-text)' }}>{cfg.threads || 'auto'}</span></div>
            </div>

            {error && (
              <p className="text-sm" style={{ color: 'var(--color-red)' }}>⚠ {error}</p>
            )}

            <div className="flex justify-between">
              <button className="btn btn-ghost" onClick={back}>← Back</button>
              <button
                className="btn btn-primary"
                disabled={busy || binaryOk === false}
                onClick={handleStart}
              >
                {busy ? 'Starting…' : '⛏ Start Mining'}
              </button>
            </div>
          </div>
        )}

      </div>

      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        1 BUCKS = the classical gold standard weight (mithqal) · Chain ID 8192
      </p>
    </div>
  );
}

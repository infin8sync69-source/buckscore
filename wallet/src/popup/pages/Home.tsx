/**
 * Home — the main wallet dashboard.
 * Shows: active account address, BUCKS balance, recent activity, Send/Receive CTAs.
 */

import { useState, useEffect } from 'react';
import type { WalletState }    from '../../types';
import { eth_getBalance, formatBucks, grainHexToBucks } from '../../rpc/client';
import { checksumAddress, shortAddress } from '../../crypto/hdkey';
import { sendToBackground } from '../hooks/useWallet';

interface HomeProps {
  walletState: WalletState;
  onSend:      () => void;
  onReceive:   () => void;
}

export default function Home({ walletState, onSend, onReceive }: HomeProps) {
  const account = walletState.accounts[walletState.activeAccount];
  const [balance,  setBalance]  = useState<string | null>(null);
  const [copied,   setCopied]   = useState(false);
  const [locking,  setLocking]  = useState(false);

  const address = account?.address ?? '';

  useEffect(() => {
    if (!address) return;
    eth_getBalance(address).then((hex) => {
      setBalance(grainHexToBucks(hex));
    }).catch(() => setBalance(null));
  }, [address]);

  function handleCopyAddress() {
    navigator.clipboard.writeText(checksumAddress(address)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function handleLock() {
    setLocking(true);
    await sendToBackground('WALLET_LOCK');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 580 }}>
      {/* ---- Top bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AccountDot />
          <span style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Account {(walletState.activeAccount ?? 0) + 1}
          </span>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => void handleLock()}
          disabled={locking}
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
          title="Lock wallet"
        >
          🔒 Lock
        </button>
      </div>

      {/* ---- Balance card ---- */}
      <div style={{
        margin: '1.5rem 1.25rem 1rem',
        background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(212,175,55,0.04))',
        border: '1px solid rgba(212,175,55,0.25)',
        borderRadius: '1rem',
        padding: '1.5rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Balance
        </div>
        <div style={{ fontSize: '2rem', fontWeight: '700', color: '#d4af37', lineHeight: 1.2 }}>
          {balance !== null ? (
            <>
              {parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}
              <span style={{ fontSize: '1rem', marginLeft: '0.375rem', color: '#b8962e' }}>BUCKS</span>
            </>
          ) : (
            <span style={{ fontSize: '1.25rem', color: 'var(--muted)' }}>—</span>
          )}
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', marginTop: '0.375rem' }}>
          ≈ the classical gold standard weight (mithqal) unit
        </div>

        {/* Address row */}
        <button
          onClick={handleCopyAddress}
          style={{
            marginTop: '1rem',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border)',
            borderRadius: '2rem',
            padding: '0.375rem 0.875rem',
            cursor: 'pointer',
            color: 'var(--muted)',
            fontSize: '0.8125rem',
            fontFamily: 'monospace',
            transition: 'all 0.15s',
          }}
        >
          {copied ? '✓ Copied!' : shortAddress(address || '0x0000000000000000000000000000000000000000', 6)}
        </button>
      </div>

      {/* ---- Action buttons ---- */}
      <div style={{ display: 'flex', gap: '0.75rem', padding: '0 1.25rem', marginBottom: '1.5rem' }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={onSend}>
          ↑ Send
        </button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onReceive}>
          ↓ Receive
        </button>
      </div>

      {/* ---- Activity ---- */}
      <div style={{ padding: '0 1.25rem', flex: 1 }}>
        <h3 style={{ marginBottom: '0.75rem', color: 'var(--muted)', fontSize: '0.75rem',
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Recent Activity
        </h3>
        <EmptyActivity />
      </div>

      {/* ---- Network indicator ---- */}
      <div style={{
        padding: '0.75rem 1.25rem',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        fontSize: '0.75rem', color: 'var(--muted)',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#50c878', display: 'inline-block' }} />
        Bucks Mainnet · Chain 8192
      </div>
    </div>
  );
}

function AccountDot() {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: 'linear-gradient(135deg, #d4af37, #7a611a)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', color: '#0a0a1e', fontWeight: 700,
    }}>
      A
    </div>
  );
}

function EmptyActivity() {
  return (
    <div style={{
      textAlign: 'center', padding: '2rem 0',
      color: 'var(--muted)', fontSize: '0.875rem',
    }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
      No transactions yet
    </div>
  );
}

// suppress unused import warning
void formatBucks;

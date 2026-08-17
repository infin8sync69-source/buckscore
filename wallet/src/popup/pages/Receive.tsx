/**
 * Receive — display wallet address and QR code for incoming BUCKS.
 */

import { useState } from 'react';
import type { WalletState }   from '../../types';
import { checksumAddress }    from '../../crypto/hdkey';

interface ReceiveProps {
  walletState: WalletState;
  onBack:      () => void;
}

export default function Receive({ walletState, onBack }: ReceiveProps) {
  const account  = walletState.accounts[walletState.activeAccount];
  const address  = account?.address ?? '';
  const checksum = address ? checksumAddress(address) : '';
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(checksum).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', minHeight: 580 }}>
      {/* Back */}
      <button className="btn btn-ghost" onClick={onBack}
        style={{ alignSelf: 'flex-start', marginBottom: '1rem', padding: '0.25rem 0' }}>
        ← Back
      </button>

      <h2 style={{ marginBottom: '0.25rem' }}>Receive BUCKS</h2>
      <p style={{ marginBottom: '1.5rem' }}>
        Share your address to receive BUCKS. Only send BUCKS (Chain 8192) to this address.
      </p>

      {/* QR code placeholder — replaced by an svg QR library in Phase 3 */}
      <div style={{
        alignSelf: 'center',
        width: 200, height: 200,
        background: 'white',
        borderRadius: '0.75rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '1.5rem',
        boxShadow: '0 0 20px rgba(212,175,55,0.2)',
      }}>
        <QRPlaceholder address={checksum} />
      </div>

      {/* Address display */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.75rem',
        padding: '1rem',
        textAlign: 'center',
        marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem',
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Your Bucks Address
        </div>
        <div style={{
          fontFamily: 'monospace', fontSize: '0.75rem',
          color: 'var(--text)', wordBreak: 'break-all', lineHeight: 1.5,
        }}>
          {checksum}
        </div>
      </div>

      {/* Copy button */}
      <button
        className="btn btn-primary btn-full"
        onClick={handleCopy}
      >
        {copied ? '✓ Address Copied!' : '📋 Copy Address'}
      </button>

      {/* Warning */}
      <div style={{
        marginTop: '1.25rem',
        background: 'rgba(212,175,55,0.06)',
        border: '1px solid rgba(212,175,55,0.15)',
        borderRadius: '0.5rem',
        padding: '0.75rem 1rem',
        fontSize: '0.8125rem',
        color: '#d4af37',
        lineHeight: 1.5,
      }}>
        ⚠️  Only send BUCKS on Chain 8192. Sending assets from other chains
        may result in permanent loss.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QR placeholder (real QR library integrated in Phase 3)
// ---------------------------------------------------------------------------

function QRPlaceholder({ address }: { address: string }) {
  // Generate a simple visual hash-grid from the address as a temporary stand-in.
  const cells = address.replace(/^0x/, '').slice(0, 64).split('');

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(8, 1fr)',
      gap: 1,
      padding: 8,
      width: '100%',
      height: '100%',
    }}>
      {Array.from({ length: 64 }, (_, i) => {
        const hex = cells[i] ?? '0';
        const val = parseInt(hex, 16);
        const dark = val < 8;
        return (
          <div
            key={i}
            style={{
              background: dark ? '#0a0a1e' : '#f0f0f0',
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

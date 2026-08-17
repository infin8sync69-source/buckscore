/**
 * Send — compose and submit a BUCKS transfer.
 */

import { useState } from 'react';
import type { WalletState, UnsignedTx } from '../../types';
import { bucksToGrain, eth_gasPrice, eth_getTransactionCount } from '../../rpc/client';
import { isValidAddress } from '../../crypto/hdkey';
import { sendToBackground } from '../hooks/useWallet';

interface SendProps {
  walletState: WalletState;
  onBack:      () => void;
}

type SendStep = 'compose' | 'confirm' | 'broadcast' | 'success' | 'error';

export default function Send({ walletState, onBack }: SendProps) {
  const account  = walletState.accounts[walletState.activeAccount];
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [step,   setStep]   = useState<SendStep>('compose');
  const [txHash, setTxHash] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [loading,setLoading]= useState(false);

  const addrValid  = isValidAddress(toAddr);
  const amountNum  = parseFloat(amount);
  const amountValid = !isNaN(amountNum) && amountNum > 0;
  const canContinue = addrValid && amountValid;

  async function handleBroadcast() {
    setLoading(true);
    try {
      // Build unsigned transaction.
      const gasPriceHex = await eth_gasPrice();
      const nonceHex    = await eth_getTransactionCount(account.address);
      const nonce       = parseInt(nonceHex, 16);

      const tx: UnsignedTx = {
        from:     account.address,
        to:       toAddr,
        value:    bucksToGrain(amount).toString(),
        gas:      '0x5208', // 21000
        gasPrice: gasPriceHex,
        nonce,
        chainId:  8192,
      };

      // Sign via background.
      const signResp = await sendToBackground('TX_SIGN', {
        tx,
        accountIndex: walletState.activeAccount,
      });

      const signed = signResp.result as { rawTx: string };

      // Broadcast.
      const broadcastResp = await sendToBackground('RPC_REQUEST', {
        method: 'eth_sendRawTransaction',
        params: [signed.rawTx],
      });

      setTxHash(broadcastResp.result as string);
      setStep('success');
    } catch (e) {
      setErrMsg((e as Error).message);
      setStep('error');
    } finally {
      setLoading(false);
    }
  }

  // ---- Render ----

  if (step === 'success') {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ marginBottom: '0.5rem' }}>Transaction Sent!</h2>
          <p>Your BUCKS are on their way.</p>
          <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--muted)',
            marginTop: '1rem', wordBreak: 'break-all', padding: '0 1rem' }}>
            {txHash}
          </div>
          <button className="btn btn-primary" style={{ marginTop: '2rem' }} onClick={onBack}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>❌</div>
          <h2>Transaction Failed</h2>
          <div className="alert alert-error" style={{ margin: '1rem 0', textAlign: 'left' }}>{errMsg}</div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep('compose')}>
              Try Again
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onBack}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div style={pageStyle}>
        <button className="btn btn-ghost" onClick={() => setStep('compose')}
          style={{ alignSelf: 'flex-start', marginBottom: '1rem', padding: '0.25rem 0' }}>
          ← Edit
        </button>
        <h2 style={{ marginBottom: '1.25rem' }}>Confirm Transaction</h2>

        <div className="card" style={{ marginBottom: '1rem' }}>
          <Row label="From"   value={shorten(account?.address ?? '')} mono />
          <Row label="To"     value={shorten(toAddr)} mono />
          <Row label="Amount" value={`${amount} BUCKS`} />
          <Row label="Gas"    value="~21,000 units" />
          <Row label="Network" value="Bucks Mainnet · Chain 8192" />
        </div>

        <p style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
          Once submitted, this transaction cannot be reversed.
        </p>

        <button
          className="btn btn-primary btn-full"
          onClick={() => { setStep('broadcast'); void handleBroadcast(); }}
          disabled={loading}
        >
          {loading ? 'Broadcasting…' : 'Confirm & Send'}
        </button>
        <button className="btn btn-ghost btn-full" style={{ marginTop: '0.5rem' }} onClick={onBack}>
          Cancel
        </button>
      </div>
    );
  }

  // Compose
  return (
    <div style={pageStyle}>
      <button className="btn btn-ghost" onClick={onBack}
        style={{ alignSelf: 'flex-start', marginBottom: '1rem', padding: '0.25rem 0' }}>
        ← Back
      </button>
      <h2 style={{ marginBottom: '1.25rem' }}>Send BUCKS</h2>

      <div className="field">
        <label className="input-label">Recipient Address</label>
        <input
          type="text"
          className={`input ${toAddr && !addrValid ? 'error' : ''}`}
          placeholder="0x…"
          value={toAddr}
          onChange={(e) => setToAddr(e.target.value.trim())}
          autoCapitalize="none"
          spellCheck={false}
        />
        {toAddr && !addrValid && (
          <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>
            Invalid address format
          </span>
        )}
      </div>

      <div className="field">
        <label className="input-label">Amount (BUCKS)</label>
        <input
          type="number"
          className="input"
          placeholder="0.000000"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem', display: 'block' }}>
          1 BUCKS = the classical gold standard weight (mithqal)
        </span>
      </div>

      <div style={{ flex: 1 }} />

      <button
        className="btn btn-primary btn-full"
        onClick={() => setStep('confirm')}
        disabled={!canContinue}
      >
        Review Transaction →
      </button>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)', fontSize: '0.8125rem' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontSize: '0.8125rem',
        fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

function shorten(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

const pageStyle: React.CSSProperties = {
  padding: '1.5rem', display: 'flex', flexDirection: 'column', minHeight: 580,
};

import { useState } from 'react';

interface ImportWalletProps {
  importWallet: (mnemonic: string, password: string) => Promise<void>;
  onBack:       () => void;
  onDone:       () => void;
}

export default function ImportWallet({ importWallet, onBack, onDone }: ImportWalletProps) {
  const [mnemonic,  setMnemonic]  = useState('');
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;

  async function handleImport() {
    setError('');

    if (wordCount !== 24) {
      setError(`Mnemonic must be 24 words. You've entered ${wordCount}.`);
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await importWallet(mnemonic.trim().toLowerCase(), password);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', minHeight: 580 }}>
      {/* Header */}
      <button
        className="btn btn-ghost"
        onClick={onBack}
        style={{ alignSelf: 'flex-start', marginBottom: '1rem', padding: '0.25rem 0' }}
      >
        ← Back
      </button>

      <h2 style={{ marginBottom: '0.25rem' }}>Import Wallet</h2>
      <p style={{ marginBottom: '1.25rem' }}>
        Enter your 24-word BIP-8192 seed phrase to restore your wallet.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Mnemonic textarea */}
      <div className="field">
        <label className="input-label">
          Seed Phrase
          <span style={{ color: wordCount === 24 ? 'var(--success)' : 'var(--muted)', marginLeft: '0.5rem' }}>
            {wordCount}/24 words
          </span>
        </label>
        <textarea
          className="input"
          rows={5}
          placeholder="Enter your 24 words separated by spaces…"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ resize: 'none', fontFamily: 'monospace', fontSize: '0.8125rem' }}
        />
      </div>

      {/* Password */}
      <div className="field">
        <label className="input-label">New Password</label>
        <input
          type="password"
          className="input"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="input-label">Confirm Password</label>
        <input
          type="password"
          className="input"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleImport()}
        />
      </div>

      <div style={{ flex: 1 }} />

      <button
        className="btn btn-primary btn-full"
        onClick={() => void handleImport()}
        disabled={loading || wordCount !== 24 || !password || !confirm}
      >
        {loading ? 'Importing…' : 'Import Wallet'}
      </button>

      <p style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', marginTop: '0.75rem' }}>
        Your seed phrase never leaves this device.
      </p>
    </div>
  );
}

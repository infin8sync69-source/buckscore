/**
 * CreateWallet — 3-step flow:
 *   Step 1: Set password
 *   Step 2: View & confirm mnemonic (must write it down)
 *   Step 3: Verify mnemonic (type back 3 random words)
 */

import { useState } from 'react';

interface CreateWalletProps {
  createWallet: (password: string) => Promise<string>;
  onBack:       () => void;
  onDone:       () => void;
}

type Step = 'password' | 'backup' | 'verify' | 'done';

export default function CreateWallet({ createWallet, onBack, onDone }: CreateWalletProps) {
  const [step,      setStep]      = useState<Step>('password');
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [mnemonic,  setMnemonic]  = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [verified,  setVerified]  = useState(false);

  // Verification: pick 3 random word indices to confirm.
  const [verifySlots] = useState<number[]>(() => {
    const indices: number[] = [];
    while (indices.length < 3) {
      const n = Math.floor(Math.random() * 24);
      if (!indices.includes(n)) indices.push(n);
    }
    return indices.sort((a, b) => a - b);
  });
  const [verifyInputs, setVerifyInputs] = useState<Record<number, string>>({});

  const words = mnemonic ? mnemonic.split(' ') : [];

  // ---- Step 1: password ----
  async function handleSetPassword() {
    setError('');
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
      const mn = await createWallet(password);
      setMnemonic(mn);
      setStep('backup');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ---- Step 3: verify ----
  function handleVerify() {
    const correct = verifySlots.every(
      (idx) => verifyInputs[idx]?.trim().toLowerCase() === words[idx]?.toLowerCase()
    );
    if (!correct) {
      setError('Some words don\'t match. Check your backup and try again.');
      return;
    }
    setVerified(true);
    setStep('done');
  }

  // ---- Render ----

  if (step === 'password') {
    return (
      <div style={pageStyle}>
        <BackButton onClick={onBack} />
        <h2 style={{ marginBottom: '0.25rem' }}>Create Wallet</h2>
        <p>Choose a strong password to lock your wallet.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field">
          <label className="input-label">Password</label>
          <input
            type="password"
            className="input"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
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
            onKeyDown={(e) => e.key === 'Enter' && void handleSetPassword()}
          />
        </div>

        <button
          className="btn btn-primary btn-full"
          onClick={() => void handleSetPassword()}
          disabled={loading || !password || !confirm}
          style={{ marginTop: '0.5rem' }}
        >
          {loading ? <span className="spin">⏳</span> : 'Continue'}
        </button>
      </div>
    );
  }

  if (step === 'backup') {
    return (
      <div style={pageStyle}>
        <h2 style={{ marginBottom: '0.25rem' }}>Backup Your Seed Phrase</h2>
        <p style={{ marginBottom: '1rem' }}>
          Write down these 24 words in order. Store them somewhere safe.
          This is the <strong style={{ color: '#e8e8f0' }}>only way</strong> to
          recover your wallet.
        </p>

        <div style={{
          background: 'rgba(212,175,55,0.06)',
          border: '1px solid rgba(212,175,55,0.2)',
          borderRadius: 8, padding: '0.75rem',
          marginBottom: '1rem', fontSize: '0.75rem', color: '#d4af37',
        }}>
          ⚠️  Never share your seed phrase. Bucks support will never ask for it.
        </div>

        <div className="mnemonic-grid">
          {words.map((word, i) => (
            <div key={i} className="mnemonic-word">
              <span className="num">{i + 1}.</span>
              <span className="word">{word}</span>
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary btn-full"
          style={{ marginTop: '1rem' }}
          onClick={() => setStep('verify')}
        >
          I've Written It Down →
        </button>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div style={pageStyle}>
        <h2 style={{ marginBottom: '0.25rem' }}>Verify Your Backup</h2>
        <p>Enter the words at the requested positions to confirm you have saved your phrase.</p>

        {error && <div className="alert alert-error">{error}</div>}

        {verifySlots.map((idx) => (
          <div key={idx} className="field">
            <label className="input-label">Word #{idx + 1}</label>
            <input
              type="text"
              className="input"
              placeholder={`Word ${idx + 1}`}
              value={verifyInputs[idx] ?? ''}
              onChange={(e) =>
                setVerifyInputs((prev) => ({ ...prev, [idx]: e.target.value }))
              }
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        ))}

        <button
          className="btn btn-primary btn-full"
          onClick={handleVerify}
          disabled={verifySlots.some((i) => !verifyInputs[i])}
          style={{ marginTop: '0.5rem' }}
        >
          Verify & Continue
        </button>
      </div>
    );
  }

  // Step: done
  return (
    <div style={{ ...pageStyle, textAlign: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
      <h2>Wallet Created!</h2>
      <p>Your Bucks Wallet is ready. Your first address is derived from your BIP-8192 seed.</p>
      <button className="btn btn-primary btn-full" style={{ marginTop: '1.5rem' }} onClick={onDone}>
        Open Wallet
      </button>
      {void verified /* satisfy linter */}
    </div>
  );
}

// ---- Shared styles ----

const pageStyle: React.CSSProperties = {
  padding: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 580,
};

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="btn btn-ghost"
      onClick={onClick}
      style={{ alignSelf: 'flex-start', marginBottom: '1rem', padding: '0.25rem 0' }}
    >
      ← Back
    </button>
  );
}

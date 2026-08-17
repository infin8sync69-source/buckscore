import { useState } from 'react';

interface UnlockProps {
  unlockWallet:    (password: string) => Promise<void>;
  onForgotWallet:  () => void;
}

export default function Unlock({ unlockWallet, onForgotWallet }: UnlockProps) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleUnlock() {
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      await unlockWallet(password);
    } catch {
      setError('Incorrect password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2.5rem 1.5rem', minHeight: 580, gap: '1.25rem',
    }}>
      {/* Logo */}
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <circle cx="28" cy="28" r="26" stroke="#d4af37" strokeWidth="2"
          style={{ filter: 'drop-shadow(0 0 10px rgba(212,175,55,0.35))' }} />
        <circle cx="28" cy="28" r="20" fill="rgba(212,175,55,0.07)" />
        <text x="28" y="36" textAnchor="middle" fontSize="22" fontWeight="700"
          fill="#d4af37" fontFamily="serif">B</text>
      </svg>

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.25rem' }}>Welcome back</h2>
        <p>Enter your password to unlock your wallet.</p>
      </div>

      {error && <div className="alert alert-error" style={{ width: '100%', maxWidth: 280 }}>{error}</div>}

      <div style={{ width: '100%', maxWidth: 280 }}>
        <div className="field">
          <label className="input-label">Password</label>
          <input
            type="password"
            className={`input ${error ? 'error' : ''}`}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleUnlock()}
            autoFocus
          />
        </div>

        <button
          className="btn btn-primary btn-full"
          onClick={() => void handleUnlock()}
          disabled={loading || !password}
        >
          {loading ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>

      <button
        className="btn btn-ghost"
        onClick={onForgotWallet}
        style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}
      >
        Forgot password? Reset wallet
      </button>
    </div>
  );
}

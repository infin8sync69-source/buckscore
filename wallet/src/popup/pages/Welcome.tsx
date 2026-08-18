import { CHAIN_ID } from '../../crypto/constants';

interface WelcomeProps {
  onCreateWallet: () => void;
  onImportWallet: () => void;
}

export default function Welcome({ onCreateWallet, onImportWallet }: WelcomeProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2.5rem 1.5rem', minHeight: 580, gap: '1.5rem',
      textAlign: 'center',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: '0.5rem' }}>
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
          <circle cx="36" cy="36" r="34" stroke="#d4af37" strokeWidth="2"
            style={{ filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.4))' }} />
          <circle cx="36" cy="36" r="28" fill="rgba(212,175,55,0.08)" />
          <text x="36" y="47" textAnchor="middle" fontSize="30" fontWeight="700"
            fill="#d4af37" fontFamily="serif">B</text>
        </svg>
      </div>

      {/* Headline */}
      <div>
        <h1 style={{ color: '#e8e8f0', marginBottom: '0.5rem' }}>Bucks Wallet</h1>
        <p style={{ maxWidth: 260, margin: '0 auto', lineHeight: 1.6, color: '#8888aa' }}>
          Your gateway to the Bucks Blockchain — secured by the classical gold
          standard weight (mithqal).
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', maxWidth: 280 }}>
        <button className="btn btn-primary btn-full" onClick={onCreateWallet}>
          Create New Wallet
        </button>
        <button className="btn btn-secondary btn-full" onClick={onImportWallet}>
          Import Existing Wallet
        </button>
      </div>

      {/* Footer hint */}
      <p style={{ fontSize: '0.75rem', color: '#5555777', marginTop: '0.5rem' }}>
        Chain ID: {CHAIN_ID} · BIP-8192 seed standard
      </p>
    </div>
  );
}

/**
 * App — root component and page router for the Bucks Wallet popup.
 *
 * Routing is simple state-based (no React Router needed for an extension popup).
 *
 * Pages:
 *   uninitialized → Welcome
 *   locked        → Unlock
 *   unlocked      → Home | Send | Receive | Settings
 *   creating      → CreateWallet
 *   importing     → ImportWallet
 */

import { useState } from 'react';
import { useWallet } from './hooks/useWallet';

import Welcome       from './pages/Welcome';
import CreateWallet  from './pages/CreateWallet';
import ImportWallet  from './pages/ImportWallet';
import Unlock        from './pages/Unlock';
import Home          from './pages/Home';
import Send          from './pages/Send';
import Receive       from './pages/Receive';

// ---------------------------------------------------------------------------
// Page type
// ---------------------------------------------------------------------------

export type Page =
  | 'welcome'
  | 'create'
  | 'import'
  | 'unlock'
  | 'home'
  | 'send'
  | 'receive'
  | 'settings';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const { walletState, loading, createWallet, importWallet, unlockWallet } = useWallet();
  const [page, setPage] = useState<Page | null>(null);

  // ---- Resolve effective page ----
  const effectivePage: Page = (() => {
    if (loading) return 'welcome'; // show nothing meaningful while loading

    // User has manually navigated.
    if (page === 'create' || page === 'import') return page;

    // Route by wallet status.
    switch (walletState.status) {
      case 'uninitialized': return 'welcome';
      case 'locked':        return page === 'unlock' ? 'unlock' : 'unlock';
      case 'unlocked':
        return (page === 'send' || page === 'receive' || page === 'settings')
          ? page
          : 'home';
    }
  })();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', flexDirection: 'column', gap: '1rem',
      }}>
        <BucksLogo size={48} />
        <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ width: 360, minHeight: 580 }}>
      {effectivePage === 'welcome' && (
        <Welcome
          onCreateWallet={() => setPage('create')}
          onImportWallet={() => setPage('import')}
        />
      )}

      {effectivePage === 'create' && (
        <CreateWallet
          createWallet={createWallet}
          onBack={() => setPage('welcome')}
          onDone={() => setPage('home')}
        />
      )}

      {effectivePage === 'import' && (
        <ImportWallet
          importWallet={importWallet}
          onBack={() => setPage('welcome')}
          onDone={() => setPage('home')}
        />
      )}

      {effectivePage === 'unlock' && (
        <Unlock
          unlockWallet={unlockWallet}
          onForgotWallet={() => setPage('welcome')}
        />
      )}

      {effectivePage === 'home' && (
        <Home
          walletState={walletState}
          onSend={() => setPage('send')}
          onReceive={() => setPage('receive')}
        />
      )}

      {effectivePage === 'send' && (
        <Send
          walletState={walletState}
          onBack={() => setPage('home')}
        />
      )}

      {effectivePage === 'receive' && (
        <Receive
          walletState={walletState}
          onBack={() => setPage('home')}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo component (used in loading state)
// ---------------------------------------------------------------------------

function BucksLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="19" stroke="#d4af37" strokeWidth="1.5" />
      <text
        x="20" y="26"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fill="#d4af37"
        fontFamily="serif"
      >
        ₿
      </text>
    </svg>
  );
}

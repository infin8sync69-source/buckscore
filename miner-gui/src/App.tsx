/**
 * App.tsx — root component.
 *
 * Owns all miner state (via useMiner) and renders the correct page based on
 * the routing state. The title-bar drag region sits at the very top so the
 * macOS traffic-light buttons remain functional.
 */

import React from 'react';
import { useMiner } from './hooks/useMiner';
import Setup     from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Settings  from './pages/Settings';
import type { Page } from './types';

const NAV: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings',  label: 'Settings'  },
];

export default function App() {
  const miner = useMiner();
  const { page, setPage } = miner;

  return (
    <div className="app-shell">
      {/* macOS drag region */}
      <div className="titlebar-drag flex items-center px-4 gap-2">
        <span className="titlebar-nodrag ml-auto text-xs font-semibold tracking-widest"
              style={{ color: 'var(--color-gold)' }}>
          BUCKS MINER
        </span>
        {page !== 'setup' && (
          <nav className="titlebar-nodrag flex ml-4 gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`nav-tab titlebar-nodrag ${page === n.id ? 'active' : ''}`}
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Page content */}
      <div className="main-content">
        {page === 'setup'     && <Setup     {...miner} />}
        {page === 'dashboard' && <Dashboard {...miner} />}
        {page === 'settings'  && <Settings  {...miner} />}
      </div>
    </div>
  );
}

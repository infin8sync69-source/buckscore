/**
 * Bucks Wallet — Background Service Worker (Manifest V3)
 *
 * Lifecycle:
 *   - install:  Fresh install; set default state.
 *   - activate: SW takes control; register message handlers.
 *   - message:  All popup ↔ content ↔ inpage messages route through here.
 *   - alarm:    Periodic tasks (auto-lock check, balance refresh).
 */

import { registerHandlers } from './handler';
import { closeVault } from './vault';

// ---------------------------------------------------------------------------
// Service worker lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', () => {
  // Skip waiting — take control immediately on install.
  (self as unknown as ServiceWorkerGlobalScope).skipWaiting();
  console.log('[BucksWallet] Service worker installed');
});

self.addEventListener('activate', (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    (async () => {
      // Claim all open tabs/windows immediately.
      await (self as unknown as ServiceWorkerGlobalScope).clients.claim();
      console.log('[BucksWallet] Service worker activated');
    })()
  );
});

// ---------------------------------------------------------------------------
// Message handler registration
// ---------------------------------------------------------------------------

registerHandlers();

// ---------------------------------------------------------------------------
// Chrome extension event listeners
// ---------------------------------------------------------------------------

// Lock the wallet when the browser starts (service worker cold-starts with empty vault).
chrome.runtime.onStartup.addListener(() => {
  closeVault();
  console.log('[BucksWallet] Browser started — wallet locked');
});

// Auto-lock on extension suspend (service worker hibernation).
chrome.runtime.onSuspend?.addListener(() => {
  closeVault();
  console.log('[BucksWallet] Service worker suspending — wallet locked');
});

// Handle alarms for periodic tasks.
chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case 'bucks:balance-refresh':
      // Background balance polling — pumped in Phase 3.
      break;
    default:
      break;
  }
});

// Create a recurring balance-refresh alarm.
chrome.alarms.create('bucks:balance-refresh', { periodInMinutes: 1 });

// ---------------------------------------------------------------------------
// External (dApp) connection listener
// ---------------------------------------------------------------------------

chrome.runtime.onConnectExternal?.addListener((port) => {
  port.onMessage.addListener((message: unknown) => {
    console.log('[BucksWallet] External port message:', message);
  });
});

console.log('[BucksWallet] Background service worker loaded');

/**
 * Bucks Wallet — Content Script
 *
 * Runs in the context of every web page (isolated world).
 * Responsibilities:
 *   1. Inject inpage.js into the page's main world so window.bucks is available.
 *   2. Bridge messages from the inpage provider → background service worker.
 *   3. Relay responses from background → inpage provider.
 *   4. Forward account/chain-change events from background → inpage.
 */

import { uuid as _uuid } from '../utils/uuid';

// ---------------------------------------------------------------------------
// 1. Inject inpage script into the main world
// ---------------------------------------------------------------------------

function injectInpageScript(): void {
  try {
    const script = document.createElement('script');
    script.src   = chrome.runtime.getURL('inpage.js');
    script.type  = 'module';
    // Insert before any other scripts so window.bucks is available early.
    (document.head || document.documentElement).prepend(script);
    script.addEventListener('load', () => script.remove());
  } catch (err) {
    console.error('[BucksWallet] Failed to inject inpage script:', err);
  }
}

// Only inject on regular web pages (not chrome:// or extension pages).
if (
  document.readyState !== 'complete' ||
  !window.location.protocol.startsWith('chrome')
) {
  injectInpageScript();
}

// ---------------------------------------------------------------------------
// 2. Bridge: inpage → background
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent) => {
  // Only accept messages from the same window origin.
  if (event.source !== window)        return;
  if (event.data?.target !== 'BUCKS_CONTENT') return;

  const { id, method, params } = event.data as {
    id:     string;
    method: string;
    params: unknown[];
    target: string;
  };

  // Forward to background service worker.
  chrome.runtime.sendMessage(
    {
      type:    'PROVIDER_REQUEST',
      id:      _uuid(),
      payload: { method, params, requestId: id },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        // Background is not available (extension update, etc.)
        relayToInpage({
          id,
          error: chrome.runtime.lastError.message ?? 'Background unavailable',
        });
        return;
      }

      if (response?.error) {
        relayToInpage({ id, error: response.error });
      } else {
        const { requestId, result } = response?.result as {
          requestId: string;
          result:    unknown;
        };
        relayToInpage({ id: requestId, result });
      }
    }
  );
});

// ---------------------------------------------------------------------------
// 3 + 4. Bridge: background → inpage
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as {
    type:    string;
    payload: unknown;
  };

  switch (msg.type) {
    case 'ACCOUNTS_CHANGED':
      relayEventToInpage('accountsChanged', msg.payload);
      break;

    case 'CHAIN_CHANGED':
      relayEventToInpage('chainChanged', msg.payload);
      break;

    case 'WALLET_LOCK':
      relayEventToInpage('disconnect', { code: 4900, message: 'Wallet locked' });
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relayToInpage(data: { id: string; result?: unknown; error?: string }): void {
  window.postMessage({ ...data, target: 'BUCKS_INPAGE' }, '*');
}

function relayEventToInpage(eventName: string, payload: unknown): void {
  window.postMessage(
    { target: 'BUCKS_INPAGE_EVENT', eventName, payload },
    '*'
  );
}


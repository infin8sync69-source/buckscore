/**
 * ephemeral-ui.js — Context-Sensitive Ephemeral Overlays for Bucks Browser
 *
 * Implements 5 overlay types that materialise on context and dissolve when done:
 *
 *   1. Text Selection Halo    — user selects text → Soul Engine orb → insight card
 *   2. Crypto Address Hover   — 0x... address → mini wallet card (balance, last tx)
 *   3. IPFS Hash Hover        — Qm.../baf... → file preview card (type, size, pin)
 *   4. URL Hover in Messages  — link preview + Soul Engine relevance score
 *   5. Composer AI Assist     — as user types → ghost "Ask Soul Engine" button
 *
 * Each overlay:
 *   • Spawns at cursor position (200ms cubic-bezier scale-in)
 *   • Max-width 320px, auto-positions to avoid screen edges
 *   • Dissolves on click-away or 4s inactivity
 *   • Never blocks primary content
 *
 * Loaded via <script src="ephemeral-ui.js"> — no dependencies.
 */

(function EphemeralUI() {
  'use strict';

  if (window.__ephemeralUIInit) return;
  window.__ephemeralUIInit = true;

  /* ── Constants ───────────────────────────────────────────────────────── */
  const HOVER_DELAY_MS   = 300;   // delay before overlay appears on hover
  const DISSOLVE_MS      = 4000;  // auto-dissolve after inactivity
  const SELECTION_DELAY  = 400;   // delay after mouseup before orb appears
  const OVERLAY_MAX_W    = 320;
  const OVERLAY_PADDING  = 12;    // minimum distance from screen edge

  /* ── Regexes for content detection ──────────────────────────────────── */
  const RX_CRYPTO   = /\b(0x[a-fA-F0-9]{40})\b/;
  const RX_IPFS_CID = /\b(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-zA-Z0-9]{50,})\b/;
  const RX_URL      = /https?:\/\/[^\s"'<>]+/;

  /* ── Theme ───────────────────────────────────────────────────────────── */
  const C = {
    glass  : 'rgba(18,18,22,0.96)',
    border : 'rgba(255,255,255,0.12)',
    accent : 'var(--accent)',
    nim    : '#76b900',
    success: '#2ed573',
    warn   : '#ffb347',
    danger : '#ff4757',
    muted  : 'rgba(255,255,255,0.4)',
    dim    : 'rgba(255,255,255,0.18)',
    mono   : "'IBM Plex Mono', monospace",
  };

  /* ── Inject global CSS ───────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('ephemeral-ui-styles')) return;
    const s = document.createElement('style');
    s.id = 'ephemeral-ui-styles';
    s.textContent = `
      .eph-overlay {
        position: fixed;
        z-index: 9800;
        background: rgba(18, 18, 22, 0.92);
        border-radius: 14px;
        padding: 12px 14px;
        max-width: ${OVERLAY_MAX_W}px;
        min-width: 180px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.55);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 12px;
        color: #fff;
        pointer-events: auto;
        animation: eph-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
        will-change: transform, opacity;
      }
      .eph-overlay.dissolving {
        animation: eph-out 0.15s ease both;
        pointer-events: none;
      }

      /* Soul Engine orb (selection halo trigger) */
      .eph-orb {
        position: fixed;
        z-index: 9700;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, var(--accent-ring), rgba(100,60,200,0.8));
        border: 1px solid var(--accent-ring);
        box-shadow: 0 0 16px var(--accent-ring), 0 4px 12px rgba(0,0,0,0.4);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        animation: eph-orb-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        transition: transform 0.15s, box-shadow 0.15s;
        user-select: none;
      }
      .eph-orb:hover {
        transform: scale(1.15);
        box-shadow: 0 0 24px var(--accent-ring), 0 4px 14px rgba(0,0,0,0.5);
      }
      .eph-orb svg { pointer-events: none; }

      /* Composer ghost button */
      .eph-composer-ghost {
        position: absolute;
        z-index: 9700;
        padding: 4px 10px;
        border-radius: 8px;
        background: var(--accent-soft);
        border: 1px dashed var(--accent-ring);
        color: var(--accent-ring);
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
        pointer-events: auto;
        animation: eph-in 0.2s ease both;
        white-space: nowrap;
        font-family: inherit;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .eph-composer-ghost:hover {
        background: var(--accent-ring);
        border-color: var(--accent-ring);
        color: var(--accent);
      }

      @keyframes eph-in {
        from { opacity: 0; transform: scale(0.88) translateY(6px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes eph-out {
        from { opacity: 1; transform: scale(1); }
        to   { opacity: 0; transform: scale(0.9); }
      }
      @keyframes eph-orb-in {
        from { opacity: 0; transform: scale(0.5); }
        to   { opacity: 1; transform: scale(1); }
      }
      @keyframes eph-orb-pulse {
        0%, 100% { box-shadow: 0 0 16px var(--accent-ring), 0 4px 12px rgba(0,0,0,0.4); }
        50%       { box-shadow: 0 0 26px var(--accent-ring), 0 4px 12px rgba(0,0,0,0.4); }
      }

      /* Overlay content helpers */
      .eph-label {
        font-size: 9px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.1em; color: ${C.muted};
        margin-bottom: 6px;
      }
      .eph-address {
        font-family: ${C.mono}; font-size: 10px; color: ${C.accent};
        word-break: break-all;
      }
      .eph-action-row {
        display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap;
      }
      .eph-action-btn {
        padding: 4px 10px; border-radius: 7px; font-size: 10px; font-weight: 700;
        border: 1px solid ${C.border}; background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.75); cursor: pointer; font-family: inherit;
        transition: background 0.12s;
      }
      .eph-action-btn:hover { background: rgba(255,255,255,0.12); }
      .eph-action-btn.primary {
        background: var(--accent-soft); border-color: var(--accent-ring); color: ${C.accent};
      }
      .eph-action-btn.primary:hover { background: var(--accent-ring); }
      .eph-divider { height: 1px; background: ${C.border}; margin: 8px 0; }
      .eph-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
      .eph-key { font-size: 10px; color: ${C.muted}; flex-shrink: 0; min-width: 60px; }
      .eph-val { font-size: 11px; font-weight: 600; font-family: ${C.mono}; }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════════════
     OVERLAY LIFECYCLE
  ══════════════════════════════════════════════════════════════════════ */

  let _activeOverlay = null;
  let _dissolveTimer = null;
  let _activeOrb     = null;

  /** Position an overlay near (x, y), keeping it inside the viewport. */
  function _positionOverlay(el, x, y) {
    el.style.left = '-9999px';
    el.style.top  = '-9999px';
    document.body.appendChild(el);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w  = el.offsetWidth  || OVERLAY_MAX_W;
    const h  = el.offsetHeight || 100;

    let left = x + 12;
    let top  = y + 12;

    if (left + w + OVERLAY_PADDING > vw) left = x - w - 12;
    if (left < OVERLAY_PADDING) left = OVERLAY_PADDING;
    if (top + h + OVERLAY_PADDING > vh) top = y - h - 12;
    if (top < OVERLAY_PADDING) top = OVERLAY_PADDING;

    el.style.left = left + 'px';
    el.style.top  = top + 'px';
  }

  function _dissolve(el, onDone) {
    if (!el || !el.parentNode) { if (onDone) onDone(); return; }
    el.classList.add('dissolving');
    el.addEventListener('animationend', () => {
      el.remove();
      if (onDone) onDone();
    }, { once: true });
  }

  function _clearActive() {
    clearTimeout(_dissolveTimer);
    if (_activeOverlay) { _dissolve(_activeOverlay); _activeOverlay = null; }
  }

  function _clearOrb() {
    if (_activeOrb) { _dissolve(_activeOrb); _activeOrb = null; }
  }

  function _showOverlay(el, x, y) {
    _clearActive();
    _positionOverlay(el, x, y);
    _activeOverlay = el;

    // Auto-dissolve after inactivity
    _startDissolveTimer();

    // Dissolve on click-away
    const clickAway = (e) => {
      if (!el.contains(e.target)) {
        _clearActive();
        document.removeEventListener('mousedown', clickAway, true);
      }
    };
    document.addEventListener('mousedown', clickAway, true);

    // Refresh timer on mouse-enter
    el.addEventListener('mouseenter', () => _startDissolveTimer());
    el.addEventListener('mouseleave', () => _startDissolveTimer());
  }

  function _startDissolveTimer() {
    clearTimeout(_dissolveTimer);
    _dissolveTimer = setTimeout(_clearActive, DISSOLVE_MS);
  }

  /* ── Safe text escape ────────────────────────────────────────────────── */
  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
  }

  /* ── Truncate address / CID for display ─────────────────────────────── */
  function _short(str, n = 10) {
    return str.length > n * 2 + 3 ? str.slice(0, n) + '…' + str.slice(-6) : str;
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. TEXT SELECTION HALO
  ══════════════════════════════════════════════════════════════════════ */

  let _selectionTimer = null;

  function _handleSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      _clearOrb();
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) return;

    clearTimeout(_selectionTimer);
    _selectionTimer = setTimeout(() => {
      const range = sel.getRangeAt(0);
      const rect  = range.getBoundingClientRect();
      _clearOrb();
      _spawnOrb(rect.right + 6, rect.top - 6, text);
    }, SELECTION_DELAY);
  }

  function _spawnOrb(x, y, selectedText) {
    const orb = document.createElement('div');
    orb.className = 'eph-orb';
    orb.style.left = (x + window.scrollX) + 'px';
    orb.style.top  = (y + window.scrollY) + 'px';
    orb.title = 'Ask Soul Engine about this';
    orb.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2.2" stroke-linecap="round">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>
        <path d="M12 8v4l3 3"/>
      </svg>
    `;

    orb.addEventListener('click', (e) => {
      e.stopPropagation();
      _clearOrb();
      _showSelectionInsight(x, y + 30, selectedText);
    });

    document.body.appendChild(orb);
    _activeOrb = orb;

    // Pulse after a moment
    setTimeout(() => {
      if (orb.parentNode) orb.style.animation = 'eph-orb-pulse 2s infinite';
    }, 400);
  }

  function _showSelectionInsight(x, y, text) {
    const el = document.createElement('div');
    el.className = 'eph-overlay';
    el.innerHTML = `
      <div class="eph-label">✦ Soul Engine · Text Insight</div>
      <div style="font-size:11.5px;color:rgba(255,255,255,0.85);line-height:1.5;margin-bottom:8px;font-style:italic;">"${_esc(text.slice(0, 120))}${text.length > 120 ? '…' : ''}"</div>
      <div id="eph-insight-body" style="font-size:11px;color:${C.muted};margin-bottom:6px;">
        <span style="color:${C.accent};animation:eph-orb-pulse 1.5s infinite;display:inline-block;">✦</span> Querying Soul Engine…
      </div>
      <div class="eph-action-row">
        <button class="eph-action-btn primary" id="eph-research-btn">Research deeper</button>
        <button class="eph-action-btn" id="eph-copy-btn">Copy text</button>
      </div>
    `;

    _showOverlay(el, x, y);

    // Research button → sends query to Soul Engine via soulUI
    el.querySelector('#eph-research-btn').addEventListener('click', async () => {
      if (window.soulUI && window.soulUI.query) {
        const container = document.getElementById('nav-chat-messages-container');
        try {
          el.querySelector('#eph-insight-body').textContent = 'Sending to Soul Engine…';
          const { result } = await window.soulUI.query(text, null, (card) => {
            if (container) container.appendChild(card);
          });
          el.querySelector('#eph-insight-body').innerHTML =
            `<span style="color:${C.success};">✓</span> Sent to Soul Engine`;
        } catch (e) {
          el.querySelector('#eph-insight-body').innerHTML =
            `<span style="color:${C.danger};">✕</span> Error: ${_esc(e.message)}`;
        }
      }
      _startDissolveTimer();
    });

    // Copy button
    el.querySelector('#eph-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(text).catch(() => {});
      el.querySelector('#eph-copy-btn').textContent = '✓ Copied';
      setTimeout(() => _clearActive(), 1200);
    });

    // Async: query Soul Engine for a quick insight
    if (window.bucksAPI && window.bucksAPI.soulQuery) {
      window.bucksAPI.soulQuery(
        `Give a single concise sentence about: "${text.slice(0, 200)}"`,
        null
      ).then((r) => {
        const body = el.querySelector('#eph-insight-body');
        if (body && r && r.response) {
          body.textContent = r.response.slice(0, 200);
          body.style.color = 'rgba(255,255,255,0.75)';
        }
      }).catch(() => {});
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. CRYPTO ADDRESS HOVER
  ══════════════════════════════════════════════════════════════════════ */

  let _cryptoHoverTimer = null;

  function _handleCryptoHover(address, x, y) {
    clearTimeout(_cryptoHoverTimer);
    _cryptoHoverTimer = setTimeout(() => _showCryptoCard(address, x, y), HOVER_DELAY_MS);
  }

  function _showCryptoCard(address, x, y) {
    const el = document.createElement('div');
    el.className = 'eph-overlay';
    el.innerHTML = `
      <div class="eph-label">⬡ Bucks Chain Address</div>
      <div class="eph-address" style="margin-bottom:8px;">${_esc(address)}</div>
      <div class="eph-divider"></div>
      <div id="eph-crypto-meta" style="color:${C.muted};font-size:10.5px;">
        <span style="color:${C.accent};">✦</span> Looking up on Chain 8192…
      </div>
      <div class="eph-action-row">
        <button class="eph-action-btn primary" id="eph-wallet-send">Send</button>
        <button class="eph-action-btn" id="eph-copy-addr">Copy</button>
        <button class="eph-action-btn" id="eph-chain-lookup">Explorer</button>
      </div>
    `;
    _showOverlay(el, x, y);

    // Copy address
    el.querySelector('#eph-copy-addr').addEventListener('click', () => {
      navigator.clipboard.writeText(address).catch(() => {});
      el.querySelector('#eph-copy-addr').textContent = '✓ Copied';
    });

    // Chain explorer — open in tab
    el.querySelector('#eph-chain-lookup').addEventListener('click', () => {
      if (window.bucksAPI && window.bucksAPI.walletRPC) {
        // Signal renderer to open explorer tab
        document.dispatchEvent(new CustomEvent('bucks:open-explorer', { detail: { address } }));
      }
      _clearActive();
    });

    // Send — pre-fill composer
    el.querySelector('#eph-wallet-send').addEventListener('click', () => {
      const input = document.getElementById('nt-search-input') || document.getElementById('address-bar');
      if (input) input.value = `Send to ${address}: `;
      _clearActive();
    });

    // Async wallet lookup
    if (window.bucksAPI && window.bucksAPI.walletRPC) {
      window.bucksAPI.walletRPC({
        method: 'GET',
        endpoint: `/api/address/${address}`,
      }).then((data) => {
        const meta = el.querySelector('#eph-crypto-meta');
        if (meta && data && !data.error) {
          const bal = data.balance !== undefined ? data.balance : '?';
          const txs = data.transactionCount !== undefined ? data.transactionCount : '?';
          meta.innerHTML = `
            <div class="eph-row">
              <span class="eph-key">Balance</span>
              <span class="eph-val" style="color:${C.success};">${bal} BUCKS</span>
            </div>
            <div class="eph-row">
              <span class="eph-key">Txns</span>
              <span class="eph-val">${txs}</span>
            </div>
          `;
        } else if (meta) {
          meta.innerHTML = `<span style="color:${C.muted};">No on-chain data found</span>`;
        }
      }).catch(() => {
        const meta = el.querySelector('#eph-crypto-meta');
        if (meta) meta.innerHTML = `<span style="color:${C.muted};">Chain lookup unavailable</span>`;
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. IPFS HASH HOVER
  ══════════════════════════════════════════════════════════════════════ */

  let _ipfsHoverTimer = null;

  function _handleIPFSHover(cid, x, y) {
    clearTimeout(_ipfsHoverTimer);
    _ipfsHoverTimer = setTimeout(() => _showIPFSCard(cid, x, y), HOVER_DELAY_MS);
  }

  function _showIPFSCard(cid, x, y) {
    const el = document.createElement('div');
    el.className = 'eph-overlay';
    el.innerHTML = `
      <div class="eph-label">⬡ IPFS Content</div>
      <div class="eph-address" style="margin-bottom:8px;">${_esc(_short(cid, 14))}</div>
      <div class="eph-divider"></div>
      <div id="eph-ipfs-meta" style="color:${C.muted};font-size:10.5px;">
        <span style="color:${C.accent};">✦</span> Probing IPFS network…
      </div>
      <div class="eph-action-row">
        <button class="eph-action-btn primary" id="eph-ipfs-pin">Pin locally</button>
        <button class="eph-action-btn" id="eph-ipfs-open">Open</button>
        <button class="eph-action-btn" id="eph-ipfs-copy">Copy CID</button>
      </div>
    `;
    _showOverlay(el, x, y);

    // Copy CID
    el.querySelector('#eph-ipfs-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(cid).catch(() => {});
      el.querySelector('#eph-ipfs-copy').textContent = '✓ Copied';
    });

    // Open via IPFS protocol
    el.querySelector('#eph-ipfs-open').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('bucks:navigate', { detail: { url: `ipfs://${cid}` } }));
      _clearActive();
    });

    // Pin locally
    el.querySelector('#eph-ipfs-pin').addEventListener('click', async () => {
      if (window.bucksAPI && window.bucksAPI.clusterPin) {
        const btn = el.querySelector('#eph-ipfs-pin');
        btn.textContent = 'Pinning…';
        btn.disabled = true;
        try {
          await window.bucksAPI.clusterPin(cid);
          btn.textContent = '✓ Pinned';
          btn.style.color = C.success;
        } catch (_) {
          btn.textContent = '✕ Failed';
          btn.style.color = C.danger;
        }
      }
    });

    // Async: get storage stats for this CID (approximate from IPFS)
    if (window.bucksAPI && window.bucksAPI.ipfsStorageStats) {
      window.bucksAPI.ipfsStorageStats().then(() => {
        const meta = el.querySelector('#eph-ipfs-meta');
        if (meta) {
          meta.innerHTML = `
            <div class="eph-row">
              <span class="eph-key">CID</span>
              <span class="eph-val" style="color:${C.accent};font-size:9px;">${_esc(_short(cid, 8))}</span>
            </div>
            <div class="eph-row">
              <span class="eph-key">Type</span>
              <span class="eph-val">${cid.startsWith('Qm') ? 'CIDv0' : 'CIDv1'}</span>
            </div>
          `;
        }
      }).catch(() => {
        const meta = el.querySelector('#eph-ipfs-meta');
        if (meta) meta.textContent = 'IPFS node unavailable';
      });
    } else {
      const meta = el.querySelector('#eph-ipfs-meta');
      if (meta) meta.innerHTML = `
        <div class="eph-row"><span class="eph-key">Type</span><span class="eph-val">${cid.startsWith('Qm') ? 'CIDv0' : 'CIDv1'}</span></div>
      `;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. URL HOVER IN MESSAGES — Preview card with Soul Engine relevance
  ══════════════════════════════════════════════════════════════════════ */

  let _urlHoverTimer = null;

  function _handleURLHover(url, x, y) {
    clearTimeout(_urlHoverTimer);
    _urlHoverTimer = setTimeout(() => _showURLPreviewCard(url, x, y), HOVER_DELAY_MS + 100);
  }

  function _showURLPreviewCard(url, x, y) {
    let hostname = url;
    try { hostname = new URL(url).hostname.replace('www.', ''); } catch (_) {}

    const el = document.createElement('div');
    el.className = 'eph-overlay';
    el.innerHTML = `
      <div class="eph-label">🔗 Link Preview</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.75);margin-bottom:4px;font-weight:600;">${_esc(hostname)}</div>
      <div style="font-size:10px;color:${C.muted};margin-bottom:8px;word-break:break-all;">${_esc(url.slice(0, 60))}${url.length > 60 ? '…' : ''}</div>
      <div class="eph-divider"></div>
      <div id="eph-url-preview" style="color:${C.muted};font-size:10.5px;">
        <span style="color:${C.accent};">✦</span> Fetching preview…
      </div>
      <div class="eph-action-row">
        <button class="eph-action-btn primary" id="eph-url-open">Open in Tab</button>
        <button class="eph-action-btn" id="eph-url-soul">Ask Soul Engine</button>
      </div>
    `;
    _showOverlay(el, x, y);

    el.querySelector('#eph-url-open').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('bucks:navigate', { detail: { url } }));
      _clearActive();
    });

    el.querySelector('#eph-url-soul').addEventListener('click', () => {
      if (window.soulUI && window.soulUI.query) {
        const container = document.getElementById('nav-chat-messages-container');
        window.soulUI.query(`Summarise this page: ${url}`, null, (card) => {
          if (container) container.appendChild(card);
        });
      }
      _clearActive();
    });

    // Async: fetch page summary
    if (window.bucksAPI && window.bucksAPI.webFetchSummary) {
      window.bucksAPI.webFetchSummary(url).then((data) => {
        const preview = el.querySelector('#eph-url-preview');
        if (preview && data && data.ok) {
          preview.innerHTML = [
            data.title ? `<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);margin-bottom:3px;">${_esc(data.title.slice(0, 60))}</div>` : '',
            data.description ? `<div style="font-size:10px;color:${C.muted};">${_esc(data.description.slice(0, 120))}</div>` : '',
          ].filter(Boolean).join('') || `<span style="color:${C.muted};">No preview available</span>`;
        } else if (preview) {
          preview.innerHTML = `<span style="color:${C.muted};">Preview unavailable</span>`;
        }
      }).catch(() => {
        const preview = el.querySelector('#eph-url-preview');
        if (preview) preview.innerHTML = `<span style="color:${C.muted};">Preview unavailable</span>`;
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. COMPOSER AI ASSIST
     As user types in the composer, if query looks like a Soul Engine topic
     → gentle glow + "Ask Soul Engine" ghost button
  ══════════════════════════════════════════════════════════════════════ */

  const SOUL_TOPIC_SIGNALS = [
    /\b(what is|what does|explain|why|how|meaning|wisdom|understand|tell me|define|describe)\b/i,
    /\?$/,
    /\b(soul|resonance|wisdom|knowledge|truth|universe|consciousness|virtue|purpose)\b/i,
  ];

  let _composerGhost     = null;
  let _composerGlowing   = false;
  let _composerTimer     = null;
  let _composerLastQuery = '';

  function _handleComposerInput(input) {
    const val = input.value.trim();
    if (val === _composerLastQuery) return;
    _composerLastQuery = val;

    clearTimeout(_composerTimer);
    _removeComposerGhost();

    if (val.length < 8) return;

    const looks_like_soul = SOUL_TOPIC_SIGNALS.some((rx) => rx.test(val));
    if (!looks_like_soul) return;

    _composerTimer = setTimeout(() => _spawnComposerGhost(input, val), 600);
  }

  function _spawnComposerGhost(input, query) {
    return; // Disabled to keep bottom composer bar clean and uncluttered.

    // Position: right side of the input
    const rect = input.getBoundingClientRect();
    ghost.style.top    = (rect.top + window.scrollY - 32) + 'px';
    ghost.style.right  = (window.innerWidth - rect.right + 4) + 'px';
    ghost.style.position = 'fixed';
    document.body.appendChild(ghost);
    _composerGhost = ghost;

    // Add glow to input
    if (!_composerGlowing) {
      input.style.boxShadow = '0 0 0 2px var(--accent-ring)';
      input.style.transition = 'box-shadow 0.3s';
      _composerGlowing = true;
    }

    ghost.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _removeComposerGhost();
      input.style.boxShadow = '';
      _composerGlowing = false;

      // Submit to Soul Engine
      if (window.soulUI && window.soulUI.query) {
        const container = document.getElementById('nav-chat-messages-container');
        window.soulUI.query(query, null, (card) => {
          if (container) container.appendChild(card);
        });
        input.value = '';
      }
    });

    // Auto-remove if user keeps typing
    input.addEventListener('input', _removeComposerGhost, { once: true });
  }

  function _removeComposerGhost() {
    if (_composerGhost) {
      _dissolve(_composerGhost);
      _composerGhost = null;
    }
    // Remove glow
    const input = document.getElementById('nt-search-input');
    if (input && _composerGlowing) {
      input.style.boxShadow = '';
      _composerGlowing = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     CONTENT DETECTION — scan text nodes / elements for detected patterns
  ══════════════════════════════════════════════════════════════════════ */

  function _scanNodeForPatterns(node) {
    const text = node.textContent || '';
    if (RX_CRYPTO.test(text))   return 'crypto';
    if (RX_IPFS_CID.test(text)) return 'ipfs';
    if (RX_URL.test(text))      return 'url';
    return null;
  }

  function _handleMouseoverNode(e) {
    const el = e.target;
    if (!el || el.classList.contains('eph-overlay') || el.classList.contains('eph-orb')) return;

    const text = el.textContent || '';
    const x = e.clientX;
    const y = e.clientY;

    // Check for crypto address
    const cryptoMatch = text.match(RX_CRYPTO);
    if (cryptoMatch) {
      _handleCryptoHover(cryptoMatch[1], x, y);
      el.addEventListener('mouseleave', () => clearTimeout(_cryptoHoverTimer), { once: true });
      return;
    }

    // Check for IPFS CID
    const ipfsMatch = text.match(RX_IPFS_CID);
    if (ipfsMatch) {
      _handleIPFSHover(ipfsMatch[1], x, y);
      el.addEventListener('mouseleave', () => clearTimeout(_ipfsHoverTimer), { once: true });
      return;
    }

    // Check for URL (in message/chat containers only)
    const inMessages = el.closest('#nav-chat-messages-container, .soul-response-card, .chat-message');
    if (inMessages) {
      const urlMatch = text.match(RX_URL);
      if (urlMatch) {
        _handleURLHover(urlMatch[0], x, y);
        el.addEventListener('mouseleave', () => clearTimeout(_urlHoverTimer), { once: true });
        return;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════════════ */

  function init() {
    injectStyles();

    // 1. Text selection halo
    document.addEventListener('selectionchange', _handleSelectionChange);
    document.addEventListener('mouseup', () => {
      setTimeout(_handleSelectionChange, 50);
    });

    // 2 + 3 + 4. Hover detection on document
    document.addEventListener('mouseover', _handleMouseoverNode, { passive: true });

    // 5. Composer AI assist
    const composerInput = document.getElementById('nt-search-input');
    if (composerInput) {
      composerInput.addEventListener('input', () => _handleComposerInput(composerInput));
    }
    // Also watch for dynamically added composer input
    const composerObserver = new MutationObserver(() => {
      const inp = document.getElementById('nt-search-input');
      if (inp && !inp._ephemeralWired) {
        inp._ephemeralWired = true;
        inp.addEventListener('input', () => _handleComposerInput(inp));
      }
    });
    composerObserver.observe(document.body, { childList: true, subtree: true });

    // Listen for bucks:navigate events (from URL/explorer overlays)
    document.addEventListener('bucks:navigate', (e) => {
      const input = document.getElementById('address-bar');
      if (input && e.detail && e.detail.url) {
        input.value = e.detail.url;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  window.ephemeralUI = {
    showSelectionInsight : _showSelectionInsight,
    showCryptoCard       : _showCryptoCard,
    showIPFSCard         : _showIPFSCard,
    showURLPreview       : _showURLPreviewCard,
    dismiss              : _clearActive,
  };

})();

/**
 * soul-ui.js — Premium UI layer for the Soul Engine
 *
 * The intelligence (QNN + NIM race, RL logging, feedback capture) runs
 * entirely in the background. This file controls only what the user sees:
 *
 *   • A single breathing dot in the composer (thinking ↔ ready)
 *   • Clean, beautifully typeset response cards
 *   • Numbered citation superscripts with hover tooltips
 *   • One ultra-subtle thumbs feedback icon per response
 *
 * Nothing else is exposed to the user. No scores, no metrics, no labels.
 *
 * Communicates via: window.bucksAPI.soulQuery / soulStatus / soulFeedback
 */

(function SoulUI() {
  'use strict';

  if (window.__soulUIInitialised) return;
  window.__soulUIInitialised = true;

  /* ── Constants ─────────────────────────────────────────────────────────── */
  const STATUS_POLL_MS = 8000;

  /* ── Inject design system + premium styles ────────────────────────────── */
  function injectBaseStyles() {
    if (document.getElementById('soul-ui-base-styles')) return;
    const s = document.createElement('style');
    s.id = 'soul-ui-base-styles';
    s.textContent = `
      /* ── Soul Engine Design System ── */
      :root {
        --soul-bg:             rgba(12, 12, 16, 0.96);
        --soul-surface:        rgba(255, 255, 255, 0.04);
        --soul-border:         rgba(255, 255, 255, 0.08);
        --soul-text-primary:   rgba(255, 255, 255, 0.92);
        --soul-text-secondary: rgba(255, 255, 255, 0.42);
        --soul-accent:         #7c5cfc;
        --soul-pulse:          rgba(124, 92, 252, 0.4);
        --soul-radius:         12px;
        --soul-blur:           blur(20px);
        --soul-ease:           cubic-bezier(0.16, 1, 0.3, 1);
      }

      /* ── Dot animations ── */
      @keyframes soul-breathe {
        0%, 100% { opacity: 0.55; transform: scale(1);    box-shadow: 0 0 0 0   var(--soul-pulse); }
        50%       { opacity: 1;    transform: scale(1.15); box-shadow: 0 0 0 4px transparent; }
      }
      @keyframes soul-think {
        0%, 100% { opacity: 1;   transform: scale(1);    }
        40%       { opacity: 0.5; transform: scale(0.85); }
        70%       { opacity: 1;   transform: scale(1.2);  }
      }

      /* ── Composer dot ── */
      #composer-model-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--soul-accent);
        display: inline-block;
        flex-shrink: 0;
        transition: background 0.4s var(--soul-ease);
        animation: soul-breathe 3.2s ease-in-out infinite;
      }
      #composer-model-dot.thinking {
        animation: soul-think 0.75s ease-in-out infinite;
      }
      #composer-model-dot.offline {
        background: rgba(255, 255, 255, 0.18);
        animation: none;
      }

      /* ── Response card ── */
      @keyframes soul-fade-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0);   }
      }
      .soul-response-card {
        display: flex;
        flex-direction: column;
        padding: 24px;
        border-radius: var(--soul-radius);
        background: var(--soul-surface);
        animation: soul-fade-in 0.3s var(--soul-ease) both;
        width: 100%;
        position: relative;
      }

      /* ── Response text ── */
      .soul-response-text {
        font-size: 14px;
        line-height: 1.72;
        color: var(--soul-text-primary);
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-weight: 400;
        letter-spacing: 0.01em;
        padding-right: 28px;
      }

      /* ── Citation superscripts ── */
      .soul-cite-ref {
        display: inline;
        font-size: 10px;
        font-weight: 700;
        color: var(--soul-accent);
        vertical-align: super;
        line-height: 0;
        cursor: pointer;
        margin-left: 1px;
        opacity: 0.75;
        transition: opacity 0.12s;
        user-select: none;
        font-family: 'IBM Plex Mono', monospace;
      }
      .soul-cite-ref:hover { opacity: 1; }

      /* ── Citation tooltip ── */
      .soul-cite-tooltip {
        position: fixed;
        z-index: 9900;
        max-width: 300px;
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(18, 18, 22, 0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        font-size: 11.5px;
        line-height: 1.55;
        color: rgba(255, 255, 255, 0.82);
        pointer-events: none;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55),
                    0 0 0 1px rgba(255, 255, 255, 0.06);
        transition: opacity 0.15s var(--soul-ease);
        opacity: 0;
        font-family: 'Instrument Sans', system-ui, sans-serif;
      }
      .soul-cite-tooltip.visible { opacity: 1; }
      .soul-cite-tooltip-ref {
        font-size: 10px;
        font-weight: 700;
        color: var(--soul-accent);
        margin-bottom: 5px;
        opacity: 0.8;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-family: 'IBM Plex Mono', monospace;
        display: block;
      }

      /* ── Thumbs feedback ── */
      .soul-thumbs {
        position: absolute;
        bottom: 14px;
        right: 16px;
        opacity: 0;
        cursor: pointer;
        border: none;
        background: none;
        padding: 4px 5px;
        color: rgba(255, 255, 255, 0.35);
        transition: opacity 0.2s var(--soul-ease),
                    color 0.15s,
                    transform 0.15s var(--soul-ease);
        user-select: none;
        line-height: 1;
        border-radius: 6px;
      }
      .soul-response-card:hover .soul-thumbs { opacity: 0.3; }
      .soul-thumbs:hover {
        opacity: 0.7 !important;
        color: var(--soul-accent);
        transform: scale(1.1);
      }
      .soul-thumbs.active {
        opacity: 1 !important;
        color: var(--soul-accent);
        transform: scale(1);
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Composer dot helpers ─────────────────────────────────────────────── */
  function _getDot() {
    return document.getElementById('composer-model-dot');
  }

  function setThinking(active) {
    const dot = _getDot();
    if (!dot) return;
    if (active) {
      dot.classList.remove('offline');
      dot.classList.add('thinking');
    } else {
      dot.classList.remove('thinking');
    }
  }

  function _updateDotFromStatus({ local, nim }) {
    const dot = _getDot();
    if (!dot) return;
    if (local || nim) {
      dot.classList.remove('offline', 'thinking');
    } else {
      dot.classList.add('offline');
      dot.classList.remove('thinking');
    }
  }

  /* ── Build response card ──────────────────────────────────────────────── */
  /**
   * Build a clean Soul Engine response card.
   * @param {object} result — payload from soulQuery or agent-submit IPC
   * @returns {HTMLElement}
   */
  function buildResponseCard(result) {
    const {
      query_id  = '',
      response  = '',
      citations = [],
    } = result;

    /* Safe HTML escape */
    function esc(s) {
      const d = document.createElement('div');
      d.textContent = String(s || '');
      return d.innerHTML;
    }

    /* ── Card shell ── */
    const card = document.createElement('div');
    card.className   = 'soul-response-card';
    card.dataset.qid = query_id;

    /* ── Response text with inline citation superscripts ── */
    const textEl = document.createElement('div');
    textEl.className = 'soul-response-text';

    if (citations.length > 0) {
      // Replace [n] markers already in the text
      let html = esc(response);
      html = html.replace(/\[(\d+)\]/g, (_, n) => {
        const idx = parseInt(n, 10) - 1;
        if (!citations[idx]) return esc(`[${n}]`);
        return `<span class="soul-cite-ref" data-cidx="${idx}">[${n}]</span>`;
      });
      // If no inline [n] refs found, append them after the text
      if (!html.includes('soul-cite-ref')) {
        const refs = citations
          .map((_, i) => `<span class="soul-cite-ref" data-cidx="${i}">[${i + 1}]</span>`)
          .join('');
        html += refs;
      }
      textEl.innerHTML = html;
    } else {
      textEl.textContent = response;
    }

    card.appendChild(textEl);

    /* ── Thumbs feedback ── */
    const thumbsBtn = document.createElement('button');
    thumbsBtn.className  = 'soul-thumbs';
    thumbsBtn.setAttribute('aria-label', 'Mark as helpful');
    thumbsBtn.title      = 'Helpful';
    thumbsBtn.innerHTML  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
    </svg>`;

    thumbsBtn.addEventListener('click', async () => {
      if (thumbsBtn.classList.contains('active')) return;
      thumbsBtn.classList.add('active');
      try {
        if (window.bucksAPI && window.bucksAPI.soulFeedback) {
          await window.bucksAPI.soulFeedback(query_id, 1, null);
        }
      } catch (_) {}
    });

    card.appendChild(thumbsBtn);

    /* ── Citation tooltips ── */
    if (citations.length > 0) {
      const tooltip = document.createElement('div');
      tooltip.className = 'soul-cite-tooltip';
      document.body.appendChild(tooltip);
      let _hideTimer = null;

      const refs = card.querySelectorAll('.soul-cite-ref');
      refs.forEach((ref) => {
        ref.addEventListener('mouseenter', () => {
          clearTimeout(_hideTimer);
          const idx = parseInt(ref.dataset.cidx, 10);
          const c   = citations[idx];
          if (!c) return;

          const label   = c.ref || `Source ${idx + 1}`;
          const excerpt = c.text ? c.text.slice(0, 200) : '';
          tooltip.innerHTML = `<span class="soul-cite-tooltip-ref">${esc(label)}</span>${esc(excerpt)}${excerpt.length >= 200 ? '…' : ''}`;

          /* Position the tooltip above the ref */
          tooltip.style.left = '-9999px';
          tooltip.style.top  = '-9999px';
          tooltip.classList.add('visible');

          requestAnimationFrame(() => {
            const rect = ref.getBoundingClientRect();
            const tw   = tooltip.offsetWidth || 300;
            const th   = tooltip.offsetHeight || 80;
            const vw   = window.innerWidth;

            let left = rect.left;
            let top  = rect.top - th - 8;

            if (left + tw > vw - 12) left = vw - tw - 12;
            if (left < 8) left = 8;
            if (top < 8) top = rect.bottom + 6;

            tooltip.style.left = left + 'px';
            tooltip.style.top  = top + 'px';
          });
        });

        ref.addEventListener('mouseleave', () => {
          _hideTimer = setTimeout(() => tooltip.classList.remove('visible'), 100);
        });
      });

      /* Clean up tooltip DOM when card is removed */
      const obs = new MutationObserver(() => {
        if (!document.body.contains(card)) {
          tooltip.remove();
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    return card;
  }

  /* ── AG-UI event listener ─────────────────────────────────────────────── */
  function _handleAgentEvent(evt) {
    if (!evt) return;
    switch (evt.type) {
      case 'task.thinking':
        setThinking(true);
        break;
      case 'task.result':
      case 'task.complete':
      case 'task.error':
        setThinking(false);
        break;
    }
  }

  /* ── Public query function ────────────────────────────────────────────── */
  /**
   * Send a query to the Soul Engine, return a rendered card element.
   * @param {string}   prompt
   * @param {string|null} sessionId
   * @param {function} [onCard]   — called with the card HTMLElement when ready
   */
  async function query(prompt, sessionId, onCard) {
    if (!window.bucksAPI || !window.bucksAPI.soulQuery) {
      throw new Error('bucksAPI.soulQuery not available');
    }
    setThinking(true);
    try {
      const result = await window.bucksAPI.soulQuery(prompt, sessionId || null);
      const card   = buildResponseCard(result);
      if (typeof onCard === 'function') onCard(card);
      return { card, result };
    } finally {
      setThinking(false);
    }
  }

  /* ── Status polling ───────────────────────────────────────────────────── */
  let _statusPollTimer = null;

  async function pollStatus() {
    if (!window.bucksAPI || !window.bucksAPI.soulStatus) return;
    try {
      const st = await window.bucksAPI.soulStatus();
      _updateDotFromStatus(st);
    } catch (_) {}
  }

  /* ── Init ─────────────────────────────────────────────────────────────── */
  function init() {
    injectBaseStyles();
    pollStatus();
    _statusPollTimer = setInterval(pollStatus, STATUS_POLL_MS);

    if (window.bucksAPI && window.bucksAPI.onAgentEvent) {
      window.bucksAPI.onAgentEvent(_handleAgentEvent);
    }
    document.addEventListener('soul-agent-event', (e) => {
      if (e.detail) _handleAgentEvent(e.detail);
    });
  }

  function destroy() {
    clearInterval(_statusPollTimer);
    document.querySelectorAll('.soul-cite-tooltip').forEach((t) => t.remove());
  }

  /* ── Public API ─────────────────────────────────────────────────────────*/
  window.soulUI = {
    init,
    destroy,
    query,
    buildResponseCard,
    setThinking,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BUCKS NIM EXECUTION PANEL                                               ║
 * ║                                                                           ║
 * ║  Premium slide-in panel for NVIDIA NIM cloud inference monitoring:        ║
 * ║                                                                           ║
 * ║  1. Live Token Stream   — real-time token stream during NIM inference    ║
 * ║  2. Model Selector      — nemotron-70b / llama-3.1-70b / llama-3.1-8b   ║
 * ║  3. Quality Comparison  — side-by-side QNN vs NIM quality bars           ║
 * ║  4. Override Toggle     — force NIM mode, bypass 0.65 quality gate       ║
 * ║  5. Session Stats       — total NIM queries, avg latency, win rate       ║
 * ║                                                                           ║
 * ║  Hotkey: ⌘+Shift+N (Mac) / Ctrl+Shift+N (Win/Linux)                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
(function NIMPanel() {
  'use strict';

  if (window.__nimPanelInit) return;
  window.__nimPanelInit = true;

  /* ── Internal state ──────────────────────────────────────────────────── */
  const MODELS = [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B', short: 'nemotron-70b' },
    { id: 'meta/llama-3.1-70b-instruct',            label: 'Llama 3.1 70B', short: 'llama-70b' },
    { id: 'meta/llama-3.1-8b-instruct',             label: 'Llama 3.1 8B',  short: 'llama-8b' },
  ];

  let _selectedModel = MODELS[0].id;
  let _override      = false;
  let _isOpen         = false;
  let _panel          = null;

  /* Session tracking */
  let _nimQueries     = 0;
  let _totalLatency   = 0;
  let _nimWins        = 0;

  /* Active stream state */
  let _streamActive   = false;
  let _streamTokens   = 0;
  let _streamText     = '';
  let _streamStartTs  = 0;
  let _streamTimer    = null;

  /* Last quality comparison */
  let _lastQnnQuality = null;
  let _lastNimQuality = null;

  /* ── Style injection ─────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('nim-panel-styles')) return;
    const s = document.createElement('style');
    s.id = 'nim-panel-styles';
    s.textContent = `
      /* ── NIM Panel Design Tokens (matches NEXUS) ── */
      #nim-panel-root {
        position: fixed;
        top: 0; right: -440px; bottom: 0;
        width: 420px;
        z-index: 99998;
        background: rgba(8, 10, 18, 0.97);
        border-left: 1px solid rgba(118, 185, 0, 0.18);
        box-shadow: -20px 0 60px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(24px) saturate(1.2);
        -webkit-backdrop-filter: blur(24px) saturate(1.2);
        font-family: 'Inter', 'SF Pro Display', system-ui, sans-serif;
        color: #e0e8ff;
        display: flex;
        flex-direction: column;
        transition: right 0.32s cubic-bezier(.16, 1, .3, 1);
        overflow: hidden;
      }
      #nim-panel-root.nim-open {
        right: 0;
      }

      /* ── Header ── */
      .nim-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px 14px;
        border-bottom: 1px solid rgba(118, 185, 0, 0.12);
        flex-shrink: 0;
      }
      .nim-logo {
        width: 24px; height: 24px;
        background: linear-gradient(135deg, #76b900, #3d8700);
        border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; color: white; font-weight: 800;
        flex-shrink: 0;
        letter-spacing: -0.02em;
      }
      .nim-title {
        font-size: 13px; font-weight: 600;
        color: rgba(255,255,255,0.92);
        letter-spacing: 0.02em;
        flex: 1;
      }
      .nim-stream-indicator {
        width: 8px; height: 8px; border-radius: 50%;
        background: rgba(255,255,255,0.15);
        transition: background 0.3s, box-shadow 0.3s;
        flex-shrink: 0;
      }
      .nim-stream-indicator.active {
        background: #76b900;
        box-shadow: 0 0 8px rgba(118,185,0,0.6);
        animation: nim-pulse 1.2s infinite;
      }
      @keyframes nim-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      .nim-btn-close {
        background: transparent;
        border: none; cursor: pointer;
        color: rgba(255,255,255,0.4);
        font-size: 16px; line-height: 1;
        padding: 4px 6px;
        border-radius: 6px;
        transition: color 0.2s, background 0.2s;
      }
      .nim-btn-close:hover { color: #fff; background: rgba(255,255,255,0.08); }

      /* ── Model selector ── */
      .nim-model-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        border-bottom: 1px solid rgba(118,185,0,0.08);
        flex-shrink: 0;
      }
      .nim-model-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255,255,255,0.35);
        flex-shrink: 0;
      }
      .nim-model-select {
        flex: 1;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(118,185,0,0.2);
        border-radius: 6px;
        color: #e0e8ff;
        font-family: inherit;
        font-size: 12px;
        padding: 6px 10px;
        outline: none;
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
        padding-right: 24px;
      }
      .nim-model-select:focus {
        border-color: #76b900;
        box-shadow: 0 0 0 2px rgba(118,185,0,0.12);
      }
      .nim-model-select option {
        background: #0a0c14;
        color: #e0e8ff;
      }

      /* ── Override toggle ── */
      .nim-override-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 18px;
        border-bottom: 1px solid rgba(118,185,0,0.08);
        flex-shrink: 0;
      }
      .nim-toggle {
        width: 34px; height: 18px;
        background: rgba(255,255,255,0.1);
        border-radius: 9px;
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .nim-toggle.on { background: #76b900; }
      .nim-toggle::after {
        content: '';
        position: absolute;
        width: 12px; height: 12px;
        background: white;
        border-radius: 50%;
        top: 3px; left: 3px;
        transition: transform 0.2s;
      }
      .nim-toggle.on::after { transform: translateX(16px); }
      .nim-override-label {
        font-size: 11px;
        color: rgba(255,255,255,0.5);
        flex: 1;
      }
      .nim-override-badge {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 2px 7px;
        border-radius: 4px;
        display: none;
      }
      .nim-override-badge.active {
        display: inline;
        background: rgba(118,185,0,0.15);
        color: #76b900;
        border: 1px solid rgba(118,185,0,0.3);
      }

      /* ── Quality comparison ── */
      .nim-quality-section {
        padding: 14px 18px;
        border-bottom: 1px solid rgba(118,185,0,0.08);
        flex-shrink: 0;
      }
      .nim-quality-title {
        font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.07em;
        color: rgba(255,255,255,0.35);
        margin-bottom: 10px;
      }
      .nim-quality-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
      }
      .nim-quality-label {
        font-size: 11px; font-weight: 600;
        width: 36px; flex-shrink: 0;
        text-align: right;
      }
      .nim-quality-bar-bg {
        flex: 1; height: 6px;
        background: rgba(255,255,255,0.06);
        border-radius: 3px;
        overflow: hidden;
        position: relative;
      }
      .nim-quality-bar {
        height: 100%; border-radius: 3px;
        transition: width 0.5s cubic-bezier(.16,1,.3,1);
        min-width: 0;
      }
      .nim-quality-bar.qnn { background: linear-gradient(90deg, #7c5cfc, #a06fff); }
      .nim-quality-bar.nim { background: linear-gradient(90deg, #76b900, #9ae400); }
      .nim-quality-value {
        font-size: 11px; font-weight: 600;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        width: 40px; flex-shrink: 0;
        text-align: right;
      }
      .nim-threshold-line {
        position: absolute;
        left: 65%;
        top: -2px; bottom: -2px;
        width: 1px;
        background: rgba(255,79,106,0.5);
      }

      /* ── Token stream ── */
      .nim-stream-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
      }
      .nim-stream-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px 8px;
        flex-shrink: 0;
      }
      .nim-stream-title {
        font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.07em;
        color: rgba(255,255,255,0.35);
        flex: 1;
      }
      .nim-stream-meta {
        font-size: 10px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        color: rgba(118,185,0,0.7);
      }
      .nim-stream-body {
        flex: 1;
        overflow-y: auto;
        padding: 4px 18px 18px;
        font-size: 13px;
        line-height: 1.65;
        color: rgba(255,255,255,0.82);
        font-family: 'Instrument Sans', system-ui, sans-serif;
        white-space: pre-wrap;
        word-break: break-word;
        scrollbar-width: thin;
        scrollbar-color: rgba(118,185,0,0.2) transparent;
      }
      .nim-stream-body:empty::after {
        content: 'Submit a query to see the NIM token stream…';
        color: rgba(255,255,255,0.2);
        font-size: 12px;
        font-style: italic;
      }
      .nim-stream-cursor {
        display: inline-block;
        width: 2px; height: 14px;
        background: #76b900;
        margin-left: 1px;
        vertical-align: text-bottom;
        animation: nim-blink 0.8s step-end infinite;
      }
      @keyframes nim-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }

      /* ── Session stats ── */
      .nim-stats-section {
        padding: 14px 18px;
        border-top: 1px solid rgba(118,185,0,0.08);
        flex-shrink: 0;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .nim-stat-card {
        text-align: center;
        padding: 8px 6px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(118,185,0,0.08);
        border-radius: 8px;
      }
      .nim-stat-value {
        font-size: 16px; font-weight: 700;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        color: #76b900;
        line-height: 1.2;
      }
      .nim-stat-label {
        font-size: 9px; font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255,255,255,0.3);
        margin-top: 2px;
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Build DOM ───────────────────────────────────────────────────────── */
  function _buildDOM() {
    if (document.getElementById('nim-panel-root')) return;

    const panel = document.createElement('div');
    panel.id = 'nim-panel-root';
    panel.innerHTML = `
      <!-- Header -->
      <div class="nim-header">
        <div class="nim-logo">N</div>
        <div class="nim-title">NIM Inference</div>
        <div class="nim-stream-indicator" id="nim-stream-led" title="Stream idle"></div>
        <button class="nim-btn-close" id="nim-btn-close" title="Close (Esc)">✕</button>
      </div>

      <!-- Model selector -->
      <div class="nim-model-row">
        <span class="nim-model-label">Model</span>
        <select class="nim-model-select" id="nim-model-select">
          ${MODELS.map(m => `<option value="${m.id}" ${m.id === _selectedModel ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </div>

      <!-- Override toggle -->
      <div class="nim-override-row">
        <div class="nim-toggle" id="nim-override-toggle" title="Force NIM mode"></div>
        <span class="nim-override-label">Force NIM override (bypass quality gate)</span>
        <span class="nim-override-badge" id="nim-override-badge">Active</span>
      </div>

      <!-- Quality comparison -->
      <div class="nim-quality-section">
        <div class="nim-quality-title">Quality Comparison</div>
        <div class="nim-quality-row">
          <span class="nim-quality-label" style="color:#a06fff;">QNN</span>
          <div class="nim-quality-bar-bg">
            <div class="nim-quality-bar qnn" id="nim-qnn-bar" style="width:0%"></div>
            <div class="nim-threshold-line" title="0.65 threshold"></div>
          </div>
          <span class="nim-quality-value" id="nim-qnn-value">—</span>
        </div>
        <div class="nim-quality-row">
          <span class="nim-quality-label" style="color:#76b900;">NIM</span>
          <div class="nim-quality-bar-bg">
            <div class="nim-quality-bar nim" id="nim-nim-bar" style="width:0%"></div>
            <div class="nim-threshold-line" title="0.65 threshold"></div>
          </div>
          <span class="nim-quality-value" id="nim-nim-value">—</span>
        </div>
      </div>

      <!-- Token stream -->
      <div class="nim-stream-section">
        <div class="nim-stream-header">
          <span class="nim-stream-title">Token Stream</span>
          <span class="nim-stream-meta" id="nim-stream-meta"></span>
        </div>
        <div class="nim-stream-body" id="nim-stream-body"></div>
      </div>

      <!-- Session stats -->
      <div class="nim-stats-section">
        <div class="nim-stat-card">
          <div class="nim-stat-value" id="nim-stat-queries">0</div>
          <div class="nim-stat-label">NIM Queries</div>
        </div>
        <div class="nim-stat-card">
          <div class="nim-stat-value" id="nim-stat-latency">—</div>
          <div class="nim-stat-label">Avg Latency</div>
        </div>
        <div class="nim-stat-card">
          <div class="nim-stat-value" id="nim-stat-wins">0</div>
          <div class="nim-stat-label">NIM Wins</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    _panel = panel;

    /* ── Wire events ── */
    document.getElementById('nim-btn-close').addEventListener('click', close);

    document.getElementById('nim-model-select').addEventListener('change', (e) => {
      _selectedModel = e.target.value;
    });

    const toggleEl = document.getElementById('nim-override-toggle');
    toggleEl.addEventListener('click', () => {
      _override = !_override;
      toggleEl.classList.toggle('on', _override);
      const badge = document.getElementById('nim-override-badge');
      badge.classList.toggle('active', _override);
    });
  }

  /* ── Open / Close / Toggle ───────────────────────────────────────────── */
  function open() {
    _isOpen = true;
    if (_panel) _panel.classList.add('nim-open');
    _refreshStats();
  }

  function close() {
    _isOpen = false;
    if (_panel) _panel.classList.remove('nim-open');
  }

  function toggle() {
    _isOpen ? close() : open();
  }

  /* ── Hotkey ───────────────────────────────────────────────────────────── */
  function _bindHotkey() {
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        toggle();
      }
      if (_isOpen && e.key === 'Escape') close();
    });
  }

  /* ── AG-UI Event Handler ─────────────────────────────────────────────── */
  function onAgentEvent(evt) {
    if (!evt) return;

    switch (evt.type) {
      case 'nim.stream_start':
        _streamActive  = true;
        _streamTokens  = 0;
        _streamText    = '';
        _streamStartTs = Date.now();
        _nimQueries++;
        _updateStreamLED(true);
        _clearStreamBody();
        _startStopwatch();
        break;

      case 'nim.stream_chunk':
        if (evt.chunk) {
          _streamText += evt.chunk;
          _streamTokens = evt.tokenCount || _streamTokens + 1;
          _appendStreamChunk(evt.chunk);
        }
        break;

      case 'nim.stream_end':
        _streamActive = false;
        _updateStreamLED(false);
        _stopStopwatch();
        if (evt.latency_ms) {
          _totalLatency += evt.latency_ms;
        }
        _removeCursor();
        _updateStreamMeta(evt.totalTokens || _streamTokens, evt.latency_ms || (Date.now() - _streamStartTs));
        _refreshStats();
        break;

      case 'task.quality_score':
        if (evt.source === 'qnn' && evt.qnnQuality !== undefined) {
          _lastQnnQuality = evt.qnnQuality;
          _updateQualityBars();
        }
        if (evt.source === 'nim' && evt.nimQuality !== undefined) {
          _lastNimQuality = evt.nimQuality;
          _updateQualityBars();
        }
        break;

      case 'task.nim_override':
        _nimWins++;
        _refreshStats();
        break;

      case 'task.start':
        // Reset quality for new task
        _lastQnnQuality = null;
        _lastNimQuality = null;
        _updateQualityBars();
        break;
    }
  }

  /* ── Stream LED ──────────────────────────────────────────────────────── */
  function _updateStreamLED(active) {
    const led = document.getElementById('nim-stream-led');
    if (!led) return;
    led.classList.toggle('active', active);
    led.title = active ? 'Streaming…' : 'Stream idle';
  }

  /* ── Stream body ─────────────────────────────────────────────────────── */
  function _clearStreamBody() {
    const body = document.getElementById('nim-stream-body');
    if (body) body.innerHTML = '<span class="nim-stream-cursor"></span>';
  }

  function _appendStreamChunk(text) {
    const body = document.getElementById('nim-stream-body');
    if (!body) return;
    // Insert text before cursor
    const cursor = body.querySelector('.nim-stream-cursor');
    if (cursor) {
      const textNode = document.createTextNode(text);
      body.insertBefore(textNode, cursor);
    } else {
      body.textContent += text;
    }
    body.scrollTop = body.scrollHeight;
  }

  function _removeCursor() {
    const cursor = document.querySelector('#nim-stream-body .nim-stream-cursor');
    if (cursor) cursor.remove();
  }

  /* ── Stopwatch ───────────────────────────────────────────────────────── */
  function _startStopwatch() {
    _stopStopwatch();
    const meta = document.getElementById('nim-stream-meta');
    if (!meta) return;
    _streamTimer = setInterval(() => {
      const elapsed = ((Date.now() - _streamStartTs) / 1000).toFixed(1);
      meta.textContent = `${_streamTokens} tokens · ${elapsed}s`;
    }, 100);
  }

  function _stopStopwatch() {
    if (_streamTimer) {
      clearInterval(_streamTimer);
      _streamTimer = null;
    }
  }

  function _updateStreamMeta(tokens, latencyMs) {
    const meta = document.getElementById('nim-stream-meta');
    if (!meta) return;
    const secs = (latencyMs / 1000).toFixed(1);
    const tps = latencyMs > 0 ? (tokens / (latencyMs / 1000)).toFixed(1) : '—';
    meta.textContent = `${tokens} tokens · ${secs}s · ${tps} t/s`;
  }

  /* ── Quality bars ────────────────────────────────────────────────────── */
  function _updateQualityBars() {
    const qnnBar   = document.getElementById('nim-qnn-bar');
    const nimBar   = document.getElementById('nim-nim-bar');
    const qnnValue = document.getElementById('nim-qnn-value');
    const nimValue = document.getElementById('nim-nim-value');

    if (qnnBar && qnnValue) {
      if (_lastQnnQuality !== null) {
        qnnBar.style.width = `${Math.round(_lastQnnQuality * 100)}%`;
        qnnValue.textContent = (_lastQnnQuality * 100).toFixed(0) + '%';
      } else {
        qnnBar.style.width = '0%';
        qnnValue.textContent = '—';
      }
    }

    if (nimBar && nimValue) {
      if (_lastNimQuality !== null) {
        nimBar.style.width = `${Math.round(_lastNimQuality * 100)}%`;
        nimValue.textContent = (_lastNimQuality * 100).toFixed(0) + '%';
      } else {
        nimBar.style.width = '0%';
        nimValue.textContent = '—';
      }
    }
  }

  /* ── Session stats ───────────────────────────────────────────────────── */
  function _refreshStats() {
    const queries = document.getElementById('nim-stat-queries');
    const latency = document.getElementById('nim-stat-latency');
    const wins    = document.getElementById('nim-stat-wins');

    if (queries) queries.textContent = _nimQueries;
    if (latency) {
      if (_nimQueries > 0) {
        const avg = Math.round(_totalLatency / _nimQueries);
        latency.textContent = avg > 1000 ? `${(avg / 1000).toFixed(1)}s` : `${avg}ms`;
      } else {
        latency.textContent = '—';
      }
    }
    if (wins) wins.textContent = _nimWins;

    // Also pull from agent metrics if available
    if (window.bucksAPI && window.bucksAPI.agentMetrics) {
      window.bucksAPI.agentMetrics().then((m) => {
        if (!m || m.error) return;
        if (wins && m.nimWins !== undefined) wins.textContent = m.nimWins;
      }).catch(() => {});
    }
  }

  /* ── Init ─────────────────────────────────────────────────────────────── */
  function init() {
    _injectStyles();
    _buildDOM();
    _bindHotkey();

    /* Subscribe to AG-UI events */
    if (window.bucksAPI && window.bucksAPI.onAgentEvent) {
      window.bucksAPI.onAgentEvent(onAgentEvent);
    }
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  window.nimPanel = {
    open,
    close,
    toggle,
    onAgentEvent,
    getSelectedModel:  () => _selectedModel,
    isOverrideActive:  () => _override,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

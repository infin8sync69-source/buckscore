/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BUCKS PROJECT NEXUS — Agentic Interface Panel                           ║
 * ║                                                                           ║
 * ║  A self-contained, premium UI module that surfaces Bucks' AI agent        ║
 * ║  capabilities with full observability and control:                        ║
 * ║                                                                           ║
 * ║  1. Goal Composer      — ⌘+Shift+A floating command bar                  ║
 * ║  2. Step Trace Feed    — typed event cards (thinking/tool/result/done)    ║
 * ║  3. Action Approval Gate — safety modal for browser_action steps          ║
 * ║  4. Swarm Status Sidebar — live peer topology                             ║
 * ║  5. Goal History Panel   — persistent multi-session goal log              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';

  /* ── State ── */
  let _isOpen        = false;
  let _sessionId     = null;
  let _isRunning     = false;
  let _autoApprove   = false;
  let _unsubStep     = null;
  let _unsubApproval = null;
  let _pendingApproval = null; // { sessionId, actionId, name, label }
  let _steps         = [];     // array of step objects for current session
  let _swarmPollTimer = null;

  /* ── DOM Element Cache ── */
  let _panel = null;
  let _overlay = null;

  /* ── Initialise ── */
  function init() {
    _injectStyles();
    _buildDOM();
    _bindHotkey();
    _bindNexusEvents();
    _bindEngineStatus();
    _pollSwarmStatus();
    console.log('[NEXUS] Panel initialised — ⌘+Shift+A to open');
  }

  /* Local-AI engine status pill — reflects the supervisor lifecycle so users
   * see "warming up / ready / unavailable / conflict" instead of silent fail. */
  function _renderEngineStatus(s) {
    const led = _$('nexus-engine-led');
    const label = _$('nexus-engine-label');
    const pill = _$('nexus-engine-pill');
    if (!led || !label || !pill) return;
    const map = {
      ready:       ['#4ade80', s && s.model ? `AI: ${s.model}` : 'AI ready',            'Local AI engine ready'],
      loading:     ['#fbbf24', 'AI warming up…',    'Model is loading'],
      starting:    ['#fbbf24', 'AI starting…',      s && s.detail ? s.detail : 'Launching engine'],
      conflict:    ['#f87171', 'AI port conflict',  s && s.detail ? s.detail : 'Port 8765 in use by another app'],
      unavailable: ['#9ca3af', 'AI unavailable',    s && s.detail ? s.detail : 'Run agent/start_soul_engine.sh once'],
      error:       ['#f87171', 'AI error',          s && s.detail ? s.detail : 'Engine error'],
      stopped:     ['#9ca3af', 'AI stopped',        'Engine stopped'],
      unknown:     ['#9ca3af', 'AI…',               'Checking engine'],
    };
    const [color, text, tip] = map[s && s.state] || map.unknown;
    led.style.background = color;
    led.style.boxShadow = `0 0 6px ${color}`;
    label.textContent = text;
    pill.title = tip;
  }

  async function _bindEngineStatus() {
    if (!window.nexusAPI) return;
    try {
      if (window.nexusAPI.onSoulEngineStatus) {
        window.nexusAPI.onSoulEngineStatus(_renderEngineStatus);
      }
      if (window.nexusAPI.soulEngineStatus) {
        _renderEngineStatus(await window.nexusAPI.soulEngineStatus());
      }
    } catch (_) { /* best effort */ }
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  STYLE INJECTION
   * ════════════════════════════════════════════════════════════════════════ */
  function _injectStyles() {
    if (document.getElementById('nexus-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexus-styles';
    style.textContent = `
      /* ── NEXUS Design Tokens ── */
      :root {
        --nx-bg:            rgba(8, 10, 18, 0.96);
        --nx-surface:       rgba(18, 22, 38, 0.92);
        --nx-border:        rgba(80, 140, 255, 0.18);
        --nx-glow:          rgba(80, 140, 255, 0.35);
        --nx-accent:        #508cff;
        --nx-thinking:      #f7b731;
        --nx-tool:          #3ee5ff;
        --nx-result:        #7effa0;
        --nx-browser:       #ff8c3e;
        --nx-done:          #3eff9a;
        --nx-error:         #ff4f6a;
        --nx-cancelled:     #888ea8;
        --nx-text:          #e0e8ff;
        --nx-muted:         #6874a8;
        --nx-radius:        14px;
        --nx-radius-sm:     8px;
        --nx-shadow:        0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px var(--nx-border);
        --nx-font:          'Inter', 'SF Pro Display', system-ui, sans-serif;
        --nx-mono:          'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      }

      /* ── NEXUS Panel Shell ── */
      #nexus-panel {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        font-family: var(--nx-font);
      }
      #nexus-panel.nx-open { pointer-events: all; }

      /* ── Backdrop ── */
      #nexus-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(4, 6, 14, 0.7);
        backdrop-filter: blur(12px) saturate(0.8);
        opacity: 0;
        transition: opacity 0.25s ease;
      }
      #nexus-panel.nx-open #nexus-backdrop { opacity: 1; }

      /* ── Main Container ── */
      #nexus-container {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(780px, 92vw);
        max-height: 80vh;
        background: var(--nx-bg);
        border: 1px solid var(--nx-border);
        border-radius: var(--nx-radius);
        box-shadow: var(--nx-shadow);
        transform: translateY(40px) scale(0.96);
        opacity: 0;
        transition: transform 0.28s cubic-bezier(.16,1,.3,1), opacity 0.22s ease;
        overflow: hidden;
      }
      #nexus-panel.nx-open #nexus-container {
        transform: translateY(0) scale(1);
        opacity: 1;
      }

      /* ── Header bar ── */
      #nexus-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 18px 12px;
        border-bottom: 1px solid var(--nx-border);
        flex-shrink: 0;
      }
      .nx-logo {
        width: 22px; height: 22px;
        background: linear-gradient(135deg, var(--nx-accent), #a06fff);
        border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; color: white; font-weight: 700;
        flex-shrink: 0;
      }
      .nx-header-title {
        font-size: 13px; font-weight: 600;
        color: var(--nx-text); letter-spacing: 0.02em;
        flex: 1;
      }
      .nx-status-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--nx-muted);
        transition: background 0.3s;
        flex-shrink: 0;
      }
      .nx-engine-pill {
        display: inline-flex; align-items: center; gap: 6px;
        margin-left: auto; padding: 3px 9px; border-radius: 999px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        font-size: 11px; color: rgba(255,255,255,0.75);
        white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
      }
      .nx-engine-led {
        width: 7px; height: 7px; border-radius: 50%;
        background: #9ca3af; flex-shrink: 0; transition: background .3s, box-shadow .3s;
      }
      .nx-status-dot.running {
        background: var(--nx-done);
        box-shadow: 0 0 8px var(--nx-done);
        animation: nx-pulse 1.4s infinite;
      }
      @keyframes nx-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      #nexus-btn-history, #nexus-btn-swarm, #nexus-btn-close {
        background: transparent;
        border: none; cursor: pointer;
        color: var(--nx-muted);
        font-size: 15px; line-height: 1;
        padding: 4px 6px;
        border-radius: var(--nx-radius-sm);
        transition: color 0.2s, background 0.2s;
      }
      #nexus-btn-history:hover, #nexus-btn-swarm:hover,
      #nexus-btn-close:hover { color: var(--nx-text); background: rgba(255,255,255,0.07); }

      /* ── Goal Composer ── */
      #nexus-composer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--nx-border);
        flex-shrink: 0;
      }
      #nexus-input {
        flex: 1;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(80,140,255,0.2);
        border-radius: var(--nx-radius-sm);
        color: var(--nx-text);
        font-family: var(--nx-font);
        font-size: 14px;
        padding: 10px 14px;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      #nexus-input::placeholder { color: var(--nx-muted); }
      #nexus-input:focus {
        border-color: var(--nx-accent);
        box-shadow: 0 0 0 3px rgba(80,140,255,0.12);
      }
      #nexus-btn-run {
        background: linear-gradient(135deg, var(--nx-accent), #7b5fff);
        border: none; cursor: pointer;
        color: white; font-size: 13px; font-weight: 600;
        padding: 10px 18px; border-radius: var(--nx-radius-sm);
        transition: opacity 0.2s, transform 0.15s;
        white-space: nowrap;
      }
      #nexus-btn-run:hover { opacity: 0.9; transform: translateY(-1px); }
      #nexus-btn-run:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
      #nexus-btn-cancel {
        background: rgba(255,79,106,0.15);
        border: 1px solid rgba(255,79,106,0.3);
        border-radius: var(--nx-radius-sm);
        color: var(--nx-error);
        font-size: 12px; font-weight: 600;
        padding: 9px 14px; cursor: pointer;
        display: none;
        transition: background 0.2s;
      }
      #nexus-btn-cancel:hover { background: rgba(255,79,106,0.25); }
      #nexus-btn-cancel.visible { display: block; }

      /* ── Body: trace + swarm ── */
      #nexus-body {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-height: 0;
      }

      /* ── Step Trace Feed ── */
      #nexus-trace {
        flex: 1;
        overflow-y: auto;
        padding: 12px 18px 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        scrollbar-width: thin;
        scrollbar-color: var(--nx-border) transparent;
      }
      #nexus-trace:empty::after {
        content: 'Enter a goal above to start the agent…';
        color: var(--nx-muted);
        font-size: 13px;
        text-align: center;
        margin-top: 32px;
        display: block;
      }

      /* ── Step Cards ── */
      .nx-step {
        border-radius: var(--nx-radius-sm);
        padding: 10px 12px;
        font-size: 13px;
        line-height: 1.5;
        border: 1px solid transparent;
        animation: nx-slide-in 0.22s cubic-bezier(.16,1,.3,1);
        position: relative;
      }
      @keyframes nx-slide-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .nx-step-header {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 4px; cursor: pointer; user-select: none;
      }
      .nx-step-icon { font-size: 14px; flex-shrink: 0; }
      .nx-step-label {
        font-weight: 600; font-size: 12px; text-transform: uppercase;
        letter-spacing: 0.05em; flex: 1;
      }
      .nx-step-time {
        font-size: 10px; color: var(--nx-muted);
        font-family: var(--nx-mono);
      }
      .nx-step-body {
        font-family: var(--nx-mono);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        color: rgba(224,232,255,0.85);
        margin-top: 4px;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }
      .nx-step-body.collapsed { max-height: 40px; }

      /* Type-specific colours */
      .nx-step-thinking  { background: rgba(247,183,49,0.07); border-color: rgba(247,183,49,0.2); }
      .nx-step-thinking .nx-step-label { color: var(--nx-thinking); }

      .nx-step-tool_call { background: rgba(62,229,255,0.07); border-color: rgba(62,229,255,0.2); }
      .nx-step-tool_call .nx-step-label { color: var(--nx-tool); }

      .nx-step-tool_result { background: rgba(126,255,160,0.06); border-color: rgba(126,255,160,0.15); }
      .nx-step-tool_result .nx-step-label { color: var(--nx-result); }

      .nx-step-browser_action { background: rgba(255,140,62,0.09); border-color: rgba(255,140,62,0.28); }
      .nx-step-browser_action .nx-step-label { color: var(--nx-browser); }

      .nx-step-token { background: rgba(80,140,255,0.05); border-color: rgba(80,140,255,0.12); }
      .nx-step-token .nx-step-label { color: var(--nx-accent); }

      .nx-step-done { background: rgba(62,255,154,0.08); border-color: rgba(62,255,154,0.25); }
      .nx-step-done .nx-step-label { color: var(--nx-done); }

      .nx-step-error { background: rgba(255,79,106,0.08); border-color: rgba(255,79,106,0.25); }
      .nx-step-error .nx-step-label { color: var(--nx-error); }

      .nx-step-cancelled { background: rgba(136,142,168,0.07); border-color: rgba(136,142,168,0.2); }
      .nx-step-cancelled .nx-step-label { color: var(--nx-cancelled); }

      /* ── Approval badge on browser_action ── */
      .nx-approval-badge {
        display: inline-flex; gap: 6px;
        margin-top: 8px;
      }
      .nx-btn-approve, .nx-btn-deny {
        border: none; border-radius: 6px;
        font-size: 11px; font-weight: 600;
        padding: 5px 12px; cursor: pointer;
        transition: opacity 0.2s, transform 0.15s;
      }
      .nx-btn-approve { background: rgba(62,255,154,0.18); color: var(--nx-done); border: 1px solid rgba(62,255,154,0.3); }
      .nx-btn-deny    { background: rgba(255,79,106,0.18); color: var(--nx-error); border: 1px solid rgba(255,79,106,0.3); }
      .nx-btn-approve:hover { opacity: 0.85; transform: translateY(-1px); }
      .nx-btn-deny:hover    { opacity: 0.85; transform: translateY(-1px); }
      .nx-approval-countdown { font-size: 10px; color: var(--nx-muted); font-family: var(--nx-mono); margin-left: 6px; line-height: 28px; }

      /* ── Auto-approve toggle ── */
      #nexus-autoapprove-row {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 18px;
        border-top: 1px solid var(--nx-border);
        font-size: 12px; color: var(--nx-muted);
        flex-shrink: 0;
      }
      .nx-toggle {
        width: 32px; height: 18px;
        background: rgba(255,255,255,0.1);
        border-radius: 9px;
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .nx-toggle.on { background: var(--nx-accent); }
      .nx-toggle::after {
        content: '';
        position: absolute;
        width: 12px; height: 12px;
        background: white;
        border-radius: 50%;
        top: 3px; left: 3px;
        transition: transform 0.2s;
      }
      .nx-toggle.on::after { transform: translateX(14px); }

      /* ── Swarm Sidebar ── */
      #nexus-swarm {
        width: 200px;
        border-left: 1px solid var(--nx-border);
        overflow-y: auto;
        padding: 12px;
        flex-shrink: 0;
        display: none;
        flex-direction: column;
        gap: 8px;
      }
      #nexus-swarm.visible { display: flex; }
      .nx-swarm-title {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--nx-muted);
        margin-bottom: 4px;
      }
      .nx-peer-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid var(--nx-border);
        border-radius: var(--nx-radius-sm);
        padding: 8px 10px;
        font-size: 11px;
      }
      .nx-peer-id { color: var(--nx-accent); font-family: var(--nx-mono); font-size: 10px; margin-bottom: 3px; }
      .nx-peer-model { color: var(--nx-text); margin-bottom: 4px; }
      .nx-load-bar-bg {
        height: 4px; background: rgba(255,255,255,0.08);
        border-radius: 2px; overflow: hidden;
      }
      .nx-load-bar { height: 100%; background: var(--nx-accent); border-radius: 2px; transition: width 0.4s; }
      .nx-swarm-empty { color: var(--nx-muted); font-size: 11px; text-align: center; margin-top: 20px; }

      /* ── History Drawer ── */
      #nexus-history {
        position: absolute;
        top: 0; right: 0; bottom: 0;
        width: 300px;
        background: var(--nx-surface);
        border-left: 1px solid var(--nx-border);
        overflow-y: auto;
        padding: 14px;
        transform: translateX(100%);
        transition: transform 0.28s cubic-bezier(.16,1,.3,1);
        z-index: 10;
      }
      #nexus-history.open { transform: translateX(0); }
      .nx-history-title {
        font-size: 12px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.07em;
        color: var(--nx-muted); margin-bottom: 12px;
      }
      .nx-goal-item {
        background: rgba(255,255,255,0.04);
        border: 1px solid var(--nx-border);
        border-radius: var(--nx-radius-sm);
        padding: 8px 10px; margin-bottom: 6px;
        font-size: 12px; cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
      }
      .nx-goal-item:hover { border-color: var(--nx-accent); background: rgba(80,140,255,0.07); }
      .nx-goal-text { color: var(--nx-text); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .nx-goal-meta { display: flex; gap: 8px; align-items: center; }
      .nx-goal-status {
        font-size: 10px; font-weight: 600;
        padding: 1px 6px; border-radius: 4px;
      }
      .nx-goal-status.completed { background: rgba(62,255,154,0.15); color: var(--nx-done); }
      .nx-goal-status.running   { background: rgba(80,140,255,0.15); color: var(--nx-accent); }
      .nx-goal-status.error     { background: rgba(255,79,106,0.15); color: var(--nx-error); }
      .nx-goal-status.cancelled { background: rgba(136,142,168,0.1); color: var(--nx-cancelled); }
      .nx-goal-time { font-size: 10px; color: var(--nx-muted); font-family: var(--nx-mono); }

      /* ── Toolbar indicator dot (injected into browser toolbar) ── */
      #nexus-toolbar-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: var(--nx-muted);
        cursor: pointer;
        transition: background 0.3s;
        margin: auto 0;
        flex-shrink: 0;
      }
      #nexus-toolbar-dot.running {
        background: var(--nx-done);
        box-shadow: 0 0 6px var(--nx-done);
        animation: nx-pulse 1.4s infinite;
      }
    `;
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  DOM CONSTRUCTION
   * ════════════════════════════════════════════════════════════════════════ */
  function _buildDOM() {
    if (document.getElementById('nexus-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'nexus-panel';
    panel.innerHTML = `
      <div id="nexus-backdrop"></div>
      <div id="nexus-container" role="dialog" aria-label="Bucks NEXUS Agent Panel">

        <!-- Header -->
        <div id="nexus-header">
          <div class="nx-logo">N</div>
          <div class="nx-header-title">Bucks NEXUS Agent</div>
          <div class="nx-engine-pill" id="nexus-engine-pill" title="Local AI engine status">
            <span class="nx-engine-led" id="nexus-engine-led"></span>
            <span id="nexus-engine-label">AI…</span>
          </div>
          <div class="nx-status-dot" id="nexus-status-dot" title="Agent idle"></div>
          <button id="nexus-btn-swarm"   title="Swarm Status">⬡</button>
          <button id="nexus-btn-history" title="Goal History">📋</button>
          <button id="nexus-btn-close"   title="Close (Esc)">✕</button>
        </div>

        <!-- Goal Composer -->
        <div id="nexus-composer">
          <input id="nexus-input"
            type="text"
            placeholder="Enter a goal… e.g. Search the latest news about Bitcoin and summarise"
            autocomplete="off" spellcheck="false"
          />
          <button id="nexus-btn-cancel">■ Stop</button>
          <button id="nexus-btn-run">▶ Run</button>
        </div>

        <!-- Body -->
        <div id="nexus-body">
          <!-- Step Trace -->
          <div id="nexus-trace" aria-live="polite" aria-label="Agent step trace"></div>

          <!-- Swarm Sidebar -->
          <div id="nexus-swarm">
            <div class="nx-swarm-title">Swarm Peers</div>
            <div id="nexus-swarm-content">
              <div class="nx-swarm-empty">No peers detected</div>
            </div>
          </div>
        </div>

        <!-- Auto-approve row -->
        <div id="nexus-autoapprove-row">
          <div class="nx-toggle" id="nexus-autoapprove-toggle" title="Auto-approve browser actions"></div>
          <span>Auto-approve browser actions</span>
        </div>

        <!-- History Drawer -->
        <div id="nexus-history" aria-label="Goal history">
          <div class="nx-history-title">Goal History</div>
          <div id="nexus-history-list">Loading…</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    _panel = panel;

    /* ── Wire up events ── */
    _$('nexus-backdrop').addEventListener('click', close);
    _$('nexus-btn-close').addEventListener('click', close);

    _$('nexus-btn-run').addEventListener('click', _runGoal);
    _$('nexus-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) _runGoal();
      if (e.key === 'Escape') close();
    });

    _$('nexus-btn-cancel').addEventListener('click', _cancelGoal);

    _$('nexus-btn-swarm').addEventListener('click', () => {
      _$('nexus-swarm').classList.toggle('visible');
    });

    _$('nexus-btn-history').addEventListener('click', _toggleHistory);

    _$('nexus-autoapprove-toggle').addEventListener('click', () => {
      _autoApprove = !_autoApprove;
      _$('nexus-autoapprove-toggle').classList.toggle('on', _autoApprove);
    });

    _injectToolbarDot();
  }

  function _$( id) { return document.getElementById(id); }

  function _injectToolbarDot() {
    // Try to inject into #nav-buttons or address bar area
    const toolbar = document.querySelector('#nav-buttons') ||
                    document.querySelector('.toolbar') ||
                    document.querySelector('#address-bar-row');
    if (!toolbar) return;
    const dot = document.createElement('div');
    dot.id = 'nexus-toolbar-dot';
    dot.title = 'NEXUS Agent (⌘+Shift+A)';
    dot.addEventListener('click', toggle);
    toolbar.appendChild(dot);
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  OPEN / CLOSE / TOGGLE
   * ════════════════════════════════════════════════════════════════════════ */
  function open() {
    _isOpen = true;
    _panel.classList.add('nx-open');
    setTimeout(() => { const inp = _$('nexus-input'); if (inp) inp.focus(); }, 50);
    _loadHistory();
  }

  function close() {
    _isOpen = false;
    _panel.classList.remove('nx-open');
    _$('nexus-history').classList.remove('open');
  }

  function toggle() {
    _isOpen ? close() : open();
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  HOTKEY
   * ════════════════════════════════════════════════════════════════════════ */
  function _bindHotkey() {
    document.addEventListener('keydown', (e) => {
      // ⌘+Shift+A  (Mac) or  Ctrl+Shift+A  (Win/Linux)
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggle();
      }
      if (_isOpen && e.key === 'Escape') close();
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  RUN / CANCEL
   * ════════════════════════════════════════════════════════════════════════ */
  async function _runGoal() {
    if (_isRunning) return;

    const input  = _$('nexus-input');
    const prompt = (input?.value || '').trim();
    if (!prompt) return;

    // Gather current page context from the active webview (if available)
    let context = '';
    try {
      const ctrl = window.__bucksBrowserControl;
      if (ctrl) {
        const snap = await ctrl.snapshot();
        if (snap) {
          context = `URL: ${snap.url}\nTitle: ${snap.title}`;
        }
      }
    } catch (_) {}

    _setRunning(true);
    _clearTrace();
    _steps = [];

    // Fire and track (non-blocking — SSE events arrive via onStep)
    _sessionId = null;
    window.nexusAPI.startGoal(prompt, { context, agentic: true })
      .then((res) => {
        if (res?.session_id) _sessionId = res.session_id;
      })
      .catch((err) => {
        _appendStep({ type: 'error', content: `Failed to start: ${err?.message || err}` });
        _setRunning(false);
      });
  }

  async function _cancelGoal() {
    if (!_isRunning) return;
    if (_sessionId && window.nexusAPI) {
      await window.nexusAPI.cancelGoal(_sessionId).catch(() => {});
    }
    _appendStep({ type: 'cancelled', content: 'Goal cancelled by user.' });
    _setRunning(false);
  }

  function _setRunning(running) {
    _isRunning = running;
    const runBtn    = _$('nexus-btn-run');
    const cancelBtn = _$('nexus-btn-cancel');
    const dot       = _$('nexus-status-dot');
    const toolbarDot = _$('nexus-toolbar-dot');

    if (runBtn)    runBtn.disabled = running;
    if (cancelBtn) cancelBtn.classList.toggle('visible', running);
    if (dot) {
      dot.classList.toggle('running', running);
      dot.title = running ? 'Agent running…' : 'Agent idle';
    }
    if (toolbarDot) toolbarDot.classList.toggle('running', running);
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  NEXUS EVENT HANDLING
   * ════════════════════════════════════════════════════════════════════════ */
  function _bindNexusEvents() {
    if (!window.nexusAPI) {
      console.warn('[NEXUS] nexusAPI not available — running without IPC bridge');
      return;
    }

    _unsubStep = window.nexusAPI.onStep(_handleStep);
    _unsubApproval = window.nexusAPI.onApprovalRequired(_handleApprovalRequired);
  }

  function _handleStep(evt) {
    if (!evt?.type) return;

    // Capture session_id if we haven't yet
    if (evt.type === 'session' && evt.session_id) {
      _sessionId = evt.session_id;
      return; // internal — don't display
    }

    // Accumulate answer tokens into a single card
    if (evt.type === 'token') {
      _appendOrUpdateTokenCard(evt.content || '');
      return;
    }

    // Terminal events
    if (evt.type === 'done' || evt.type === 'error' || evt.type === 'cancelled') {
      _setRunning(false);
      _loadHistory(); // refresh history list
    }

    _appendStep(evt);
  }

  function _handleApprovalRequired(evt) {
    if (_autoApprove) {
      window.nexusAPI.approveAction(evt.sessionId, evt.actionId).catch(() => {});
      return;
    }
    _pendingApproval = evt;
    _showApprovalOnStep(evt);
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  STEP TRACE RENDERING
   * ════════════════════════════════════════════════════════════════════════ */
  const _STEP_META = {
    thinking:      { icon: '🤔', label: 'Thinking' },
    tool_call:     { icon: '🔧', label: 'Tool Call' },
    tool_result:   { icon: '📄', label: 'Result' },
    browser_action:{ icon: '🌐', label: 'Browser Action' },
    token:         { icon: '💬', label: 'Answer' },
    done:          { icon: '✅', label: 'Done' },
    error:         { icon: '❌', label: 'Error' },
    cancelled:     { icon: '⏹', label: 'Cancelled' },
    session:       { icon: '🔑', label: 'Session' },
  };

  let _tokenCardEl = null; // accumulate streaming tokens here

  function _clearTrace() {
    const trace = _$('nexus-trace');
    if (trace) trace.innerHTML = '';
    _tokenCardEl = null;
  }

  function _formatNexusAnswer(text) {
    if (!text) return { html: '', links: [], followups: [] };

    let rawText = text;
    let links = [];
    let followups = [];

    // 1. Extract follow-up questions wrapped in <followup>...</followup>
    const followupRegex = /<followup>([\s\S]*?)<\/followup>/gi;
    let followupMatch;
    while ((followupMatch = followupRegex.exec(rawText)) !== null) {
      followups.push(followupMatch[1].trim());
    }
    rawText = rawText.replace(followupRegex, '');

    // 2. Extract markdown links: [Label](URL)
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+|[^\s\)]+)\)/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(rawText)) !== null) {
      links.push({ text: linkMatch[1].trim(), url: linkMatch[2].trim() });
    }

    // 3. Escape HTML
    let formatted = _escHtml(rawText);

    // Strip out unclosed <followup> tags so they don't show up as ugly tags during streaming
    formatted = formatted.replace(/&lt;followup&gt;[\s\S]*/gi, '');

    // 4. Format markdown links in text
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      const decodedUrl = url.replace(/&amp;/g, '&');
      return `<a href="#" onclick="window.openAgentLink('${decodedUrl}'); event.preventDefault();" style="color: #78b4ff; text-decoration: underline; font-weight: 500; cursor: pointer; transition: color 0.15s ease;" onmouseover="this.style.color='#a3caff'" onmouseout="this.style.color='#78b4ff'">${linkText}</a>`;
    });

    // 5. Format bold tags
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    return { html: formatted, links, followups };
  }

  function _appendOrUpdateTokenCard(text) {
    const trace = _$('nexus-trace');
    if (!trace) return;
    if (!_tokenCardEl) {
      _tokenCardEl = _makeStepEl({ type: 'token' });
      _tokenCardEl._accumulatedText = '';
      trace.appendChild(_tokenCardEl);
    }
    _tokenCardEl._accumulatedText += text;
    const body = _tokenCardEl.querySelector('.nx-step-body');
    if (body) {
      const parsed = _formatNexusAnswer(_tokenCardEl._accumulatedText);
      body.innerHTML = parsed.html;
      
      // Update or create follow-up / link buttons in the token card
      let ctaSec = _tokenCardEl.querySelector('.nx-cta-section');
      if (!ctaSec) {
        ctaSec = document.createElement('div');
        ctaSec.className = 'nx-cta-section';
        ctaSec.style.cssText = 'display:none; flex-wrap:wrap; gap:8px; margin-top:10px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.1);';
        _tokenCardEl.appendChild(ctaSec);
      }
      
      if (parsed.links.length > 0 || parsed.followups.length > 0) {
        ctaSec.style.display = 'flex';
        let ctaHtml = '';
        
        parsed.links.forEach(link => {
          ctaHtml += `
            <a href="#" onclick="window.openAgentLink('${_escHtml(link.url)}'); event.preventDefault();" style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(80, 140, 255, 0.3); background: rgba(80, 140, 255, 0.08); color: rgba(80, 140, 255, 0.95); font-size: 11px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(80, 140, 255, 0.15)'; this.style.borderColor='rgba(80, 140, 255, 0.5)';" onmouseout="this.style.background='rgba(80, 140, 255, 0.08)'; this.style.borderColor='rgba(80, 140, 255, 0.3)';">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
              ${_escHtml(link.text)}
            </a>`;
        });
        
        parsed.followups.forEach(q => {
          ctaHtml += `
            <button onclick="window.submitAgentFollowup('${encodeURIComponent(q)}')" style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.03); color: rgba(255, 255, 255, 0.8); font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.15s ease;" onmouseover="this.style.background='rgba(255, 255, 255, 0.08)'; this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255, 255, 255, 0.03)'; this.style.borderColor='rgba(255, 255, 255, 0.1)'; this.style.color='rgba(255, 255, 255, 0.8)';">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              ${_escHtml(q)}
            </button>`;
        });
        
        ctaSec.innerHTML = ctaHtml;
      } else {
        ctaSec.style.display = 'none';
      }
    }
    trace.scrollTop = trace.scrollHeight;
  }

  function _appendStep(evt) {
    const trace = _$('nexus-trace');
    if (!trace) return;

    // Reset the token accumulator on non-token events
    if (evt.type !== 'token') _tokenCardEl = null;

    const el = _makeStepEl(evt);
    trace.appendChild(el);
    trace.scrollTop = trace.scrollHeight;
  }

  function _makeStepEl(evt) {
    const meta    = _STEP_META[evt.type] || { icon: '•', label: evt.type };
    const time    = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const content = evt.content || evt.label || evt.name || '';

    const el = document.createElement('div');
    el.className = `nx-step nx-step-${evt.type}`;
    el.dataset.stepType = evt.type;

    // Determine if content should be collapsible (long text)
    const isLong    = content.length > 120;
    const bodyClass = isLong ? 'nx-step-body collapsed' : 'nx-step-body';

    el.innerHTML = `
      <div class="nx-step-header">
        <span class="nx-step-icon">${meta.icon}</span>
        <span class="nx-step-label">${meta.label}${evt.name ? `: ${_escHtml(evt.name)}` : ''}</span>
        <span class="nx-step-time">${time}</span>
        ${isLong ? '<span style="color:var(--nx-muted);font-size:10px;cursor:pointer">[expand]</span>' : ''}
      </div>
      <div class="${bodyClass}">${_escHtml(content)}</div>
    `;

    // Collapse toggle
    if (isLong) {
      const header = el.querySelector('.nx-step-header');
      const body   = el.querySelector('.nx-step-body');
      header.addEventListener('click', () => {
        body.classList.toggle('collapsed');
      });
    }

    return el;
  }

  function _showApprovalOnStep(evt) {
    // Find or create the browser_action step card for this action
    const trace = _$('nexus-trace');
    if (!trace) return;

    const step = document.createElement('div');
    step.className = 'nx-step nx-step-browser_action';
    step.id = `nx-approval-${evt.actionId}`;

    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

    step.innerHTML = `
      <div class="nx-step-header">
        <span class="nx-step-icon">🌐</span>
        <span class="nx-step-label">Browser Action — Approval Required</span>
        <span class="nx-step-time">${timeStr}</span>
      </div>
      <div class="nx-step-body">${_escHtml(evt.label || evt.name)}</div>
      <div class="nx-approval-badge">
        <button class="nx-btn-approve" id="nx-approve-${evt.actionId}">✓ Approve</button>
        <button class="nx-btn-deny"    id="nx-deny-${evt.actionId}">✗ Deny</button>
        <span class="nx-approval-countdown" id="nx-cd-${evt.actionId}">30s</span>
      </div>
    `;
    trace.appendChild(step);
    trace.scrollTop = trace.scrollHeight;

    // Countdown timer
    let secs = 30;
    const cdEl = document.getElementById(`nx-cd-${evt.actionId}`);
    const timer = setInterval(() => {
      secs--;
      if (cdEl) cdEl.textContent = `${secs}s`;
      if (secs <= 0) {
        clearInterval(timer);
        _deny(evt);
      }
    }, 1000);

    // Approve
    const approveBtn = document.getElementById(`nx-approve-${evt.actionId}`);
    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        clearInterval(timer);
        _approve(evt);
        step.querySelector('.nx-approval-badge')?.remove();
        const body = step.querySelector('.nx-step-body');
        if (body) body.textContent += ' ✓ Approved';
      });
    }

    // Deny
    const denyBtn = document.getElementById(`nx-deny-${evt.actionId}`);
    if (denyBtn) {
      denyBtn.addEventListener('click', () => {
        clearInterval(timer);
        _deny(evt);
        step.querySelector('.nx-approval-badge')?.remove();
        const body = step.querySelector('.nx-step-body');
        if (body) body.textContent += ' ✗ Denied';
      });
    }
  }

  function _approve(evt) {
    if (window.nexusAPI) {
      window.nexusAPI.approveAction(evt.sessionId, evt.actionId).catch(() => {});
    }
    _pendingApproval = null;
  }

  function _deny(evt) {
    if (window.nexusAPI) {
      window.nexusAPI.denyAction(evt.sessionId, evt.actionId).catch(() => {});
    }
    _pendingApproval = null;
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  SWARM STATUS
   * ════════════════════════════════════════════════════════════════════════ */
  function _pollSwarmStatus() {
    if (!window.nexusAPI) return;
    _refreshSwarm();
    _swarmPollTimer = setInterval(_refreshSwarm, 8000);
  }

  async function _refreshSwarm() {
    if (!window.nexusAPI) return;
    try {
      const data = await window.nexusAPI.getSwarmStatus();
      _renderSwarm(data?.swarm);
    } catch (_) {}
  }

  function _renderSwarm(swarm) {
    const el = _$('nexus-swarm-content');
    if (!el) return;

    if (!swarm || !swarm.peerList || swarm.peerList.length === 0) {
      el.innerHTML = '<div class="nx-swarm-empty">No peers detected</div>';
      return;
    }

    el.innerHTML = swarm.peerList.map((peer) => {
      const load = peer.load || 0;
      const max  = swarm.maxLoad || 5;
      const pct  = Math.round((load / max) * 100);
      return `
        <div class="nx-peer-card">
          <div class="nx-peer-id">${_escHtml((peer.nodeId || '?').slice(0, 12))}…</div>
          <div class="nx-peer-model">${_escHtml(peer.model || '?')}</div>
          <div class="nx-load-bar-bg"><div class="nx-load-bar" style="width:${pct}%"></div></div>
          <div style="font-size:10px;color:var(--nx-muted);margin-top:3px">${_escHtml(peer.lastSeen || '')} · ${_escHtml(peer.locality || '')}</div>
        </div>
      `;
    }).join('');
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  GOAL HISTORY
   * ════════════════════════════════════════════════════════════════════════ */
  function _toggleHistory() {
    const drawer = _$('nexus-history');
    if (!drawer) return;
    const isOpen = drawer.classList.toggle('open');
    if (isOpen) _loadHistory();
  }

  async function _loadHistory() {
    if (!window.nexusAPI) return;
    const listEl = _$('nexus-history-list');
    if (!listEl) return;

    try {
      const data = await window.nexusAPI.listGoals();
      const goals = data?.goals || [];

      if (!goals.length) {
        listEl.innerHTML = '<div style="color:var(--nx-muted);font-size:12px;text-align:center;margin-top:20px">No goals yet</div>';
        return;
      }

      listEl.innerHTML = goals.map((g) => {
        const date = g.updated_at ? new Date(g.updated_at * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        return `
          <div class="nx-goal-item" data-goal="${_escAttr(g.goal)}">
            <div class="nx-goal-text">${_escHtml(g.goal || '')}</div>
            <div class="nx-goal-meta">
              <span class="nx-goal-status ${g.status}">${g.status}</span>
              <span class="nx-goal-time">${date}</span>
            </div>
          </div>
        `;
      }).join('');

      // Click to replay a goal
      listEl.querySelectorAll('.nx-goal-item').forEach((item) => {
        item.addEventListener('click', () => {
          const inp = _$('nexus-input');
          if (inp) {
            inp.value = item.dataset.goal;
            _$('nexus-history').classList.remove('open');
            inp.focus();
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--nx-error);font-size:12px">Error loading history: ${e.message}</div>`;
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  UTILITIES
   * ════════════════════════════════════════════════════════════════════════ */
  function _escHtml(str) {
    // Also encodes ' (not just "): this helper's output is reused inside
    // single-quoted onclick="...('...')" attributes, e.g. openAgentLink
    // calls built from agent-echoed / scraped link text.
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function _escAttr(str) {
    return String(str || '').replace(/"/g, '&quot;');
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  PUBLIC API
   * ════════════════════════════════════════════════════════════════════════ */
  window.__nexusPanel = { init, open, close, toggle };

  // Auto-init when script is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

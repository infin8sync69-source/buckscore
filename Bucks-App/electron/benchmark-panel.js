/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BUCKS BENCHMARK DASHBOARD — QNN Quality Observatory                     ║
 * ║                                                                           ║
 * ║  Premium slide-in panel for real-time QNN + NIM quality monitoring:       ║
 * ║                                                                           ║
 * ║  1. Quality Sparkline   — last 20 scores with 0.65 threshold line        ║
 * ║  2. Strategy Grid       — 5-cell heat map by strategy hit count          ║
 * ║  3. Session Stats       — queries, QNN win %, NIM win %, avg latency     ║
 * ║  4. Run Benchmark       — triggers soul_benchmark.py (20 fixed queries)  ║
 * ║                                                                           ║
 * ║  Hotkey: ⌘+Shift+B (Mac) / Ctrl+Shift+B (Win/Linux)                     ║
 * ║  Auto-refreshes every 5s while open.                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
(function BenchmarkPanel() {
  'use strict';

  if (window.__benchmarkPanelInit) return;
  window.__benchmarkPanelInit = true;

  /* ── State ───────────────────────────────────────────────────────────── */
  let _isOpen       = false;
  let _panel        = null;
  let _refreshTimer = null;
  let _benchRunning = false;

  /* ── Style injection ─────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('bench-panel-styles')) return;
    const s = document.createElement('style');
    s.id = 'bench-panel-styles';
    s.textContent = `
      #bench-panel-root {
        position: fixed;
        top: 0; left: -480px; bottom: 0;
        width: 460px;
        z-index: 99997;
        background: rgba(8, 10, 18, 0.97);
        border-right: 1px solid rgba(124, 92, 252, 0.18);
        box-shadow: 20px 0 60px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(24px) saturate(1.2);
        -webkit-backdrop-filter: blur(24px) saturate(1.2);
        font-family: 'Inter', 'SF Pro Display', system-ui, sans-serif;
        color: #e0e8ff;
        display: flex;
        flex-direction: column;
        transition: left 0.32s cubic-bezier(.16, 1, .3, 1);
        overflow: hidden;
      }
      #bench-panel-root.bench-open { left: 0; }

      /* ── Header ── */
      .bench-header {
        display: flex; align-items: center; gap: 10px;
        padding: 16px 18px 14px;
        border-bottom: 1px solid rgba(124,92,252,0.12);
        flex-shrink: 0;
      }
      .bench-logo {
        width: 24px; height: 24px;
        background: linear-gradient(135deg, #7c5cfc, #a06fff);
        border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; color: white; font-weight: 800;
        flex-shrink: 0;
      }
      .bench-title {
        font-size: 13px; font-weight: 600;
        color: rgba(255,255,255,0.92);
        letter-spacing: 0.02em;
        flex: 1;
      }
      .bench-btn-close {
        background: transparent;
        border: none; cursor: pointer;
        color: rgba(255,255,255,0.4);
        font-size: 16px; line-height: 1;
        padding: 4px 6px;
        border-radius: 6px;
        transition: color 0.2s, background 0.2s;
      }
      .bench-btn-close:hover { color: #fff; background: rgba(255,255,255,0.08); }

      /* ── Body ── */
      .bench-body {
        flex: 1;
        overflow-y: auto;
        padding: 14px 18px 18px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        scrollbar-width: thin;
        scrollbar-color: rgba(124,92,252,0.2) transparent;
      }

      /* ── Section titles ── */
      .bench-section-title {
        font-size: 10px; font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255,255,255,0.35);
        margin-bottom: 8px;
      }

      /* ── Sparkline canvas ── */
      .bench-sparkline-wrap {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(124,92,252,0.1);
        border-radius: 10px;
        padding: 14px;
      }
      #bench-sparkline-canvas {
        width: 100%;
        height: 80px;
        display: block;
      }

      /* ── Strategy grid ── */
      .bench-strategy-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 6px;
      }
      .bench-strategy-cell {
        text-align: center;
        padding: 10px 4px;
        border-radius: 8px;
        border: 1px solid rgba(124,92,252,0.08);
        transition: background 0.3s, border-color 0.3s;
      }
      .bench-strategy-name {
        font-size: 9px; font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255,255,255,0.4);
        margin-bottom: 4px;
      }
      .bench-strategy-count {
        font-size: 16px; font-weight: 700;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        color: rgba(124,92,252,0.8);
      }

      /* ── Session stat cards ── */
      .bench-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .bench-stat-card {
        text-align: center;
        padding: 10px 6px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(124,92,252,0.08);
        border-radius: 8px;
      }
      .bench-stat-value {
        font-size: 18px; font-weight: 700;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        color: #a06fff;
        line-height: 1.2;
      }
      .bench-stat-label {
        font-size: 9px; font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255,255,255,0.3);
        margin-top: 3px;
      }

      /* ── Benchmark runner ── */
      .bench-runner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(124,92,252,0.1);
        border-radius: 10px;
      }
      .bench-btn-run {
        background: linear-gradient(135deg, #7c5cfc, #a06fff);
        border: none; cursor: pointer;
        color: white; font-size: 12px; font-weight: 600;
        padding: 8px 16px; border-radius: 6px;
        transition: opacity 0.2s, transform 0.15s;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .bench-btn-run:hover { opacity: 0.9; transform: translateY(-1px); }
      .bench-btn-run:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
      .bench-run-status {
        font-size: 11px;
        color: rgba(255,255,255,0.4);
        flex: 1;
      }
      .bench-run-status.running { color: #f7b731; }
      .bench-run-status.done    { color: #4ade80; }
      .bench-run-status.error   { color: #ff4f6a; }

      /* ── Benchmark results ── */
      .bench-results {
        display: none;
        padding: 12px;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(124,92,252,0.1);
        border-radius: 10px;
        font-size: 11px;
        line-height: 1.6;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        color: rgba(255,255,255,0.6);
        max-height: 200px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .bench-results.visible { display: block; }
    `;
    document.head.appendChild(s);
  }

  /* ── Build DOM ───────────────────────────────────────────────────────── */
  function _buildDOM() {
    if (document.getElementById('bench-panel-root')) return;

    const panel = document.createElement('div');
    panel.id = 'bench-panel-root';
    panel.innerHTML = `
      <div class="bench-header">
        <div class="bench-logo">Q</div>
        <div class="bench-title">Quality Dashboard</div>
        <button class="bench-btn-close" id="bench-btn-close" title="Close (Esc)">✕</button>
      </div>

      <div class="bench-body">
        <!-- Quality Sparkline -->
        <div>
          <div class="bench-section-title">Quality History (last 20 queries)</div>
          <div class="bench-sparkline-wrap">
            <canvas id="bench-sparkline-canvas"></canvas>
          </div>
        </div>

        <!-- Strategy Grid -->
        <div>
          <div class="bench-section-title">Strategy Distribution</div>
          <div class="bench-strategy-grid" id="bench-strategy-grid">
            <div class="bench-strategy-cell" data-strategy="dense">
              <div class="bench-strategy-name">Dense</div>
              <div class="bench-strategy-count" id="bench-strat-dense">0</div>
            </div>
            <div class="bench-strategy-cell" data-strategy="pheromone">
              <div class="bench-strategy-name">Phero</div>
              <div class="bench-strategy-count" id="bench-strat-pheromone">0</div>
            </div>
            <div class="bench-strategy-cell" data-strategy="keyword">
              <div class="bench-strategy-name">Kword</div>
              <div class="bench-strategy-count" id="bench-strat-keyword">0</div>
            </div>
            <div class="bench-strategy-cell" data-strategy="hybrid">
              <div class="bench-strategy-name">Hybrid</div>
              <div class="bench-strategy-count" id="bench-strat-hybrid">0</div>
            </div>
            <div class="bench-strategy-cell" data-strategy="nim">
              <div class="bench-strategy-name">NIM</div>
              <div class="bench-strategy-count" id="bench-strat-nim">0</div>
            </div>
          </div>
        </div>

        <!-- Session Stats -->
        <div>
          <div class="bench-section-title">Session Metrics</div>
          <div class="bench-stats-grid">
            <div class="bench-stat-card">
              <div class="bench-stat-value" id="bench-stat-queries">0</div>
              <div class="bench-stat-label">Queries</div>
            </div>
            <div class="bench-stat-card">
              <div class="bench-stat-value" id="bench-stat-qnn-pct">—</div>
              <div class="bench-stat-label">QNN Win %</div>
            </div>
            <div class="bench-stat-card">
              <div class="bench-stat-value" id="bench-stat-nim-pct">—</div>
              <div class="bench-stat-label">NIM Win %</div>
            </div>
            <div class="bench-stat-card">
              <div class="bench-stat-value" id="bench-stat-latency">—</div>
              <div class="bench-stat-label">Avg Latency</div>
            </div>
          </div>
        </div>

        <!-- Benchmark Runner -->
        <div>
          <div class="bench-section-title">Benchmark Runner</div>
          <div class="bench-runner">
            <button class="bench-btn-run" id="bench-btn-run">▶ Run Benchmark</button>
            <span class="bench-run-status" id="bench-run-status">20 fixed queries · QNN + NIM</span>
          </div>
          <div class="bench-results" id="bench-results"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    _panel = panel;

    /* Wire events */
    document.getElementById('bench-btn-close').addEventListener('click', close);
    document.getElementById('bench-btn-run').addEventListener('click', _runBenchmark);
  }

  /* ── Open / Close / Toggle ───────────────────────────────────────────── */
  function open() {
    _isOpen = true;
    if (_panel) _panel.classList.add('bench-open');
    _refresh();
    _startAutoRefresh();
  }

  function close() {
    _isOpen = false;
    if (_panel) _panel.classList.remove('bench-open');
    _stopAutoRefresh();
  }

  function toggle() {
    _isOpen ? close() : open();
  }

  /* ── Hotkey ───────────────────────────────────────────────────────────── */
  function _bindHotkey() {
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggle();
      }
      if (_isOpen && e.key === 'Escape') close();
    });
  }

  /* ── Auto-refresh ────────────────────────────────────────────────────── */
  function _startAutoRefresh() {
    _stopAutoRefresh();
    _refreshTimer = setInterval(_refresh, 5000);
  }

  function _stopAutoRefresh() {
    if (_refreshTimer) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  }

  /* ── Refresh all data ────────────────────────────────────────────────── */
  async function _refresh() {
    if (!window.bucksAPI) return;

    // Fetch quality history
    try {
      const history = await window.bucksAPI.qualityHistory(20);
      if (Array.isArray(history)) {
        _drawSparkline(history);
        _updateStrategyGrid(history);
      }
    } catch (_) {}

    // Fetch session metrics
    try {
      const m = await window.bucksAPI.agentMetrics();
      if (m && !m.error) {
        _updateStats(m);
      }
    } catch (_) {}
  }

  /* ── Sparkline ───────────────────────────────────────────────────────── */
  function _drawSparkline(history) {
    const canvas = document.getElementById('bench-sparkline-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 8, right: 8, bottom: 16, left: 8 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    if (history.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data yet — submit queries to populate', w / 2, h / 2);
      return;
    }

    const scores = history.map(e => e.quality ?? 0);
    const maxPts = 20;
    const step   = plotW / (maxPts - 1);

    // Threshold line at 0.65
    const threshY = padding.top + plotH * (1 - 0.65);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 79, 106, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, threshY);
    ctx.lineTo(padding.left + plotW, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Threshold label
    ctx.fillStyle = 'rgba(255, 79, 106, 0.5)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('0.65', padding.left + plotW, threshY - 3);

    // Draw quality line
    ctx.strokeStyle = '#a06fff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    const offset = (maxPts - scores.length) * step;
    for (let i = 0; i < scores.length; i++) {
      const x = padding.left + offset + i * step;
      const y = padding.top + plotH * (1 - Math.min(1, Math.max(0, scores[i])));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw dots
    for (let i = 0; i < scores.length; i++) {
      const x = padding.left + offset + i * step;
      const y = padding.top + plotH * (1 - Math.min(1, Math.max(0, scores[i])));
      const winner = history[i].winner;
      const color = winner === 'nim' ? '#76b900' : winner === 'qnn' ? '#a06fff' : '#888';

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Y-axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('1.0', 0, padding.top + 3);
    ctx.fillText('0.0', 0, padding.top + plotH + 3);
  }

  /* ── Strategy grid ───────────────────────────────────────────────────── */
  function _updateStrategyGrid(history) {
    const counts = { dense: 0, pheromone: 0, keyword: 0, hybrid: 0, nim: 0 };
    for (const entry of history) {
      const w = entry.winner || '';
      if (w === 'nim') counts.nim++;
      else if (w === 'qnn' || w === 'offline') counts.hybrid++; // default to hybrid for QNN
    }

    const maxCount = Math.max(1, ...Object.values(counts));

    for (const [key, count] of Object.entries(counts)) {
      const el = document.getElementById(`bench-strat-${key}`);
      if (el) el.textContent = count;

      const cell = document.querySelector(`.bench-strategy-cell[data-strategy="${key}"]`);
      if (cell) {
        const intensity = count / maxCount;
        cell.style.background = `rgba(124, 92, 252, ${0.03 + intensity * 0.12})`;
        cell.style.borderColor = `rgba(124, 92, 252, ${0.08 + intensity * 0.2})`;
      }
    }
  }

  /* ── Session stats ───────────────────────────────────────────────────── */
  function _updateStats(m) {
    const queries = document.getElementById('bench-stat-queries');
    const qnnPct  = document.getElementById('bench-stat-qnn-pct');
    const nimPct  = document.getElementById('bench-stat-nim-pct');
    const latency = document.getElementById('bench-stat-latency');

    if (queries) queries.textContent = m.totalQueries || 0;

    if (qnnPct) {
      if (m.totalQueries > 0) {
        qnnPct.textContent = Math.round((m.qnnWins / m.totalQueries) * 100) + '%';
      } else {
        qnnPct.textContent = '—';
      }
    }

    if (nimPct) {
      if (m.totalQueries > 0) {
        nimPct.textContent = Math.round((m.nimWins / m.totalQueries) * 100) + '%';
      } else {
        nimPct.textContent = '—';
      }
    }

    if (latency) {
      if (m.avgLatency > 0) {
        latency.textContent = m.avgLatency > 1000
          ? `${(m.avgLatency / 1000).toFixed(1)}s`
          : `${m.avgLatency}ms`;
      } else {
        latency.textContent = '—';
      }
    }
  }

  /* ── Run benchmark ───────────────────────────────────────────────────── */
  async function _runBenchmark() {
    if (_benchRunning) return;
    if (!window.bucksAPI || !window.bucksAPI.benchmarkRun) {
      _setRunStatus('error', 'benchmarkRun API not available');
      return;
    }

    _benchRunning = true;
    const btn = document.getElementById('bench-btn-run');
    if (btn) btn.disabled = true;
    _setRunStatus('running', 'Running 20 benchmark queries…');

    try {
      const result = await window.bucksAPI.benchmarkRun();
      _benchRunning = false;
      if (btn) btn.disabled = false;

      if (result && result.error) {
        _setRunStatus('error', `Error: ${result.error}`);
      } else {
        _setRunStatus('done', 'Benchmark complete ✓');
        _showResults(result);
      }
    } catch (e) {
      _benchRunning = false;
      if (btn) btn.disabled = false;
      _setRunStatus('error', `Failed: ${e.message}`);
    }

    // Refresh data after benchmark
    _refresh();
  }

  function _setRunStatus(cls, text) {
    const el = document.getElementById('bench-run-status');
    if (!el) return;
    el.className = `bench-run-status ${cls}`;
    el.textContent = text;
  }

  function _showResults(result) {
    const el = document.getElementById('bench-results');
    if (!el) return;
    el.classList.add('visible');
    try {
      el.textContent = JSON.stringify(result, null, 2);
    } catch (_) {
      el.textContent = String(result);
    }
  }

  /* ── Init ─────────────────────────────────────────────────────────────── */
  function init() {
    _injectStyles();
    _buildDOM();
    _bindHotkey();
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  window.benchmarkPanel = { open, close, toggle };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

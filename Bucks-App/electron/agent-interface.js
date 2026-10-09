/**
 * agent-interface.js — Master A2UI Controller for Bucks Browser
 *
 * Responsibilities:
 *   1. Manages "tasks" (not just messages — tasks have stages and persist)
 *   2. Coordinates QNN and NIM in parallel (race with 0.65 quality gate)
 *   3. Emits AG-UI protocol events to the renderer via IPC push
 *   4. Manages ephemeral UI lifecycle (spawn → interact → dissolve)
 *   5. Tracks session quality metrics and quality history
 *
 * Used by: main.js  (require('./agent-interface'))
 * Events pushed to renderer via mainWindow.webContents.send('agent-event', ...)
 */

'use strict';

const { EventEmitter } = require('events');
const crypto           = require('crypto');

/* ── AG-UI Event types ─────────────────────────────────────────────────────── */
const EVT = {
  TASK_START         : 'task.start',
  TASK_THINKING      : 'task.thinking',
  TASK_TOOL_CALL     : 'task.tool_call',
  TASK_RESULT        : 'task.result',
  TASK_QUALITY_SCORE : 'task.quality_score',
  TASK_NIM_OVERRIDE  : 'task.nim_override',
  TASK_QNN_IMPROVING : 'task.qnn_improving',
  TASK_ERROR         : 'task.error',
  TASK_COMPLETE      : 'task.complete',
  NIM_STREAM_START   : 'nim.stream_start',
  NIM_STREAM_CHUNK   : 'nim.stream_chunk',
  NIM_STREAM_END     : 'nim.stream_end',
  QUALITY_UPDATE     : 'quality.update',
  SESSION_METRICS    : 'session.metrics',
};

/* ── NIM response quality scorer (Fix 3) ──────────────────────────────────────
 * Mirrors agent/evaluator.py penalty/reward logic in JS so NIM wins produce a
 * real quality score instead of null, closing the RL feedback loop.
 * Score range: 0.0 – 1.0 (same scale as the QNN RAGAS faithfulness score).
 */
const _NIM_LOW_QUALITY = [
  /\bI\s+(don't|do not|cannot|can't)\s+(know|help|answer|provide)\b/i,
  /\bI'm\s+(not\s+sure|unsure|uncertain)\b/i,
  /\bI\s+apologize\b.{0,40}\b(unable|cannot)\b/i,
  /\b(error|exception|traceback|failed)\b/i,
  /^(N\/A|None|null|\{\}|\[\])$/i,
  /\b(as\s+an\s+AI|as\s+a\s+language\s+model)\b/i,
];
const _NIM_ERROR_SIGNALS = [
  /\b(500|502|503|504)\s+(error|bad gateway|service unavailable)\b/i,
  /(ConnectionError|TimeoutError|JSONDecodeError)/,
  /\bModel\s+error\b/i,
];
const _NIM_HALLUCINATION = [
  /\b(as\s+of\s+my\s+(knowledge\s+cutoff|training\s+data))\b/i,
  /\b(I\s+made\s+up|fabricated|hallucinated)\b/i,
];

function _scoreNIMResponse(text) {
  if (!text || text.trim().length < 5) return 0.0;
  let score = 1.0;
  for (const re of _NIM_LOW_QUALITY)       { if (re.test(text)) score -= 0.25; }
  for (const re of _NIM_ERROR_SIGNALS)     { if (re.test(text)) score -= 0.40; }
  for (const re of _NIM_HALLUCINATION)     { if (re.test(text)) score -= 0.15; }
  const words = text.split(/\s+/).length;
  if (words < 10)  score -= 0.20;
  if (words > 30)  score += 0.05;
  return parseFloat(Math.max(0.0, Math.min(1.0, score)).toFixed(3));
}

/* ── AgentInterface class ──────────────────────────────────────────────────── */
class AgentInterface extends EventEmitter {
  constructor() {
    super();

    /** taskId → task state object */
    this.tasks = new Map();

    /** Session-level quality metrics */
    this.sessionMetrics = {
      totalQueries  : 0,
      qnnWins       : 0,
      nimWins       : 0,
      offlineFalls  : 0,
      avgQnnQuality : 0,
      avgLatency    : 0,
      _qnnQualSum   : 0,
      _latencySum   : 0,
      _nlast        : 0,
    };

    /** Rolling quality history for sparklines (last 20 entries) */
    this._qualityHistory = [];

    /** Minimum QNN RAGAS faithfulness for QNN to win the race */
    this.qualityThreshold = 0.65;

    /** References injected by main.js after app.whenReady() */
    this._mainWindow = null;
    this._qnnBridge  = null;
    this._callNIM    = null;
    this._loadSettings = null;
  }

  /* ── Dependency injection ─────────────────────────────────────────────── */
  init({ mainWindow, qnnBridge, callNIM, loadSettings }) {
    this._mainWindow  = mainWindow;
    this._qnnBridge   = qnnBridge;
    this._callNIM     = callNIM;
    this._loadSettings = loadSettings;
  }

  /* ── AG-UI event emitter → renderer ──────────────────────────────────── */
  emit(event, payload) {
    // EventEmitter for local listeners
    super.emit(event, payload);
    // IPC push to renderer
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('agent-event', { type: event, ...payload });
    }
  }

  /* ── Generate a task/query ID ─────────────────────────────────────────── */
  _makeId(prefix = 'task') {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  }

  /* ── Resolve NIM API key ──────────────────────────────────────────────── */
  _nimKey() {
    // NVIDIA exposes the same credential as either NGC_API_KEY (their NGC
    // naming) or NVIDIA_API_KEY. Accept both so the Electron race path uses
    // the very key the Python Soul Engine already uses.
    const envKey = process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || '';
    if (envKey) return envKey;
    try {
      const s = this._loadSettings ? this._loadSettings() : {};
      return s.nimApiKey || '';
    } catch (_) { return ''; }
  }

  /* ── Record metrics after a completed race ────────────────────────────── */
  _recordMetrics({ quality, latency_ms, winner }) {
    const m = this.sessionMetrics;
    m.totalQueries++;
    if (winner === 'qnn') m.qnnWins++;
    else if (winner === 'nim') m.nimWins++;
    else m.offlineFalls++;

    if (latency_ms) {
      m._latencySum += latency_ms;
      m.avgLatency = Math.round(m._latencySum / m.totalQueries);
    }
    if (quality !== null && quality !== undefined) {
      m._qnnQualSum += quality;
      m._nlast++;
      m.avgQnnQuality = parseFloat((m._qnnQualSum / m._nlast).toFixed(3));
    }

    // Push to quality history (cap at 20)
    this._qualityHistory.push({
      ts     : Date.now(),
      quality: quality ?? null,
      winner,
      latency_ms,
    });
    if (this._qualityHistory.length > 20) this._qualityHistory.shift();
  }

  /* ── Main entry: submit a query, run QNN + NIM in parallel ───────────── */
  async submitQuery(query, sessionId) {
    if (!query || typeof query !== 'string') throw new Error('query must be a non-empty string');

    const taskId = this._makeId('task');
    const startTs = Date.now();

    // Initialise task state
    const task = {
      taskId,
      query,
      sessionId : sessionId || null,
      status    : 'running',
      startTs,
      qnnResult : null,
      nimResult : null,
      winner    : null,
      finalResult: null,
    };
    this.tasks.set(taskId, task);

    // AG-UI: task start
    this.emit(EVT.TASK_START, { taskId, query, sessionId: task.sessionId, ts: startTs });

    // Signal "thinking" to trigger animated dot in the renderer
    this.emit(EVT.TASK_THINKING, { taskId });

    try {
      const result = await this._race(task);
      task.status     = 'complete';
      task.finalResult = result;
      this.tasks.set(taskId, task);

      this.emit(EVT.TASK_COMPLETE, { taskId, result, latency_ms: Date.now() - startTs });
      return result;
    } catch (err) {
      task.status = 'error';
      this.tasks.set(taskId, task);
      this.emit(EVT.TASK_ERROR, { taskId, error: err.message });
      throw err;
    }
  }

  /* ── Race: run QNN and NIM in parallel, pick winner by quality gate ──── */
  async _race(task) {
    const { taskId, query, sessionId } = task;
    const nimKey  = this._nimKey();
    const hasNIM  = !!nimKey;
    const hasQNN  = this._qnnBridge && this._qnnBridge.isConnected();

    // Run both concurrently — whichever returns first populates its slot,
    // but we wait for QNN specifically to apply the quality gate.
    const qnnPromise = hasQNN
      ? this._runQNN(task)
      : Promise.resolve(null);

    const nimPromise = hasNIM
      ? this._runNIM(task, nimKey)
      : Promise.resolve(null);

    // Strategy: wait for QNN first (quality is authoritative).
    // If QNN quality >= threshold → QNN wins, NIM is still running but discarded.
    // If QNN quality < threshold or QNN fails → NIM result is awaited.
    let qnnResult = null;
    let nimResult = null;

    this.emit(EVT.TASK_THINKING, { taskId });

    try {
      qnnResult = await qnnPromise;
      task.qnnResult = qnnResult;
    } catch (e) {
      console.warn('[AgentInterface] QNN race arm failed:', e.message);
    }

    const qnnQuality = qnnResult?.quality ?? null;
    const qnnPassed  = qnnQuality !== null && qnnQuality >= this.qualityThreshold;

    if (qnnPassed) {
      // QNN wins — emit quality score and return
      this.emit(EVT.TASK_QUALITY_SCORE, {
        taskId,
        qnnQuality,
        nimQuality : null,
        winner     : 'qnn',
      });
      this.emit(EVT.TASK_QNN_IMPROVING, { taskId, quality: qnnQuality });

      task.winner = 'qnn';
      this._recordMetrics({ quality: qnnQuality, latency_ms: qnnResult.latency_ms, winner: 'qnn' });

      // Notify renderer of engine winner
      this.emit(EVT.TASK_RESULT, {
        taskId,
        result  : { ...qnnResult, source: 'local', _winner: 'qnn⚡' },
        winner  : 'qnn',
      });

      return { ...qnnResult, source: 'local', _winner: 'qnn⚡' };
    }

    // QNN below threshold (or failed) — await NIM
    if (hasNIM) {
      this.emit(EVT.TASK_THINKING, { taskId });
      try {
        nimResult = await nimPromise;
        task.nimResult = nimResult;
      } catch (e) {
        console.warn('[AgentInterface] NIM race arm failed:', e.message);
      }
    }

    if (nimResult) {
      this.emit(EVT.TASK_NIM_OVERRIDE, {
        taskId,
        qnnQuality : qnnQuality ?? 0,
      });
      task.winner = 'nim';
      this._recordMetrics({ quality: qnnQuality, latency_ms: nimResult.latency_ms, winner: 'nim' });

      this.emit(EVT.TASK_RESULT, {
        taskId,
        result: { ...nimResult, source: 'nim', _winner: 'nim☁' },
        winner: 'nim',
      });

      // After NIM wins — fire evaluation asynchronously (non-blocking)
      const _nimResponse = nimResult.response;
      const _userQuery   = query;
      const _bridge      = this._qnnBridge;
      setImmediate(async () => {
        try {
          const evalResult = await _bridge.evaluate(_userQuery, _nimResponse, 'nim');
          if (evalResult && evalResult.score !== undefined) {
            _bridge.logFeedback({
              query      : _userQuery,
              response   : _nimResponse,
              source     : 'nim',
              quality    : evalResult.score,
              auto_rated : true,
              timestamp  : new Date().toISOString(),
            });
          }
        } catch (e) {
          // Non-blocking — swallow errors silently
        }
      });

      return { ...nimResult, source: 'nim', _winner: 'nim☁' };
    }

    // QNN low quality but no NIM — still return QNN (best we have)
    if (qnnResult) {
      task.winner = 'qnn';
      this._recordMetrics({ quality: qnnQuality, latency_ms: qnnResult.latency_ms, winner: 'qnn' });
      this.emit(EVT.TASK_RESULT, {
        taskId,
        result : { ...qnnResult, source: 'local', _winner: 'qnn⚡' },
        winner : 'qnn',
      });
      return { ...qnnResult, source: 'local', _winner: 'qnn⚡' };
    }

    // Complete offline fallback
    task.winner = 'offline';
    this._recordMetrics({ quality: null, latency_ms: 0, winner: 'offline' });
    const offlineResult = {
      query_id   : this._makeId('offline'),
      response   : 'Soul Engine is offline. Start the QNN swarm or configure a NIM API key.',
      citations  : [],
      quality    : 0,
      strategy   : 'offline',
      latency_ms : 0,
      source     : 'offline',
      _winner    : 'offline',
    };
    this.emit(EVT.TASK_RESULT, { taskId, result: offlineResult, winner: 'offline' });
    return offlineResult;
  }

  /* ── QNN arm ─────────────────────────────────────────────────────────── */
  async _runQNN(task) {
    const { taskId, query, sessionId } = task;
    this.emit(EVT.TASK_TOOL_CALL, { taskId, tool: 'soul_engine_qnn', args: { query, sessionId } });
    const t0 = Date.now();
    const result = await this._qnnBridge.query(query, sessionId || null);
    const elapsed = Date.now() - t0;

    // Emit quality score immediately
    this.emit(EVT.TASK_QUALITY_SCORE, {
      taskId,
      qnnQuality : result.quality ?? null,
      source     : 'qnn',
      latency_ms : elapsed,
    });

    return { ...result, latency_ms: result.latency_ms || elapsed };
  }

  /* ── NIM arm ──────────────────────────────────────────────────────────── */
  async _runNIM(task, apiKey) {
    const { taskId, query } = task;
    this.emit(EVT.TASK_TOOL_CALL, { taskId, tool: 'nim_cloud', args: { query } });
    const t0 = Date.now();

    // Stream support: emit NIM_STREAM_START, chunks, NIM_STREAM_END
    this.emit(EVT.NIM_STREAM_START, { taskId });

    const nim = await this._callNIM(query, apiKey);
    const elapsed = Date.now() - t0;

    // Simulate streaming for existing non-streaming NIM responses
    const text = nim.response || '';
    const chunkSize = 12;
    for (let i = 0; i < text.length; i += chunkSize) {
      this.emit(EVT.NIM_STREAM_CHUNK, {
        taskId,
        chunk     : text.slice(i, i + chunkSize),
        tokenCount: Math.floor(i / 4) + 1,
      });
    }
    this.emit(EVT.NIM_STREAM_END, { taskId, totalTokens: Math.ceil(text.length / 4), latency_ms: elapsed });

    // ── Fix 3: Score NIM responses so quality is never null ──────────────
    // Mirrors the penalty/reward logic in agent/evaluator.py so NIM wins
    // feed the RL feedback loop (ExperienceBuffer) with real quality signals
    // instead of a null gap that corrupts QNN training targets.
    const nimQuality = _scoreNIMResponse(text);
    this.emit(EVT.TASK_QUALITY_SCORE, {
      taskId,
      nimQuality,
      source     : 'nim',
      latency_ms : elapsed,
    });

    return {
      query_id   : this._makeId('nim'),
      response   : text,
      citations  : [],
      quality    : nimQuality,
      strategy   : 'nim',
      latency_ms : elapsed,
      model      : nim.model || 'nvidia/llama-3.1-nemotron-70b-instruct',
    };
  }

  /* ── Quality history (for benchmark panel sparklines) ─────────────────── */
  getQualityHistory(n = 20) {
    return this._qualityHistory.slice(-n);
  }

  /* ── Get session metrics ─────────────────────────────────────────────── */
  getSessionMetrics() {
    const m = this.sessionMetrics;
    return {
      totalQueries  : m.totalQueries,
      qnnWins       : m.qnnWins,
      nimWins       : m.nimWins,
      offlineFalls  : m.offlineFalls,
      avgQnnQuality : m.avgQnnQuality,
      avgLatency    : m.avgLatency,
      qnnWinRate    : m.totalQueries > 0
        ? parseFloat((m.qnnWins / m.totalQueries).toFixed(3))
        : null,
    };
  }

  /* ── Get a specific task state ───────────────────────────────────────── */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /* ── List all tasks ──────────────────────────────────────────────────── */
  listTasks() {
    return Array.from(this.tasks.values()).map((t) => ({
      taskId   : t.taskId,
      query    : t.query,
      status   : t.status,
      winner   : t.winner,
      startTs  : t.startTs,
    }));
  }

  /* ── Cleanup old completed tasks (keep last 50) ──────────────────────── */
  pruneOldTasks() {
    if (this.tasks.size <= 50) return;
    const sorted = Array.from(this.tasks.entries())
      .sort(([, a], [, b]) => a.startTs - b.startTs);
    sorted.slice(0, sorted.length - 50).forEach(([id]) => this.tasks.delete(id));
  }
}

/* ── Singleton export ────────────────────────────────────────────────────── */
const agentInterface = new AgentInterface();
module.exports = agentInterface;
module.exports.EVT = EVT;
module.exports.AgentInterface = AgentInterface;

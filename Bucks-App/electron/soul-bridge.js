/**
 * soul-bridge.js — Node.js manager for the QNN Python subprocess
 *
 * Spawns soul_bridge.py once at startup and keeps it alive. Communicates via
 * JSON-RPC 2.0 over stdin/stdout (no HTTP, no port, no socket — pure pipe).
 * Each in-flight request is tracked by id so concurrent queries work correctly.
 *
 * Interface used by main.js IPC handlers:
 *   const bridge = require('./soul-bridge');
 *   await bridge.start();           // spawn / adopt if already running
 *   const result = await bridge.query(prompt, sessionId);
 *   const status = bridge.status(); // { connected, pid, model, uptime }
 *   await bridge.shutdown();        // SIGTERM the child cleanly
 */

'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const readline  = require('readline');

// ── Config ────────────────────────────────────────────────────────────────────
// QNN_PATH env var lets users install the Soul Engine outside ~/Desktop/QNN.
// Set QNN_PATH=/path/to/qnn in the environment before launching the app.
const QNN_PATH        = process.env.QNN_PATH || path.join(require('os').homedir(), 'Desktop', 'QNN');
const QNN_BRIDGE_DIR  = QNN_PATH;
const BRIDGE_SCRIPT   = path.join(QNN_PATH, 'soul_bridge.py');
const PYTHON_BINS     = ['python3', 'python', path.join(QNN_PATH, 'venv', 'bin', 'python3')];
const RESTART_DELAY   = 3000;   // ms before auto-restart on crash
const QUERY_TIMEOUT   = 30000;  // ms per query before forced rejection
const MAX_RESTARTS    = 5;

// ── State ─────────────────────────────────────────────────────────────────────
let _child       = null;
let _rl          = null;          // readline interface on child stdout
let _connected   = false;
let _startedAt   = null;
let _pendingRpc  = new Map();     // id → { resolve, reject, timer }
let _rpcSeq      = 0;
let _restarts    = 0;
let _stopped     = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function _log(msg)  { console.log(`[SoulBridge] ${msg}`); }
function _warn(msg) { console.warn(`[SoulBridge] ${msg}`); }
function _err(msg)  { console.error(`[SoulBridge] ${msg}`); }

/** Find the first python binary that exists on PATH */
async function _findPython() {
  const { execFile } = require('child_process');
  for (const bin of PYTHON_BINS) {
    try {
      await new Promise((res, rej) =>
        execFile(bin, ['--version'], { timeout: 2000 }, (e) => e ? rej(e) : res())
      );
      return bin;
    } catch (_) { /* try next */ }
  }
  return null;
}

// ── Core: spawn the Python bridge ────────────────────────────────────────────
async function start() {
  if (_stopped) return;
  if (_child && !_child.killed) {
    _log('Already running (pid ' + _child.pid + ')');
    return;
  }

  if (!fs.existsSync(BRIDGE_SCRIPT)) {
    _warn(`soul_bridge.py not found at ${BRIDGE_SCRIPT} — local Soul Engine unavailable`);
    return;
  }

  const python = await _findPython();
  if (!python) {
    _warn('No python3 interpreter found — local Soul Engine unavailable');
    return;
  }

  _log(`Spawning ${python} ${BRIDGE_SCRIPT}`);
  _child = spawn(python, [BRIDGE_SCRIPT], {
    cwd:   QNN_BRIDGE_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env:   { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  _startedAt = Date.now();

  // ── stdout → JSON-RPC response parser ──
  _rl = readline.createInterface({ input: _child.stdout, crlfDelay: Infinity });
  _rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line.trim()); } catch (_) { return; }

    if (msg.id !== undefined && _pendingRpc.has(msg.id)) {
      const { resolve, reject, timer } = _pendingRpc.get(msg.id);
      clearTimeout(timer);
      _pendingRpc.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || String(msg.error)));
      else resolve(msg.result);
    }
  });

  // ── stderr → console passthrough ──
  _child.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) process.stderr.write(`[SoulBridge:py] ${text}\n`);
  });

  // ── connection handshake: send a ping ──
  _child.on('spawn', async () => {
    try {
      await _rpc('ping', {}, 5000);
      _connected = true;
      _restarts  = 0;
      _log('Connected (pid ' + _child.pid + ')');
    } catch (e) {
      _warn('Handshake failed: ' + e.message);
    }
  });

  // ── auto-restart on unexpected exit ──
  _child.on('close', (code) => {
    _connected = false;
    _rl?.close();
    // Reject all pending requests
    for (const [, { reject, timer }] of _pendingRpc) {
      clearTimeout(timer);
      reject(new Error('Soul Engine subprocess exited'));
    }
    _pendingRpc.clear();

    if (!_stopped && _restarts < MAX_RESTARTS) {
      _restarts++;
      _warn(`Exited (code ${code}) — restarting in ${RESTART_DELAY}ms (attempt ${_restarts}/${MAX_RESTARTS})`);
      setTimeout(() => start(), RESTART_DELAY);
    } else if (_restarts >= MAX_RESTARTS) {
      _err(`Exceeded max restart attempts (${MAX_RESTARTS}) — giving up`);
    }
  });

  _child.on('error', (e) => {
    _err('Spawn error: ' + e.message);
    _connected = false;
  });
}

// ── Low-level JSON-RPC sender ─────────────────────────────────────────────────
function _rpc(method, params, timeoutMs = QUERY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    if (!_child || _child.killed || !_child.stdin.writable) {
      return reject(new Error('Soul Engine subprocess not running'));
    }

    const id    = ++_rpcSeq;
    const timer = setTimeout(() => {
      _pendingRpc.delete(id);
      reject(new Error(`Soul Engine query timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    _pendingRpc.set(id, { resolve, reject, timer });

    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    try {
      _child.stdin.write(msg);
    } catch (e) {
      clearTimeout(timer);
      _pendingRpc.delete(id);
      reject(e);
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a query to the local Soul Engine (QNN swarm).
 * Returns: { response, citations, quality, strategy, latency, resonanceLayers }
 */
async function query(prompt, sessionId = null) {
  const t0     = Date.now();
  const result = await _rpc('query', { query: prompt, session_id: sessionId });
  result.latency = Date.now() - t0;
  return result;
}

/**
 * Score a NIM response through the local evaluator so QNN can learn from NIM wins.
 * Non-blocking callers should wrap this in setImmediate / catch errors themselves.
 */
async function evaluate(query, response, source) {
  return _rpc('evaluate', { query, response, source });
}

/**
 * Append a feedback record to the RL training log (soul_interactions.jsonl).
 */
async function logFeedback(data) {
  return _rpc('log_feedback', data);
}

/**
 * Ask the bridge to reload its model weights (e.g. after RL update).
 */
async function reload() {
  return _rpc('reload', {}, 10000);
}

/**
 * Return current bridge status without a round-trip to the process.
 */
function status() {
  return {
    connected : _connected,
    pid       : _child ? _child.pid : null,
    uptime    : _startedAt ? Math.round((Date.now() - _startedAt) / 1000) : 0,
    pendingRpc: _pendingRpc.size,
    restarts  : _restarts,
  };
}

/**
 * Check if the bridge is healthy enough to serve queries.
 * Returns true only when the process is alive and the handshake succeeded.
 */
function isConnected() {
  return _connected && _child && !_child.killed;
}

/**
 * Gracefully stop the bridge. Called by main.js on app quit.
 */
async function shutdown() {
  _stopped = true;
  if (_child && !_child.killed) {
    try { await _rpc('shutdown', {}, 2000); } catch (_) {}
    _child.kill('SIGTERM');
  }
}

module.exports = { start, query, evaluate, logFeedback, reload, status, isConnected, shutdown };

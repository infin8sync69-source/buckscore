/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   BUCKS PROJECT NEXUS — IPC Bridge                                   ║
 * ║                                                                       ║
 * ║   Main-process module that connects the Electron renderer to the      ║
 * ║   Python Soul Engine (localhost:8765) via typed IPC channels.         ║
 * ║                                                                       ║
 * ║   Registered IPC channels:                                            ║
 * ║     nexus:start-goal       — POST /agent + forward SSE to renderer    ║
 * ║     nexus:approve-action   — POST /agent/approve/{sessionId}          ║
 * ║     nexus:deny-action      — POST /agent/deny/{sessionId}             ║
 * ║     nexus:cancel-goal      — POST /agent/cancel/{sessionId}           ║
 * ║     nexus:swarm-status     — query agent-swarm.js (no HTTP round-trip)║
 * ║     nexus:list-goals       — GET /agent/goals                         ║
 * ║                                                                       ║
 * ║   Renderer events pushed via webContents.send():                      ║
 * ║     nexus:step             — every SSE event from soul engine          ║
 * ║     nexus:action-approval-required — browser action needing approval  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

'use strict';

const http  = require('http');
const https = require('https');
const { ipcMain } = require('electron');

const SOUL_ENGINE_URL = process.env.BUCKS_SOUL_URL || 'http://127.0.0.1:8765';
const REQUEST_TIMEOUT = 120_000; // 2 min for long agent tasks

// Singleton references injected by register()
let _mainWindow = null;
let _agentSwarm = null;

// Track active SSE connections: sessionId → IncomingMessage (so we can abort)
const _activeStreams = new Map();

// ---------------------------------------------------------------------------
// Registration — called once from main.js after window is created
// ---------------------------------------------------------------------------
function register(mainWindow, agentSwarm = null) {
  _mainWindow = mainWindow;
  _agentSwarm = agentSwarm;

  ipcMain.handle('nexus:start-goal',     _handleStartGoal);
  ipcMain.handle('nexus:approve-action', _handleApprove);
  ipcMain.handle('nexus:deny-action',    _handleDeny);
  ipcMain.handle('nexus:cancel-goal',    _handleCancel);
  ipcMain.handle('nexus:swarm-status',   _handleSwarmStatus);
  ipcMain.handle('nexus:list-goals',     _handleListGoals);

  console.log('[NEXUS] IPC Bridge registered — Soul Engine:', SOUL_ENGINE_URL);
}

function unregister() {
  ['nexus:start-goal','nexus:approve-action','nexus:deny-action',
   'nexus:cancel-goal','nexus:swarm-status','nexus:list-goals'].forEach((ch) =>
    ipcMain.removeHandler(ch)
  );
  // Abort all active SSE streams
  for (const [, req] of _activeStreams) {
    try { req.destroy(); } catch (_) {}
  }
  _activeStreams.clear();
}

// ---------------------------------------------------------------------------
// nexus:start-goal
// Streams agent SSE from soul_engine.py → pushes typed events to renderer
// ---------------------------------------------------------------------------
async function _handleStartGoal(_event, { prompt, context = '', agentic = true, sessionId = null }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message:    prompt,
      context:    context || '',
      agentic:    agentic,
      session_id: sessionId || undefined,
    });

    const url  = new URL('/agent', SOUL_ENGINE_URL);
    const opts = {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const proto = url.protocol === 'https:' ? https : http;
    const req   = proto.request(url, opts, (res) => {
      let registeredSessionId = sessionId;
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') {
            _activeStreams.delete(registeredSessionId);
            resolve({ ok: true, session_id: registeredSessionId });
            return;
          }

          let evt;
          try { evt = JSON.parse(raw); } catch { continue; }

          // Capture session_id on the first event
          if (evt.type === 'session' && evt.session_id) {
            registeredSessionId = evt.session_id;
            _activeStreams.set(registeredSessionId, req);
          }

          // Relay every event to the renderer
          if (_mainWindow && !_mainWindow.isDestroyed()) {
            _mainWindow.webContents.send('nexus:step', evt);
          }

          // Special handling: if this is a browser_action requiring approval,
          // also emit a dedicated approval-required event
          if (evt.type === 'browser_action' && evt.needs_approval) {
            if (_mainWindow && !_mainWindow.isDestroyed()) {
              _mainWindow.webContents.send('nexus:action-approval-required', {
                sessionId:  evt.session_id,
                actionId:   evt.action_id,
                name:       evt.name,
                args:       evt.args,
                label:      evt.label,
                toolCallId: evt.id,
              });
            }
          }
        }
      });

      res.on('end', () => {
        _activeStreams.delete(registeredSessionId);
        resolve({ ok: true, session_id: registeredSessionId });
      });

      res.on('error', (err) => {
        _activeStreams.delete(registeredSessionId);
        reject(err);
      });
    });

    req.on('error', (err) => {
      console.error('[NEXUS] start-goal error:', err.message);
      reject({ ok: false, error: err.message });
    });

    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy();
      reject({ ok: false, error: 'Request timeout' });
    });

    req.write(body);
    req.end();
  }).catch((err) => ({ ok: false, error: String(err?.message || err) }));
}

// ---------------------------------------------------------------------------
// nexus:approve-action
// ---------------------------------------------------------------------------
async function _handleApprove(_event, { sessionId, actionId }) {
  return _postJSON(`/agent/approve/${encodeURIComponent(sessionId)}`, { action_id: actionId });
}

// ---------------------------------------------------------------------------
// nexus:deny-action
// ---------------------------------------------------------------------------
async function _handleDeny(_event, { sessionId, actionId }) {
  return _postJSON(`/agent/deny/${encodeURIComponent(sessionId)}`, { action_id: actionId });
}

// ---------------------------------------------------------------------------
// nexus:cancel-goal
// ---------------------------------------------------------------------------
async function _handleCancel(_event, { sessionId }) {
  // Abort the SSE stream
  const stream = _activeStreams.get(sessionId);
  if (stream) {
    try { stream.destroy(); } catch (_) {}
    _activeStreams.delete(sessionId);
  }
  return _postJSON(`/agent/cancel/${encodeURIComponent(sessionId)}`, {});
}

// ---------------------------------------------------------------------------
// nexus:swarm-status
// ---------------------------------------------------------------------------
async function _handleSwarmStatus() {
  if (_agentSwarm && typeof _agentSwarm.getSwarmStatus === 'function') {
    return { ok: true, swarm: _agentSwarm.getSwarmStatus() };
  }
  // Fall back to HTTP if no in-process reference
  try {
    const data = await _getJSON('/api/v1/status');
    return { ok: true, swarm: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// nexus:list-goals
// ---------------------------------------------------------------------------
async function _handleListGoals() {
  return _getJSON('/agent/goals');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function _getJSON(path) {
  return new Promise((resolve, reject) => {
    const url   = new URL(path, SOUL_ENGINE_URL);
    const proto = url.protocol === 'https:' ? https : http;
    const req   = proto.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function _postJSON(path, payload) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(payload);
    const url    = new URL(path, SOUL_ENGINE_URL);
    const proto  = url.protocol === 'https:' ? https : http;
    const req    = proto.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
module.exports = { register, unregister };

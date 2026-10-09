/**
 * MCP (Model Context Protocol) Bridge — Electron side
 *
 * Manages the lifecycle of the Bucks MCP server, which exposes:
 *   • File system access (read, write, list, watch)
 *   • 30+ tools from the Bucks registry
 *   • Task orchestration and workflows
 *   • IPFS decentralized operations
 *
 * Launches on app startup alongside Soul Engine and other services.
 * MCP clients (Claude Code, other Claude instances) connect to this server.
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const HOST = '127.0.0.1';
const PORT = Number(process.env.BUCKS_MCP_PORT || 9999);

let _child = null;
let _statusCb = null;
let _lastStatus = { state: 'unknown' };
let _stopped = false;

// Crash recovery, matching bucks-node-manager.js. Without this the exit
// handler only logged "crashed" and the MCP server stayed dead until the whole
// app was restarted — every other supervised child here retries.
const MAX_AUTO_RESTARTS = 5;
const RESTART_DELAY_MS = 3_000;
let _autoRestarts = 0;

function _emit(status) {
  _lastStatus = status;
  try { if (_statusCb) _statusCb(status); } catch (_) {}
  const label = status.detail ? `${status.state} — ${status.detail}` : status.state;
  console.log(`[MCP] ${label}`);
}

/** GET a small JSON endpoint with a short timeout. Resolves null on any error. */
function _getJSON(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

async function _health() {
  return _getJSON(`http://${HOST}:${PORT}/health`);
}

/**
 * Resolve the agent directory (same logic as soul-engine-supervisor.js).
 */
function _resolveAgent() {
  const { app } = require('electron');
  const isDev = app ? !app.isPackaged : true;

  const runtimeHome = path.join(os.homedir(), '.bucks', 'agent');
  const candidates = isDev ? [
    path.join(__dirname, '..', 'agent'),
    runtimeHome,
  ] : [
    runtimeHome,
    process.resourcesPath ? path.join(process.resourcesPath, 'agent') : null,
    path.join(__dirname, '..', 'agent'),
  ];

  const filteredCandidates = candidates.filter(Boolean);

  let codeDir = null;
  for (const dir of filteredCandidates) {
    if (fs.existsSync(path.join(dir, 'mcp_server.py'))) { codeDir = dir; break; }
  }
  if (!codeDir) return null;

  // Find a usable venv
  const runtimeVenv = path.join(os.homedir(), '.bucks', 'agent', '.venv', 'bin', 'python');
  const codeVenv = path.join(codeDir, '.venv', 'bin', 'python');
  const py = fs.existsSync(codeVenv)
    ? codeVenv
    : fs.existsSync(runtimeVenv)
    ? runtimeVenv
    : path.join(codeDir, '.venv', 'bin', 'python');

  return { dir: codeDir, py };
}

function _clearPortConflict(port) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { execSync } = require('child_process');
      const raw = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (raw) {
        const pids = raw.split(/\s+/).map((p) => p.trim()).filter((p) => p && Number(p) !== process.pid);
        for (const pid of pids) {
          try { process.kill(Number(pid), 'SIGKILL'); } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

/**
 * Start (or adopt) the MCP Server.
 * @param {(s:object)=>void} onStatus  called with status updates
 */
async function start(onStatus) {
  if (_stopped) return;
  _statusCb = onStatus;

  _emit({ state: 'checking', detail: 'Checking for existing MCP server' });

  // Try to adopt an already-running server
  const existing = await _health();
  if (existing && typeof existing.version === 'string') {
    _emit({ state: 'ready', detail: `MCP server already running on :${PORT}` });
    return;
  }

  // Resolve agent directory and venv
  const agent = _resolveAgent();
  if (!agent) {
    _emit({ state: 'unavailable', detail: 'Agent directory not found' });
    return;
  }

  const { dir: agentDir, py: pythonPath } = agent;

  if (!fs.existsSync(pythonPath)) {
    _emit({ state: 'unavailable', detail: 'Python venv not found' });
    return;
  }

  // Clear any stale process on the port
  _clearPortConflict(PORT);

  // Spawn the MCP server
  _emit({ state: 'starting', detail: `Spawning MCP server (${PORT})` });

  const env = {
    ...process.env,
    BUCKS_MCP_PORT: String(PORT),
    PYTHONUNBUFFERED: '1',
  };

  _child = spawn(pythonPath, ['-m', 'uvicorn', 'mcp_server:app', '--host', HOST, '--port', String(PORT)], {
    cwd: agentDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  _child.stdout.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[MCP] ${msg}`);
  });

  _child.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.warn(`[MCP] ${msg}`);
  });

  _child.on('exit', (code) => {
    if (_stopped) return;
    console.warn(`[MCP] Process exited with code ${code}`);
    _child = null;

    if (_autoRestarts < MAX_AUTO_RESTARTS) {
      _autoRestarts++;
      _emit({
        state: 'restarting',
        detail: `Exited (${code}) — restarting in ${RESTART_DELAY_MS}ms ` +
                `(attempt ${_autoRestarts}/${MAX_AUTO_RESTARTS})`,
      });
      setTimeout(() => {
        if (!_stopped) start(_statusCb).catch((e) =>
          console.error('[MCP] Restart failed:', e.message));
      }, RESTART_DELAY_MS);
    } else {
      _emit({
        state: 'crashed',
        detail: `Crashed ${_autoRestarts} times — giving up. Restart the app.`,
      });
    }
  });

  // Poll for readiness
  const startTime = Date.now();
  const maxWaitMs = 30000; // 30 second timeout
  const pollIntervalMs = 1000;

  while (Date.now() - startTime < maxWaitMs) {
    if (_stopped) return;

    const health = await _health();
    if (health && typeof health.version === 'string') {
      // A clean start clears the crash budget, so occasional crashes spread
      // across a long session don't accumulate into a permanent give-up.
      _autoRestarts = 0;
      _emit({
        state: 'ready',
        detail: `MCP server ready (${health.tools_available} tools)`
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  _emit({ state: 'timeout', detail: 'MCP server startup timeout' });
}

/**
 * Stop the MCP Server.
 */
async function stop() {
  _stopped = true;
  if (_child) {
    console.log('[MCP] Stopping MCP server');
    _child.kill('SIGTERM');

    // Wait up to 4 seconds for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 4000));

    if (_child && !_child.killed) {
      console.log('[MCP] Force-killing MCP server');
      _child.kill('SIGKILL');
    }
  }
}

/**
 * Get current status.
 */
function getStatus() {
  return _lastStatus;
}

module.exports = { start, stop, getStatus };

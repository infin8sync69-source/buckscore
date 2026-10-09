/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  BUCKS SOUL ENGINE — SUPERVISOR                                        ║
   ║                                                                        ║
   ║  Makes the local AI a first-class part of the Bucks core: Electron    ║
   ║  now OWNS the Soul Engine lifecycle instead of expecting the user to   ║
   ║  hand-start `uvicorn soul_engine:app`. On app start it:                ║
   ║                                                                        ║
   ║    1. Adopts an already-running engine on :8765 if one answers /health ║
   ║       (dev workflow / user ran it manually) — never double-spawns.     ║
   ║    2. Otherwise spawns the bundled Python venv with NIM as the default ║
   ║       provider; the embedded local model remains switchable on demand. ║
   ║    3. Health-polls until the selected provider is ready, emitting       ║
   ║       status to the renderer (`soul-engine-status`) so the UI can show  ║
   ║       "AI warming up…" instead of silent failures.                     ║
   ║    4. Cleanly terminates the child on quit.                            ║
   ║                                                                        ║
   ║  Everything is best-effort: if Python/venv is missing the browser      ║
   ║  still runs, and the agent panel surfaces an actionable message.       ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.BUCKS_SOUL_PORT || 8765);
const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.BUCKS_MODEL || 'hermes3:latest';

let _child = null;
let _statusCb = null;          // (statusObject) => void  — pushed to renderer
let _lastStatus = { state: 'unknown' };
let _stopped = false;

function _emit(status) {
  _lastStatus = status;
  try { if (_statusCb) _statusCb(status); } catch (_) {}
  const label = status.detail ? `${status.state} — ${status.detail}` : status.state;
  console.log(`[SoulEngine] ${label}`);
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
 * Is a given /health payload genuinely OUR Soul Engine (soul_engine.py)?
 * The canonical engine reports {model, device, mode, online} and never the
 * {version, router, dist} shape of the unrelated `bucks-browser-electron`
 * agent server — which can also bind :8765. We must not adopt that one: it
 * speaks a different /agent contract than nexus-ipc-bridge expects.
 */
function _isSoulEngine(h) {
  return !!h && typeof h.mode === 'string' && h.dist === undefined && h.router === undefined;
}

/** Is an Ollama daemon reachable and does it have our model family? */
async function _ollamaReady() {
  const tags = await _getJSON(`${OLLAMA}/api/tags`, 2000);
  if (!tags || !Array.isArray(tags.models)) return false;
  const fam = OLLAMA_MODEL.split(':')[0];
  return tags.models.some((m) => (m.name || '').includes(fam));
}

/**
 * Resolve the agent directory + venv python across dev, packaged, and
 * installed layouts. Resolution order (first with soul_engine.py wins):
 *   1. ~/.bucks/agent   — stable, user-WRITABLE runtime home. Works the same
 *      whether the app runs from source or from /Applications, and a venv here
 *      survives app updates. This is the production home.
 *   2. <resources>/agent — bundled source shipped inside the .app (read-only).
 *   3. <electron>/../agent — dev checkout.
 * The venv python is looked up independently: prefer a venv co-located with the
 * chosen code dir, else fall back to ~/.bucks/agent/.venv (so a read-only
 * bundled code dir can still pair with a writable venv).
 */
function _venvPython(dir) {
  return process.platform === 'win32'
    ? path.join(dir, '.venv', 'Scripts', 'python.exe')
    : path.join(dir, '.venv', 'bin', 'python');
}

function _resolveAgent() {
  const os = require('os');
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
    if (fs.existsSync(path.join(dir, 'soul_engine.py'))) { codeDir = dir; break; }
  }
  if (!codeDir) return null;

  // Find a usable venv: co-located first, then the writable runtime home.
  for (const venvDir of [codeDir, runtimeHome]) {
    const py = _venvPython(venvDir);
    if (fs.existsSync(py)) return { dir: codeDir, py, hasVenv: true };
  }
  return { dir: codeDir, py: _venvPython(codeDir), hasVenv: false };
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
 * Start (or adopt) the Soul Engine.
 * @param {(s:object)=>void} onStatus  called with status updates for the renderer
 */
async function start(onStatus) {
  _statusCb = onStatus || null;
  _stopped = false;

  // 1. Adopt an already-running instance — but ONLY our own engine.
  const existing = await _health();
  if (existing) {
    if (_isSoulEngine(existing)) {
      _emit({ state: 'ready', adopted: true, model: existing.model, mode: existing.mode });
      _pollUntilReady();
      return;
    }
  } else {
    // Clear any stale/zombie process holding the port before spawning
    _clearPortConflict(PORT);
  }

  // 2. Locate the Python engine.
  const agent = _resolveAgent();
  if (!agent) {
    _emit({ state: 'unavailable', detail: 'agent/soul_engine.py not found' });
    return;
  }

  // Load agent/.env file if present to populate process.env
  const envPath = path.join(agent.dir, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const dotenvText = fs.readFileSync(envPath, 'utf8');
      for (const line of dotenvText.split('\n')) {
        const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = (match[2] || '').trim();
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
      }
    } catch (e) {
      console.error('Failed to load agent/.env file:', e);
    }
  }

  if (!agent.hasVenv) {
    _emit({
      state: 'unavailable',
      detail: 'Python venv missing — run agent/start_soul_engine.sh once to install it',
    });
    return;
  }

  // 3. NIM is the default live provider. Local edge/Qwen and Ollama remain
  //    explicit switchable options; do not silently replace NIM with edge.
  const definedProvider = (process.env.MODEL_PROVIDER || '').toLowerCase();
  const useOllama = definedProvider === 'ollama' && await _ollamaReady();
  if (definedProvider === 'ollama' && !useOllama) {
    _emit({ state: 'starting', detail: 'MODEL_PROVIDER=ollama set but no Ollama daemon/model found — using the inbuilt embedded engine instead' });
  }
  const provider = useOllama ? 'ollama' : (definedProvider && definedProvider !== 'ollama' ? definedProvider : 'nim');

  const env = {
    ...process.env,
    MODEL_PROVIDER: provider,
    BUCKS_PROJECT_ROOT: path.join(agent.dir, '..'),
  };
  if (useOllama) {
    env.BUCKS_MODEL = process.env.BUCKS_MODEL || OLLAMA_MODEL;
    env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || OLLAMA;
  }

  _emit({
    state: 'starting',
    provider,
    model: useOllama ? OLLAMA_MODEL : (provider === 'edge' ? 'embedded-slm' : process.env.NIM_MODEL || 'NIM'),
    detail: useOllama ? `Ollama · ${OLLAMA_MODEL}` :
      (provider === 'edge' ? 'embedded model (first run downloads weights)' : 'NIM cloud provider'),
  });

  // 4. Spawn uvicorn.
  _child = spawn(
    agent.py,
    ['-m', 'uvicorn', 'soul_engine:app', '--host', HOST, '--port', String(PORT)],
    { cwd: agent.dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  _child.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[SoulEngine:py] ${line}`);
  });
  _child.stderr.on('data', (d) => {
    const line = d.toString().trim();
    // uvicorn logs to stderr at INFO — not an error, keep it quiet-ish.
    if (line) console.log(`[SoulEngine:py] ${line}`);
  });
  _child.on('exit', (code, signal) => {
    _child = null;
    if (_stopped) return;
    _emit({ state: 'stopped', detail: `engine exited (code=${code} signal=${signal})` });
  });
  _child.on('error', (err) => {
    _emit({ state: 'error', detail: `failed to spawn engine: ${err.message}` });
  });

  _pollUntilReady();
}

/** Poll /health until the model is actually loaded (or we give up / stop). */
function _pollUntilReady(maxWaitMs = 180_000) {
  const started = Date.now();
  const tick = async () => {
    if (_stopped) return;
    const h = await _health();
    if (h && (h.mode === 'local_llm' || h.mode === 'cloud_llm')) {
      _emit({ state: 'ready', model: h.model, device: h.device, mode: h.mode });
      return;
    }
    if (h && h.mode === 'loading') {
      _emit({ state: 'loading', model: h.model, detail: 'model warming up…' });
    } else if (h && h.mode === 'no_model') {
      _emit({ state: 'error', detail: `Ollama running but model ${OLLAMA_MODEL} not pulled` });
      return;
    } else if (h && h.mode === 'unconfigured') {
      _emit({ state: 'error', detail: `${h.provider || 'cloud'} provider needs a valid API key in agent/.env or Bucks Settings` });
      return;
    }
    if (Date.now() - started > maxWaitMs) {
      _emit({ state: 'error', detail: 'engine did not become ready in time' });
      return;
    }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 1200);
}

function getStatus() {
  return _lastStatus;
}

async function stop() {
  _stopped = true;
  if (_child) {
    try { _child.kill('SIGTERM'); } catch (_) {}
    // Hard-kill after a grace period if it lingers.
    const child = _child;
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 4000);
    _child = null;
  }
}

module.exports = { start, stop, getStatus };

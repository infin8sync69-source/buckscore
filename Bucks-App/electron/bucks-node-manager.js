/**
 * bucks-node-manager.js
 * ---------------------
 * Manages the Bucks blockchain node as a child process of the Electron shell.
 *
 * Supports two node runtimes (auto-detected at startup):
 *   - bucks-go   (Bucks Core Go node  — EVM, JSON-RPC on :8192)
 *   - bucks-cpp  (Bucks Blockchain C++ — REST API on :8080)
 *
 * IPC channels (main process → renderer via bucksAPI.blockchainNode.*):
 *   bucks-node:status    (invoke) → NodeStatus object
 *   bucks-node:rpc       (invoke) → proxied JSON-RPC / REST call result
 *   bucks-node:start     (send)   → manually start node
 *   bucks-node:stop      (send)   → manually stop node
 *   bucks-node:log       (push)   → streaming log lines
 *   bucks-node:block     (push)   → new block mined / arrived
 */

'use strict';

const path        = require('path');
const fs          = require('fs');
const { spawn }   = require('child_process');
const { ipcMain } = require('electron');
const http        = require('http');

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const BIN_DIR      = path.join(__dirname, 'bin');
const GO_BINARY    = path.join(BIN_DIR, process.platform === 'win32' ? 'bucks-go.exe'  : 'bucks-go');
const CPP_BINARY   = path.join(BIN_DIR, process.platform === 'win32' ? 'bucks-cpp.exe' : 'bucks-cpp');

// The Go node exposes JSON-RPC on port 8192; C++ REST API on port 8088.
const GO_RPC_PORT  = 8192;
const CPP_API_PORT = 8088;

const HEALTH_INTERVAL_MS  = 8_000;  // health-check every 8 s
const RESTART_DELAY_MS    = 3_000;  // wait before auto-restart
const MAX_AUTO_RESTARTS   = 5;      // give up after 5 consecutive crashes

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

let nodeProcess      = null;
let nodeType         = null;   // 'go' | 'cpp' | null
let nodePort         = null;
let mainWindow       = null;
let healthTimer      = null;
let autoRestarts     = 0;
let intentionalStop  = false;

const nodeStatus = {
  running:     false,
  synced:      false,
  blockHeight: 0,
  peers:       0,
  difficulty:  '—',
  hashrate:    0,
  type:        null,
  error:       null,
};

// ────────────────────────────────────────────────────────────────────────────
// Initialisation — called from main.js after app.whenReady()
// ────────────────────────────────────────────────────────────────────────────

function init(win) {
  mainWindow = win;
  _registerIPC();

  // Detect which binary is available and start automatically.
  const goExists  = fs.existsSync(GO_BINARY);
  const cppExists = fs.existsSync(CPP_BINARY);

  if (goExists) {
    console.log('[BucksNode] Go binary found — starting Go node');
    _startGoNode();
  } else if (cppExists) {
    console.log('[BucksNode] C++ binary found — starting C++ node');
    _startCppNode();
  } else {
    console.warn('[BucksNode] No node binary found in electron/bin/. ' +
      'Build bucks-go or bucks-cpp and place it there to enable blockchain features.');
    nodeStatus.error = 'Node binary not found. Run the build scripts first.';
    _pushStatus();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Start / Stop
// ────────────────────────────────────────────────────────────────────────────

function _startGoNode() {
  nodeType = 'go';
  nodePort = GO_RPC_PORT;
  const args = [
    '--rpc',
    '--rpc-port', String(GO_RPC_PORT),
    '--datadir', path.join(require('electron').app.getPath('userData'), 'bucks-chain'),
    '--network', 'devnet',
  ];
  _spawnNode(GO_BINARY, args);
}

function _startCppNode() {
  nodeType = 'cpp';
  nodePort = CPP_API_PORT;
  const args = [
    '--server',
    '--port', String(CPP_API_PORT),
  ];
  _spawnNode(CPP_BINARY, args);
}

function _spawnNode(binary, args) {
  intentionalStop = false;
  try {
    nodeProcess = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (err) {
    console.error('[BucksNode] Failed to spawn:', err.message);
    nodeStatus.error = `Failed to launch node: ${err.message}`;
    _pushStatus();
    return;
  }

  console.log(`[BucksNode] Spawned PID ${nodeProcess.pid} (${nodeType})`);
  nodeStatus.running = true;
  nodeStatus.error   = null;
  nodeStatus.type    = nodeType;
  _pushStatus();

  // Stream stdout/stderr log lines to renderer.
  nodeProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => {
      _pushLog(line);
      _parseLogLine(line);
    });
  });
  nodeProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => _pushLog(`[stderr] ${line}`));
  });

  nodeProcess.on('exit', (code, signal) => {
    console.log(`[BucksNode] Process exited — code=${code} signal=${signal}`);
    nodeStatus.running = false;
    nodeStatus.synced  = false;
    _stopHealthCheck();

    if (!intentionalStop && autoRestarts < MAX_AUTO_RESTARTS) {
      autoRestarts++;
      console.log(`[BucksNode] Auto-restarting in ${RESTART_DELAY_MS}ms (attempt ${autoRestarts}/${MAX_AUTO_RESTARTS})`);
      setTimeout(() => _spawnNode(binary, args), RESTART_DELAY_MS);
    } else {
      nodeStatus.error = intentionalStop
        ? null
        : `Node crashed ${autoRestarts} times — giving up. Restart manually.`;
      _pushStatus();
    }
  });

  // Start health-check loop after a brief startup delay.
  setTimeout(_startHealthCheck, 3000);
}

function stop() {
  intentionalStop = true;
  _stopHealthCheck();
  if (nodeProcess && nodeProcess.exitCode === null) {
    console.log('[BucksNode] Stopping node process…');
    nodeProcess.kill('SIGTERM');
    setTimeout(() => {
      if (nodeProcess && nodeProcess.exitCode === null) nodeProcess.kill('SIGKILL');
    }, 4000);
  }
  nodeStatus.running = false;
  nodeStatus.synced  = false;
  _pushStatus();
}

// ────────────────────────────────────────────────────────────────────────────
// Health checks
// ────────────────────────────────────────────────────────────────────────────

function _startHealthCheck() {
  _stopHealthCheck();
  healthTimer = setInterval(_checkHealth, HEALTH_INTERVAL_MS);
  _checkHealth(); // immediate first check
}

function _stopHealthCheck() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

async function _checkHealth() {
  try {
    if (nodeType === 'go') {
      await _checkGoHealth();
    } else if (nodeType === 'cpp') {
      await _checkCppHealth();
    }
    autoRestarts = 0; // reset crash counter on successful health check
  } catch (err) {
    // Node not yet ready — this is normal for the first few checks.
    if (nodeStatus.synced) {
      nodeStatus.synced = false;
      _pushStatus();
    }
  }
}

function _checkGoHealth() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
    const req = http.request({
      host: '127.0.0.1', port: GO_RPC_PORT,
      path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const hex = json.result || '0x0';
          nodeStatus.blockHeight = parseInt(hex, 16);
          nodeStatus.synced  = true;
          nodeStatus.running = true;
          nodeStatus.error   = null;
          _pushStatus();
          resolve();
        } catch { reject(new Error('Invalid JSON-RPC response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function _checkCppHealth() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: CPP_API_PORT,
      path: '/api/blockchain/info', method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          nodeStatus.blockHeight = json.height    || json.block_height || 0;
          nodeStatus.peers       = json.peers      || json.peer_count  || 0;
          nodeStatus.difficulty  = json.difficulty || '—';
          nodeStatus.synced      = true;
          nodeStatus.running     = true;
          nodeStatus.error       = null;
          _pushStatus();
          resolve();
        } catch { reject(new Error('Invalid API response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Log parsing — extract structured info from stdout
// ────────────────────────────────────────────────────────────────────────────

function _parseLogLine(line) {
  // Go node (zerolog JSON): {"level":"info","height":42,"message":"New block sealed"}
  try {
    const entry = JSON.parse(line);
    if (entry.height)    nodeStatus.blockHeight = Number(entry.height);
    if (entry.peers)     nodeStatus.peers       = Number(entry.peers);
    if (entry.hashrate)  nodeStatus.hashrate    = Number(entry.hashrate);
    if (entry.message === 'New block sealed' || entry.msg === 'New block sealed') {
      _pushBlock({ height: nodeStatus.blockHeight, hash: entry.hash || '' });
    }
    return;
  } catch {}

  // C++ node text logs: "[Miner] Block #42 mined!"
  const blockMatch = line.match(/Block[# ]+(\d+)/i);
  if (blockMatch) {
    nodeStatus.blockHeight = parseInt(blockMatch[1], 10);
    _pushBlock({ height: nodeStatus.blockHeight, hash: '' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// RPC proxy — called by renderer via IPC to avoid CORS
// ────────────────────────────────────────────────────────────────────────────

async function rpcCall(method, params = []) {
  if (!nodeStatus.running) throw new Error('Node is not running');

  if (nodeType === 'go') {
    return _goRPC(method, params);
  } else {
    return _cppREST(method, params);
  }
}

function _goRPC(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() });
    const req = http.request({
      host: '127.0.0.1', port: GO_RPC_PORT,
      path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(body);
    req.end();
  });
}

function _cppREST(method, params) {
  // Map common JSON-RPC method names to C++ REST endpoints.
  const ROUTES = {
    'eth_blockNumber':         { path: '/api/blockchain/info', key: 'height' },
    'bucks_getInfo':           { path: '/api/blockchain/info' },
    'bucks_getRecentBlocks':   { path: '/api/blocks/recent' },
    'bucks_getWallets':        { path: '/api/wallets' },
    'bucks_mineBlock':         { path: '/api/mining/mine', method: 'POST' },
  };
  const route = ROUTES[method] || { path: `/api/${method.replace('_', '/')}` };
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: CPP_API_PORT,
      path: route.path,
      method: route.method || 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('REST timeout')); });
    if (params.length && route.method === 'POST') {
      const bodyStr = JSON.stringify(params[0] || {});
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', bodyStr.length);
      req.write(bodyStr);
    }
    req.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// IPC registration
// ────────────────────────────────────────────────────────────────────────────

function _registerIPC() {
  ipcMain.handle('bucks-node:status', () => ({ ...nodeStatus }));

  ipcMain.handle('bucks-node:switch-engine', (_e, engineType) => {
    return switchEngine(engineType);
  });

  ipcMain.handle('bucks-node:rpc', async (_e, { method, params }) => {
    try {
      return { ok: true, result: await rpcCall(method, params || []) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('bucks-node:start', () => {
    if (nodeStatus.running) return;
    autoRestarts = 0;
    if (nodeType === 'go') _startGoNode();
    else _startCppNode();
  });

  ipcMain.on('bucks-node:stop', () => stop());
}

// ────────────────────────────────────────────────────────────────────────────
// Push helpers
// ────────────────────────────────────────────────────────────────────────────

function _pushStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bucks-node:status-push', { ...nodeStatus });
  }
}

function _pushLog(line) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bucks-node:log', line);
  }
}

function _pushBlock(block) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bucks-node:block', block);
  }
  _pushStatus();
}

function switchEngine(targetType) {
  if (targetType !== 'go' && targetType !== 'cpp') {
    return { ok: false, error: 'Invalid engine type' };
  }
  if (nodeType === targetType && nodeStatus.running) {
    return { ok: true, message: `Engine ${targetType} is already active` };
  }

  console.log(`[BucksNode] Switching engine from ${nodeType} to ${targetType}...`);
  stop();

  setTimeout(() => {
    autoRestarts = 0;
    if (targetType === 'go') {
      _startGoNode();
    } else {
      _startCppNode();
    }
  }, 1000);

  return { ok: true, message: `Switched to ${targetType === 'cpp' ? 'v1.1.0 C++ Latest' : 'v1.0.0 Go EVM'}` };
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

module.exports = { init, stop, switchEngine, rpcCall, getStatus: () => ({ ...nodeStatus }) };

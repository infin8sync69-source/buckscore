/**
 * bucks-miner-manager.js
 * ----------------------
 * Manages the Go bucksminer binary as a child process of the Electron shell.
 *
 * IPC channels:
 *   bucks-miner:start    (invoke) { threads, walletAddress, mode, poolUrl } → { ok, error? }
 *   bucks-miner:stop     (invoke) → { ok }
 *   bucks-miner:stats    (invoke) → MinerStats
 *   bucks-miner:log      (push)   streaming log lines
 *   bucks-miner:block    (push)   { height, hash, reward } on block found
 *   bucks-miner:stats-push (push) periodic stats every STATS_INTERVAL_MS
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

const BIN_DIR       = path.join(__dirname, 'bin');
const MINER_BINARY  = path.join(BIN_DIR, process.platform === 'win32' ? 'bucks-miner.exe' : 'bucks-miner');
const MINER_API_PORT = 8194; // local HTTP status server exposed by bucksminer
const STATS_INTERVAL_MS = 2_000;

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

let minerProcess  = null;
let mainWindow    = null;
let statsTimer    = null;
let intentionalStop = false;

const minerStats = {
  running:      false,
  hashrate:     0,        // hashes/s
  hashrateUnit: 'H/s',    // 'H/s' | 'KH/s' | 'MH/s' | 'GH/s'
  sharesFound:  0,
  sharesTotal:  0,
  blocksFound:  0,
  uptimeSeconds: 0,
  startedAt:    null,
  mode:         null,     // 'solo' | 'pool'
  walletAddress: null,
  threads:      0,
  error:        null,
};

// ────────────────────────────────────────────────────────────────────────────
// Init
// ────────────────────────────────────────────────────────────────────────────

function init(win) {
  mainWindow = win;
  _registerIPC();

  if (!fs.existsSync(MINER_BINARY)) {
    console.warn('[BucksMiner] Miner binary not found at', MINER_BINARY);
    console.warn('[BucksMiner] Build it with: cd "Bucks Core/miner" && go build -o electron/bin/bucks-miner ./cmd/miner/');
    minerStats.error = 'Miner binary not found. Build bucks-miner first.';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Start / Stop
// ────────────────────────────────────────────────────────────────────────────

function startMiner({ threads = 0, walletAddress = '', mode = 'solo', poolUrl = '' } = {}) {
  if (minerProcess && minerProcess.exitCode === null) {
    return { ok: false, error: 'Miner is already running' };
  }
  if (!fs.existsSync(MINER_BINARY)) {
    return { ok: false, error: 'Miner binary not found. Build bucks-miner first.' };
  }
  if (!walletAddress) {
    return { ok: false, error: 'walletAddress is required to receive block rewards' };
  }

  intentionalStop = false;

  const args = [
    '--wallet',  walletAddress,
    '--mode',    mode,
    '--threads', String(threads || 0),
    '--api',     `127.0.0.1:${MINER_API_PORT}`,
    '--log',     'json',
  ];

  if (mode === 'pool' && poolUrl) {
    args.push('--pool', poolUrl);
  } else {
    // Solo mode: connect to the local bucks node
    args.push('--node', 'http://127.0.0.1:8192');
  }

  try {
    minerProcess = spawn(MINER_BINARY, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    minerStats.error = `Failed to launch miner: ${err.message}`;
    return { ok: false, error: minerStats.error };
  }

  // Update state
  minerStats.running      = true;
  minerStats.mode         = mode;
  minerStats.walletAddress = walletAddress;
  minerStats.threads      = threads;
  minerStats.startedAt    = Date.now();
  minerStats.blocksFound  = 0;
  minerStats.sharesFound  = 0;
  minerStats.error        = null;
  _pushStats();

  console.log(`[BucksMiner] Started PID ${minerProcess.pid} — mode=${mode} threads=${threads}`);

  // Stream log lines
  minerProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => {
      _pushLog(line);
      _parseLogLine(line);
    });
  });
  minerProcess.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach((l) => _pushLog(`[stderr] ${l}`));
  });

  minerProcess.on('exit', (code, signal) => {
    console.log(`[BucksMiner] Exited code=${code} signal=${signal}`);
    minerStats.running = false;
    if (!intentionalStop && code !== 0) {
      minerStats.error = `Miner exited unexpectedly (code ${code})`;
    }
    _stopStatsPoll();
    _pushStats();
  });

  // Start polling the miner's HTTP stats API
  setTimeout(_startStatsPoll, 2000);
  return { ok: true };
}

function stopMiner() {
  intentionalStop = true;
  _stopStatsPoll();
  if (minerProcess && minerProcess.exitCode === null) {
    minerProcess.kill('SIGTERM');
    setTimeout(() => {
      if (minerProcess && minerProcess.exitCode === null) minerProcess.kill('SIGKILL');
    }, 3000);
  }
  minerStats.running = false;
  _pushStats();
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Stats polling from miner HTTP API
// ────────────────────────────────────────────────────────────────────────────

function _startStatsPoll() {
  _stopStatsPoll();
  statsTimer = setInterval(_fetchStats, STATS_INTERVAL_MS);
  _fetchStats();
}

function _stopStatsPoll() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}

function _fetchStats() {
  const req = http.request({
    host: '127.0.0.1', port: MINER_API_PORT,
    path: '/stats', method: 'GET',
  }, (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        // Miner stats API returns: { hashrate, shares_accepted, shares_total, blocks_found, uptime_seconds }
        if (json.hashrate    !== undefined) {
          const { value, unit } = _formatHashrate(json.hashrate);
          minerStats.hashrate     = value;
          minerStats.hashrateUnit = unit;
        }
        if (json.shares_accepted !== undefined) minerStats.sharesFound  = json.shares_accepted;
        if (json.shares_total    !== undefined) minerStats.sharesTotal  = json.shares_total;
        if (json.blocks_found    !== undefined) minerStats.blocksFound  = json.blocks_found;
        if (json.uptime_seconds  !== undefined) minerStats.uptimeSeconds = json.uptime_seconds;
        _pushStats();
      } catch {}
    });
  });
  req.on('error', () => {}); // silently ignore — miner may not be ready yet
  req.setTimeout(1500, () => req.destroy());
  req.end();
}

// ────────────────────────────────────────────────────────────────────────────
// Log parsing — supplement HTTP stats with stdout events
// ────────────────────────────────────────────────────────────────────────────

function _parseLogLine(line) {
  try {
    const entry = JSON.parse(line);
    // zerolog JSON from miner.go
    if (entry.hashrate   !== undefined) {
      const { value, unit } = _formatHashrate(Number(entry.hashrate));
      minerStats.hashrate     = value;
      minerStats.hashrateUnit = unit;
    }
    if (entry.message === 'Block accepted!' || entry.msg === 'Block accepted!') {
      minerStats.blocksFound++;
      _pushBlock({
        height: entry.height || 0,
        hash:   entry.hash   || '',
        reward: 50,  // 50 BUCKS block reward (era 1)
      });
    }
    if (entry.message === 'Solution found — submitting' || entry.msg === 'Solution found — submitting') {
      minerStats.sharesFound++;
    }
    _pushStats();
  } catch {}
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function _formatHashrate(hps) {
  if (hps >= 1e9)  return { value: +(hps / 1e9).toFixed(2), unit: 'GH/s' };
  if (hps >= 1e6)  return { value: +(hps / 1e6).toFixed(2), unit: 'MH/s' };
  if (hps >= 1e3)  return { value: +(hps / 1e3).toFixed(2), unit: 'KH/s' };
  return { value: Math.round(hps), unit: 'H/s' };
}

// ────────────────────────────────────────────────────────────────────────────
// IPC registration
// ────────────────────────────────────────────────────────────────────────────

function _registerIPC() {
  ipcMain.handle('bucks-miner:start', (_e, opts) => startMiner(opts || {}));
  ipcMain.handle('bucks-miner:stop',  () => stopMiner());
  ipcMain.handle('bucks-miner:stats', () => ({ ...minerStats }));
}

// ────────────────────────────────────────────────────────────────────────────
// Push helpers
// ────────────────────────────────────────────────────────────────────────────

function _pushStats() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bucks-miner:stats-push', { ...minerStats });
  }
}

function _pushLog(line) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bucks-miner:log', line);
  }
}

function _pushBlock(block) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bucks-miner:block', block);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

module.exports = { init, stop: stopMiner, startMiner, stopMiner, getStats: () => ({ ...minerStats }) };

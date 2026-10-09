'use strict';
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const { BROWSER_ELECTRON_DIR, CLUSTER_SECRET, PLACEHOLDER_BOOTSTRAP_PEER } = require('./config');

const ELECTRON_BIN = path.join(BROWSER_ELECTRON_DIR, 'node_modules', '.bin', 'electron');
const WORKER_SCRIPT = path.join(__dirname, '..', 'worker', 'electron-worker.js');

class ElectronWorkerClient {
  constructor(userDataDir, { label = '' } = {}) {
    this.userDataDir = userDataDir;
    this.label = label;
    this._reqId = 1;
    this._pending = new Map();
    this._onMessage = null;
    this.stderr = [];
    this.child = null;
  }

  start() {
    // IMPORTANT: do NOT set ELECTRON_RUN_AS_NODE here. Under the installed
    // Electron 42.4.1, ELECTRON_RUN_AS_NODE=1 makes require('electron')
    // return the *path string* from node_modules/electron/index.js instead
    // of the real app API (process.type stays undefined, app is undefined)
    // — the opposite of what bucks browser/electron/scripts/smoke-*.js's own
    // comments claim. Verified by direct probe. Running electron normally
    // (no window ever created) gives process.type === 'browser' and a real,
    // working `app` API — that's the pattern that actually works headlessly.
    this.child = spawn(ELECTRON_BIN, [WORKER_SCRIPT, this.userDataDir], {
      cwd: BROWSER_ELECTRON_DIR,
      env: {
        ...process.env,
        BUCKS_CLUSTER_SECRET: CLUSTER_SECRET,
        BUCKS_TESTING: '1',
        // Works around the empty-list Bootstrap crash documented in config.js
        // — keeps discovery to mDNS (LAN/localhost) plus this unreachable
        // placeholder, no dependency on real public bootstrap infra.
        BUCKS_BOOTSTRAP_PEERS: PLACEHOLDER_BOOTSTRAP_PEER,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      // `.bin/electron` is a shim that spawns the real Electron binary as ITS
      // OWN child, which in turn spawns GPU/network/utility helper processes.
      // Killing only the shim's direct pid orphans that whole tree (verified:
      // it does, on macOS). `detached: true` puts the shim in its own process
      // group so we can SIGKILL the entire group by negative pid instead.
      detached: true,
    });
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on('line', (line) => this._onLine(line));
    this.child.stderr.on('data', (d) => {
      this.stderr.push(d.toString());
      if (this.stderr.length > 500) this.stderr.shift();
    });
    this._exitPromise = new Promise((resolve) => {
      this.child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    return this;
  }

  _onLine(line) {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      return; // ignore stray non-JSON stdout noise
    }
    if (msg.event === 'message' && this._onMessage) return this._onMessage(msg);
    if (msg.event === 'fatal') return; // surfaced via call() rejections / exit code instead
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error));
  }

  call(cmd, args = {}, { timeoutMs = 30000 } = {}) {
    if (!this.child || this.child.exitCode !== null) {
      return Promise.reject(new Error(`worker ${this.label} is not running`));
    }
    const id = this._reqId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`worker ${this.label} command "${cmd}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  async shutdown() {
    try {
      await this.call('shutdown', {}, { timeoutMs: 5000 });
    } catch (e) {
      // fall through to hard kill
    }
    this._killTree();
    if (this._exitPromise) await this._exitPromise;
  }

  // Best-effort: SIGKILL the whole detached process group (shim + real
  // Electron binary + its GPU/network/utility helpers), not just the shim.
  _killTree() {
    if (!this.child || this.child.exitCode !== null) return;
    try {
      process.kill(-this.child.pid, 'SIGKILL');
    } catch (e) {
      try { this.child.kill('SIGKILL'); } catch (e2) { /* already gone */ }
    }
  }

  recentStderr() {
    return this.stderr.join('');
  }
}

module.exports = { ElectronWorkerClient };

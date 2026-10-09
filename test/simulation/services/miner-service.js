'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { MINER_DIR, NODE_RPC_PORT, MINER_DASHBOARD_PORT, RUN_ROOT } = require('../lib/config');

const BIN_DIR = path.join(RUN_ROOT, 'bin');
const MINER_BIN = path.join(BIN_DIR, 'bucksminer');

function build() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  execFileSync('go', ['build', '-o', MINER_BIN, './cmd/bucksminer'], { cwd: MINER_DIR, stdio: 'pipe' });
}

class MinerService {
  constructor(minerAddress) {
    this.minerAddress = minerAddress;
    this.child = null;
    this.apiUrl = `http://127.0.0.1:${MINER_DASHBOARD_PORT}`;
  }

  async start() {
    build();
    this.child = spawn(MINER_BIN, [
      'mine',
      '--address', this.minerAddress,
      '--mode', 'solo',
      '--node', `http://127.0.0.1:${NODE_RPC_PORT}`,
      '--api-addr', `127.0.0.1:${MINER_DASHBOARD_PORT}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.stdout = '';
    this.stderr = '';
    this.child.stdout.on('data', (d) => { this.stdout += d; });
    this.child.stderr.on('data', (d) => { this.stderr += d; });
    this._exitPromise = new Promise((resolve) => this.child.on('exit', (code, signal) => resolve({ code, signal })));

    await this._waitReady();
    return this;
  }

  async _waitReady(timeoutMs = 10000) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeoutMs) {
      if (this.child.exitCode !== null) {
        throw new Error(`bucksminer exited early (code ${this.child.exitCode}). stderr:\n${this.stderr.slice(-2000)}`);
      }
      try {
        const res = await fetch(`${this.apiUrl}/api/status`);
        if (res.ok) return;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`bucksminer API did not become ready within ${timeoutMs}ms: ${lastErr}`);
  }

  async getStatus() {
    const res = await fetch(`${this.apiUrl}/api/status`);
    return res.json();
  }

  async stop() {
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      await Promise.race([this._exitPromise, new Promise((r) => setTimeout(r, 3000))]);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
  }
}

module.exports = { MinerService };

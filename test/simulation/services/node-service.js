'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { NODE_DIR, NODE_RPC_PORT, RUN_ROOT } = require('../lib/config');
const { rpcCall } = require('../lib/rpc-client');

const BIN_DIR = path.join(RUN_ROOT, 'bin');
const NODE_BIN = path.join(BIN_DIR, 'bucksnode');

function build() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  execFileSync('go', ['build', '-o', NODE_BIN, './cmd/bucksnode'], { cwd: NODE_DIR, stdio: 'pipe' });
}

class NodeService {
  constructor() {
    this.child = null;
    this.url = `http://127.0.0.1:${NODE_RPC_PORT}`;
    this.datadir = path.join(RUN_ROOT, 'node-datadir');
  }

  async start() {
    build();
    fs.mkdirSync(this.datadir, { recursive: true });
    this.child = spawn(NODE_BIN, [
      '--network', 'devnet',
      '--rpc-port', String(NODE_RPC_PORT),
      '--datadir', this.datadir,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.stdout = '';
    this.stderr = '';
    this.child.stdout.on('data', (d) => { this.stdout += d; });
    this.child.stderr.on('data', (d) => { this.stderr += d; });
    this._exitPromise = new Promise((resolve) => this.child.on('exit', (code, signal) => resolve({ code, signal })));

    await this._waitReady();
    return this;
  }

  async _waitReady(timeoutMs = 20000) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeoutMs) {
      if (this.child.exitCode !== null) {
        throw new Error(`bucksnode exited early (code ${this.child.exitCode}). stderr:\n${this.stderr.slice(-2000)}`);
      }
      try {
        await rpcCall(this.url, 'eth_chainId');
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error(`bucksnode did not become ready within ${timeoutMs}ms: ${lastErr}`);
  }

  async stop() {
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      await Promise.race([this._exitPromise, new Promise((r) => setTimeout(r, 3000))]);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
  }
}

module.exports = { NodeService };

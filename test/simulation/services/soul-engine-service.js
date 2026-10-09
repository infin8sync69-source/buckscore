'use strict';
// Runs a small SHARED pool of real soul_engine.py instances (not one per
// synthetic user). Investigation found each instance loads a full GGUF model
// in-process; this machine has 16GB RAM, so N synthetic users each getting
// their own loaded 7B (or even 1B-but-times-100) model would exhaust it.
// Real per-user isolation is still real, though: each pool instance runs
// under its own BUCKS_HOME/BUCKS_DATA_DIR/BUCKS_PORT, and every synthetic
// user still gets a genuine, independently-generated signed Soul identity
// (see lib/identity.js) — only the LLM inference capacity is pooled/shared,
// same as a small always-on inference cluster serving many client sessions.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { AGENT_DIR, SOUL_ENGINE_BASE_PORT, SOUL_ENGINE_POOL_SIZE, SOUL_ENGINE_MODEL, RUN_ROOT } = require('../lib/config');
const { SoulClient } = require('../lib/soul-http-client');

const PY = path.join(AGENT_DIR, '.venv', 'bin', 'python');

class SoulEngineInstance {
  constructor(index) {
    this.index = index;
    this.port = SOUL_ENGINE_BASE_PORT + index;
    this.home = path.join(RUN_ROOT, `soul-engine-${index}`);
    this.client = new SoulClient(`http://127.0.0.1:${this.port}`);
    this.child = null;
  }

  async start() {
    fs.mkdirSync(this.home, { recursive: true });
    this.child = spawn(PY, ['-m', 'uvicorn', 'soul_engine:app', '--host', '127.0.0.1', '--port', String(this.port)], {
      cwd: AGENT_DIR,
      env: {
        ...process.env,
        BUCKS_HOME: this.home,
        BUCKS_DATA_DIR: this.home,
        MODEL_PROVIDER: 'edge',
        SLM_MODEL: SOUL_ENGINE_MODEL,
        BUCKS_PORT: String(this.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.stdout = '';
    this.stderr = '';
    this.child.stdout.on('data', (d) => { this.stdout += d; });
    this.child.stderr.on('data', (d) => { this.stderr += d; if (this.stderr.length > 20000) this.stderr = this.stderr.slice(-20000); });
    this._exitPromise = new Promise((resolve) => this.child.on('exit', (code, signal) => resolve({ code, signal })));

    await this._waitReady();
  }

  async _waitReady(timeoutMs = 120000) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeoutMs) {
      if (this.child.exitCode !== null) {
        throw new Error(`soul_engine[${this.index}] exited early (code ${this.child.exitCode}). stderr:\n${this.stderr.slice(-3000)}`);
      }
      try {
        await this.client.health();
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`soul_engine[${this.index}] did not become ready within ${timeoutMs}ms: ${lastErr}. stderr tail:\n${this.stderr.slice(-3000)}`);
  }

  async stop() {
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      await Promise.race([this._exitPromise, new Promise((r) => setTimeout(r, 5000))]);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
  }
}

class SoulEnginePool {
  constructor(size = SOUL_ENGINE_POOL_SIZE) {
    this.size = size;
    this.instances = [];
    this._rr = 0;
  }

  async start() {
    this.instances = Array.from({ length: this.size }, (_, i) => new SoulEngineInstance(i));
    // Sequential, not parallel: concurrent llama.cpp model loads would
    // compete hard for the same RAM/disk bandwidth on a 16GB machine.
    for (const inst of this.instances) {
      await inst.start();
    }
  }

  next() {
    const inst = this.instances[this._rr % this.instances.length];
    this._rr++;
    return inst.client;
  }

  async stop() {
    await Promise.all(this.instances.map((i) => i.stop()));
  }
}

module.exports = { SoulEnginePool };

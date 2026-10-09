'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { AGENT_DIR } = require('./config');

const PY = path.join(AGENT_DIR, '.venv', 'bin', 'python');
const GEN_SCRIPT = path.join(__dirname, '..', 'py', 'gen_identity.py');

function generateSoulIdentity(bucksHome, { locality = 'global', cidn = 'bucks-sim' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, [GEN_SCRIPT, locality, cidn], {
      env: { ...process.env, BUCKS_HOME: bucksHome },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`gen_identity.py exited ${code}: ${err.trim()}`));
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        reject(new Error(`gen_identity.py produced invalid JSON: ${e.message}\nstdout: ${out}\nstderr: ${err}`));
      }
    });
  });
}

module.exports = { generateSoulIdentity };

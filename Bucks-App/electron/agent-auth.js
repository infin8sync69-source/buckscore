/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  BUCKS AGENT AUTH — shared secret for the local agent servers          ║
   ║                                                                        ║
   ║  The Soul Engine (:8765) and the MCP server (:9999) refuse any request ║
   ║  without `Authorization: Bearer <token>` (see agent/local_auth.py).    ║
   ║  Loopback is reachable from every web page on the machine, so the      ║
   ║  token — not the address — is what keeps pages out.                    ║
   ║                                                                        ║
   ║  The token lives in ~/.bucks/agent.token (0600). Both sides read the   ║
   ║  file or create it, so an engine the user started by hand and the one  ║
   ║  we spawn always agree; spawned engines also get it via env.           ║
   ║                                                                        ║
   ║  Main-process callers use authHeaders(). The shell renderer gets the   ║
   ║  token only through the `agent:auth` IPC, answered for trusted shell   ║
   ║  windows alone (web tabs have no preload and cannot ask).              ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_FILE = process.env.BUCKS_AGENT_TOKEN_FILE || path.join(os.homedir(), '.bucks', 'agent.token');
const SOUL_ENGINE_URL = process.env.BUCKS_SOUL_URL || `http://127.0.0.1:${Number(process.env.BUCKS_SOUL_PORT || 8765)}`;

let _token = null;

function _valid(token) {
  return typeof token === 'string' && token.length >= 32 && /^[\x21-\x7e]+$/.test(token);
}

function _readFile() {
  try {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    return _valid(token) ? token : null;
  } catch (_) {
    return null;
  }
}

/** The shared token: env, then the token file, else a freshly minted one. */
function getToken() {
  if (_token) return _token;
  const envToken = (process.env.BUCKS_AGENT_TOKEN || '').trim();
  if (_valid(envToken)) return (_token = envToken);

  const existing = _readFile();
  if (existing) return (_token = existing);

  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  const minted = crypto.randomBytes(32).toString('base64url');
  try {
    // 'wx' fails if an engine created the file first; read theirs back.
    fs.writeFileSync(TOKEN_FILE, minted + '\n', { flag: 'wx', mode: 0o600 });
    return (_token = minted);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const theirs = _readFile();
    if (!theirs) throw new Error(`${TOKEN_FILE} exists but does not hold a valid agent token`);
    return (_token = theirs);
  }
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

module.exports = { getToken, authHeaders, TOKEN_FILE, SOUL_ENGINE_URL };

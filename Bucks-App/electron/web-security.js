/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS WEB SECURITY — TLS errors, HTTP auth, UA, engine     ║
   ║                                                            ║
   ║  The pieces that make the embedded Chromium engine behave  ║
   ║  like a real browser at the network trust boundary:        ║
   ║                                                            ║
   ║  · certificate-error: Chromium's verdict STANDS by default ║
   ║    (the old global `ignore-certificate-errors` switch      ║
   ║    disabled TLS validation for every request — removed).   ║
   ║    A per-origin, session-scoped "proceed anyway" mirrors   ║
   ║    Chrome's interstitial behavior.                          ║
   ║  · login: HTTP Basic/Digest auth prompt (a modal window;   ║
   ║    Electron has no native credential dialog).               ║
   ║  · user agent: strip the Electron/BucksBrowser tokens so   ║
   ║    sites see a plain Chrome UA — Google and friends serve  ║
   ║    degraded or blocked pages to unknown tokens.             ║
   ╚══════════════════════════════════════════════════════════╝ */
'use strict';

const { app, dialog, session, BrowserWindow } = require('electron');

/* ── TLS certificate errors ── */

// origin -> true, cleared when the app quits (never persisted: a bad cert
// today may be an attack tomorrow — same policy as Chrome's interstitial).
const _tlsOverrides = new Set();
const _tlsPrompting = new Map(); // origin -> Promise<boolean>

function _origin(url) {
  try { return new URL(url).origin; } catch (_) { return url; }
}

async function _certPrompt(origin, error, cert) {
  if (_tlsPrompting.has(origin)) return _tlsPrompting.get(origin);
  const p = (async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Your connection is not private',
      message: `${origin} presented an invalid security certificate.`,
      detail:
        `Error: ${error}\n` +
        `Subject: ${cert && cert.subjectName || 'unknown'}\n` +
        `Issuer: ${cert && cert.issuerName || 'unknown'}\n\n` +
        'Attackers might be trying to steal your information from this site. ' +
        'Only proceed if you understand the risk. This choice lasts until Bucks quits.',
      buttons: ['Back to safety', 'Proceed anyway (unsafe)'],
      defaultId: 0,
      cancelId: 0,
    });
    return response === 1;
  })();
  _tlsPrompting.set(origin, p);
  try { return await p; } finally { _tlsPrompting.delete(origin); }
}

function setupCertificateHandling() {
  app.on('certificate-error', (event, _wc, url, error, certificate, callback) => {
    const origin = _origin(url);
    if (_tlsOverrides.has(origin)) {
      event.preventDefault();
      return callback(true);
    }
    // Default: let Chromium reject it (the tab shows the did-fail-load page).
    callback(false);
    // Ask asynchronously; on "proceed" remember the origin and reload the
    // requesting frame so the override takes effect.
    _certPrompt(origin, error, certificate).then((proceed) => {
      if (!proceed) return;
      _tlsOverrides.add(origin);
      if (_wc && !_wc.isDestroyed()) _wc.loadURL(url).catch(() => {});
    }).catch(() => {});
  });
}

/* ── HTTP Basic / Digest auth ── */

function _authPromptWindow(host, realm, parent) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 380, height: 230, parent, modal: true, show: false,
      resizable: false, minimizable: false, maximizable: false,
      title: 'Sign in',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#17171c;color:#eee;
           display:flex;flex-direction:column;padding:18px 20px;gap:10px}
      h1{font-size:14px;margin:0;font-weight:650}
      p{font-size:11.5px;color:rgba(255,255,255,.55);margin:0}
      input{padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);
            background:rgba(255,255,255,.07);color:#fff;font-size:12.5px;outline:none}
      .row{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
      button{padding:7px 16px;border-radius:8px;border:none;font-size:12.5px;font-weight:600;cursor:pointer}
      .ok{background:#ffffff;color:#fff}.no{background:rgba(255,255,255,.1);color:#ddd}
    </style></head><body>
      <h1>Sign in to ${esc(host)}</h1>
      <p>${esc(realm ? `Realm: ${realm}. ` : '')}Your credentials are sent to this site, not stored by Bucks.</p>
      <input id="u" placeholder="Username" autofocus>
      <input id="p" placeholder="Password" type="password">
      <div class="row">
        <button class="no" onclick="document.title='CANCEL'">Cancel</button>
        <button class="ok" onclick="document.title='OK:'+encodeURIComponent(document.getElementById('u').value)+':'+encodeURIComponent(document.getElementById('p').value)">Sign in</button>
      </div>
      <script>addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('.ok').click();if(e.key==='Escape')document.querySelector('.no').click()})</script>
    </body></html>`;
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); if (!win.isDestroyed()) win.close(); } };
    // The form reports back via document.title — no preload/IPC surface needed
    // in a throwaway modal, and nothing else can navigate it.
    win.webContents.on('page-title-updated', (_e, title) => {
      if (title === 'CANCEL') settle(null);
      else if (title.startsWith('OK:')) {
        const [, u, p] = title.split(':');
        settle({ username: decodeURIComponent(u || ''), password: decodeURIComponent(p || '') });
      }
    });
    win.on('closed', () => settle(null));
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => settle(null));
    win.once('ready-to-show', () => win.show());
  });
}

function setupHttpAuth() {
  app.on('login', async (event, _wc, _details, authInfo, callback) => {
    // Proxies and firstParty auth both land here; prompt for either.
    event.preventDefault();
    const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const creds = await _authPromptWindow(
      `${authInfo.host}:${authInfo.port}${authInfo.isProxy ? ' (proxy)' : ''}`,
      authInfo.realm, parent);
    if (creds) callback(creds.username, creds.password);
    else callback(); // no args = cancel → request fails with 401
  });
}

/* ── Chrome-compatible user agent ── */

function setupUserAgent() {
  // "Chrome/148.0.0.0" style: strip Electron + app tokens, zero the build
  // number like Chrome's UA reduction does. Applied per-session so every
  // tab partition (default + private) inherits it.
  const base = session.defaultSession.getUserAgent()
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\s[\w-]*bucks[\w-]*\/[\d.]+/i, '')
    .replace(/(Chrome\/\d+)\.[\d.]+/, '$1.0.0.0');
  for (const sess of [session.defaultSession, session.fromPartition('bucks-private')]) {
    sess.setUserAgent(base);
  }
  return base;
}

/* ── Spellcheck context-menu support (used by tab-manager.js) ── */

function spellcheckMenuItems(wc, params) {
  const items = [];
  if (params.misspelledWord) {
    for (const s of (params.dictionarySuggestions || []).slice(0, 5)) {
      items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    }
    if (!items.length) items.push({ label: 'No suggestions', enabled: false });
    items.push(
      { label: `Add "${params.misspelledWord}" to dictionary`,
        click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
      { type: 'separator' },
    );
  }
  return items;
}

function setupWebSecurity() {
  setupCertificateHandling();
  setupHttpAuth();
  const ua = setupUserAgent();
  console.log('[WebSecurity] TLS interstitial + HTTP auth active; UA =', ua);
}

module.exports = { setupWebSecurity, spellcheckMenuItems };

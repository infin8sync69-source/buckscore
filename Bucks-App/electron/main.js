// Chromium's network location service (behind navigator.geolocation) needs a
// Google API key to resolve Wi-Fi/cell-based positions. Optional: without it
// pages fall back to coarse methods (the built-in map uses an IP fallback).
if (process.env.BUCKS_GOOGLE_GEO_KEY && !process.env.GOOGLE_API_KEY) {
  process.env.GOOGLE_API_KEY = process.env.BUCKS_GOOGLE_GEO_KEY;
}

// Prevent EPIPE errors from crashing the Electron main process (common when stdout/stderr are redirected/closed)
if (process.stdout && typeof process.stdout.on === 'function') {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') {
      // Ignore EPIPE error
    }
  });
}
if (process.stderr && typeof process.stderr.on === 'function') {
  process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') {
      // Ignore EPIPE error
    }
  });
}

// Wrap console methods to catch synchronous EPIPE errors thrown during logging
const wrapConsole = (method) => {
  const original = console[method];
  if (typeof original === 'function') {
    console[method] = function(...args) {
      try {
        original.apply(console, args);
      } catch (err) {
        if (err && err.code === 'EPIPE') {
          // Ignore EPIPE (broken pipe) errors
        } else {
          throw err;
        }
      }
    };
  }
};
wrapConsole('log');
wrapConsole('error');
wrapConsole('warn');
wrapConsole('info');
wrapConsole('debug');

const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, protocol, shell } = require('electron');
// app.disableHardwareAcceleration();
// NOTE: never re-add `ignore-certificate-errors` — it disables TLS validation
// for EVERY request. Invalid certs now go through the per-origin interstitial
// in web-security.js (Chrome-style "proceed anyway", session-scoped).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl');
const path = require('path');
const os   = require('os');
// QNN_PATH env var lets users install the Soul Engine outside ~/Desktop/QNN.
// Set QNN_PATH=/path/to/qnn in the environment before launching the app.
const QNN_PATH = process.env.QNN_PATH || path.join(os.homedir(), 'Desktop', 'QNN');
// lazy load serve
let loadURL;

// Register IPFS protocols before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'bucks', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'ipfs', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'ipns', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);
const fs = require('fs');
const http = require('http');

// Helia / undici polyfill for File, CustomEvent, and WebCrypto
const { File } = require('buffer');
if (typeof global.File === 'undefined') {
  global.File = File;
}
if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent extends Event {
    constructor(event, params) {
      super(event, params);
      this.detail = params?.detail;
    }
  };
}
if (typeof global.crypto === 'undefined' || !global.crypto.getRandomValues) {
  global.crypto = require('crypto').webcrypto;
}

let ipfs = null; // Lazy-loaded after app is ready

/* ─── Ad-block filter list (common tracker / ad domains) ─── */
const AD_BLOCK_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.google-analytics.com/*',
  '*://*.adnxs.com/*',
  '*://*.adsrvr.org/*',
  '*://*.adform.net/*',
  '*://*.rubiconproject.com/*',
  '*://*.pubmatic.com/*',
  '*://*.openx.net/*',
  '*://*.criteo.com/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  '*://*.facebook.net/*/fbevents.js*',
  '*://*.amazon-adsystem.com/*',
  '*://*.moatads.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.quantserve.com/*',
  '*://ads.*/*',
  '*://ad.*/*',
  '*://tracking.*/*',
];

let mainWindow;
let adBlockEnabled = true;
let httpsOnlyEnabled = false;
let blockedCount = 0;

/* ─── Settings functions ─── */
let _settingsFile = null;
function getSettingsFile() {
  if (!_settingsFile) _settingsFile = path.join(app.getPath('userData'), 'settings.json');
  return _settingsFile;
}

function loadSettings() {
  let settings = {
    homepage: 'bucks://newtab',
    adBlockEnabled: true,
    httpsOnly: false,
    originAllowlist: [],
    clusterSecret: 'BUCKS_DEFAULT_CLUSTER',
    clusterCidn: 'mainnet',
    onboardingSeen: false
  };

  try {
    if (fs.existsSync(getSettingsFile())) {
      const data = fs.readFileSync(getSettingsFile(), 'utf8');
      settings = { ...settings, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  // Sanitize homepage - only allow bucks://, file://, ipfs://, ipns://, or localhost in dev
  const isValidHomepage = (url) => {
    return /^(bucks|ipfs|ipns|file):\/\//.test(url) || 
           /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);
  };
  
  if (!isValidHomepage(settings.homepage)) {
    console.warn(`[Settings] Invalid homepage "${settings.homepage}" - resetting to default`);
    settings.homepage = 'bucks://newtab';
  }

  // Apply Cluster environment variables for the IPFS node
  if (!process.env.BUCKS_CLUSTER_SECRET) process.env.BUCKS_CLUSTER_SECRET = settings.clusterSecret;
  if (!process.env.BUCKS_CLUSTER_CIDN) process.env.BUCKS_CLUSTER_CIDN = settings.clusterCidn;

  return settings;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getSettingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function isInternalOrigin(sender) {
  const url = sender.getURL();
  if (url.startsWith("file://") && (url.includes("index.html") || url.includes("bucks-browser"))) return true;
  if (url.startsWith("http://localhost:3000")) return true;
  return false;
}

/* ─── Window creation ─── */
function createWindow(settings, opts = {}) {
  const isMac = process.platform === 'darwin';
  const isPrivate = !!opts.private;

  const iconPath = path.join(__dirname, 'brand', 'dist', 'icon.png');
  if (isMac && app.dock && fs.existsSync(iconPath)) {
    try { app.dock.setIcon(iconPath); } catch (_) {}
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    frame: !isMac, // Use standard frame for Mac if we want OS buttons, or false for custom
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: isPrivate ? '#141414' : '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  // The main (non-private) window is the canonical reference used by IPC handlers.
  if (!isPrivate) mainWindow = win;

  // Release this window's WebContentsView tabs with it. (Capture the id now —
  // the BrowserWindow is already destroyed inside its 'closed' handler.)
  const tabWinId = win.id;

  // A shell reload (Cmd+R, a crash-recovery reload, devtools reload) rebuilds
  // the renderer's tab registry from an empty state, but the WebContentsViews
  // it created live in THIS process and survive. Left attached they keep
  // painting over the fresh UI, so a brand-new tab shows the previous page and
  // the dashboard never becomes visible. Release them with the document that
  // owned them.
  win.webContents.on('did-start-loading', () => {
    try { require('./tab-manager').destroyTabsForWindow(tabWinId); } catch (_) {}
  });

  win.on('closed', () => {
    try { require('./tab-manager').destroyTabsForWindow(tabWinId); } catch (_) {}
    // BUG FIX: null out the mainWindow reference so IPC handlers (window-close,
    // window-minimize, etc.) don't call methods on a destroyed BrowserWindow.
    // The guard `mainWindow &&` is truthy even for destroyed windows, so without
    // this, any IPC call after close throws an Electron "Object has been destroyed"
    // error.
    if (!isPrivate) mainWindow = null;
  });

  const fallbackDevUrl = 'http://localhost:3000';
  const homepage = settings?.homepage || 'bucks://newtab';
  const isInternalHomepage = /^(bucks|ipfs|ipns|file):\/\//.test(homepage) || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(homepage);

  // Load local index.html as the Chrome shell UI.
  // Private windows pass a #private hash so the renderer runs in incognito mode
  // (in-memory webview partition, no history persistence, private badge).
win.webContents.on("console-message", (event, level, message, line, sourceId) => { console.log(`[RENDERER] ${message} (${sourceId}:${line})`); });

  win.loadFile(path.join(__dirname, 'index.html'), isPrivate ? { hash: 'private' } : undefined).catch(err => {
    console.error('Failed to load local index.html:', err);
  });
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }

  if (!isPrivate) setupRequestFilters();

  // Prevent external window opening and route to internal tab system
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send('new-window', { url });
    return { action: 'deny' };
  });

  // Preventively block the shell frame from navigating off its allowed schemes
  // (the did-navigate handler below is reactive — it fires after load starts).
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = /^(bucks|ipfs|ipns|file):\/\//.test(url) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) ||
      url.startsWith('data:');
    if (!allowed) {
      console.warn(`[Security] Blocked shell navigation to: ${url}`);
      event.preventDefault();
    }
  });

  // Forward renderer console logs to main terminal
  win.webContents.on('console-message', (event, level, message) => {
    try { process.stdout.write('[Renderer UI] ' + message + '\n'); } catch (e) { }
  });

  // Ensure app stays on Bucks pages only
  win.webContents.on('did-navigate', (event, url) => {
    // Block navigation to external domains unless whitelisted
    if (!url.includes('localhost') && !url.includes('127.0.0.1') && !url.startsWith('data:') &&
        !/^(bucks|ipfs|ipns|file):\/\//.test(url)) {
      console.warn(`[Security] Blocking navigation to external URL: ${url}`);
      win.webContents.goBack();
    }
  });

  return win;
}

/* ─── Request Filtering (Ad-block, HTTPS Upgrade & YouTube Embed Fix) ─── */
const COMPILED_AD_PATTERNS = AD_BLOCK_PATTERNS.map(pattern => new RegExp('^' + pattern.split('*').join('.*') + '$', 'i'));

function setupRequestFilters() {
  const sessions = [
    session.defaultSession,
    session.fromPartition('bucks-private')
  ];

  for (const sess of sessions) {
    // 1. YouTube Referrer / Origin Fix for embedding (Error 153)
    sess.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
      (details, callback) => {
        if (details.resourceType !== 'mainFrame') {
          details.requestHeaders['Referer'] = 'https://www.youtube.com/';
          details.requestHeaders['Origin'] = 'https://www.youtube.com';
        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    // 2. HTTPS Upgrade & Ad-blocking
    sess.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const url = details.url;

        // 1. HTTPS Upgrade
        if (httpsOnlyEnabled && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
          return callback({ redirectURL: url.replace('http://', 'https://') });
        }

        // 2. Ad-blocking optimization (Precompiled regex)
        const isAd = COMPILED_AD_PATTERNS.some(regex => regex.test(url));

        if (adBlockEnabled && isAd) {
          blockedCount++;
          return callback({ cancel: true });
        }

        callback({});
      }
    );

    // 3. CSP for the trusted shell document only (file://.../index.html).
    // Deliberately scoped to just that one document — NOT bucks:// mini-apps
    // (several of them, e.g. bucks-calc/notes/clock/converter/qr, rely on
    // inline <script> blocks with no CSP of their own, so a shared strict
    // policy would silently kill their JS) and NOT applied session-wide:
    // WebContentsView tabs share these same sessions and must stay free to
    // render arbitrary sites under their own (or no) CSP.
    sess.webRequest.onHeadersReceived(
      { urls: ['file://*/*'] },
      (details, callback) => {
        const isShellDoc = details.resourceType === 'mainFrame' && details.url.endsWith('/index.html');
        if (!isShellDoc) return callback({ responseHeaders: details.responseHeaders });
        const csp = [
          "default-src 'self' bucks:",
          // 'unsafe-inline' here is a deliberate, verified tradeoff, not an
          // oversight: this codebase has ~95 inline onclick/onkeydown/etc.
          // handlers (renderer.js, nexus-panel.js, messages-ui.js), many
          // baked into innerHTML-inserted generative-UI cards. Empirically
          // confirmed (a controlled Electron test replicating this exact
          // policy) that WITHOUT unsafe-inline, both static and dynamically-
          // inserted inline handlers are silently blocked — "Executing
          // inline event handler violates ... script-src 'self'" — meaning
          // product cards, checklist toggles, CID-copy, and the keyboard-
          // accessibility handlers added this session were all non-functional
          // under the policy as it shipped. No 'unsafe-eval' and no remote
          // script origins are allowed, which is most of the real protection
          // this header buys; converting all inline handlers to
          // addEventListener (enabling a strict policy) is a larger future
          // refactor, not done here.
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://tileserver.memomaps.de https://*.tiles.openrailwaymap.org",
          "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://localhost:* https://nominatim.openstreetmap.org https://api.open-meteo.com https://routing.openstreetmap.de https://router.project-osrm.org https://ipapi.co https://ipwho.is https://www.google.com https://ipfs.io https://*.bucks.network https://integrate.api.nvidia.com",
          "frame-src 'self' bucks:",
          "object-src 'none'",
        ].join('; ');
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [csp],
          },
        });
      }
    );
  }
}

/* ─── Setup IPC handlers ─── */
function setupIPC() {
  // Window controls
  ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow && mainWindow.close());

  // Private (incognito) window
  ipcMain.on('open-private-window', () => {
    try {
      createWindow(loadSettings(), { private: true });
    } catch (e) {
      console.error('Failed to open private window:', e);
    }
  });

  // Downloads — open the OS downloads folder
  ipcMain.on('open-downloads-folder', () => {
    try { shell.openPath(app.getPath('downloads')); } catch (e) { console.error(e); }
  });
  ipcMain.on('show-download-in-folder', (_e, savePath) => {
    try { if (savePath) shell.showItemInFolder(savePath); } catch (e) { console.error(e); }
  });

  // ─── Durable shell storage ───
  // Chromium (≥ ~115, incl. the 148 in Electron 42) treats the file:// shell
  // as an opaque origin: its localStorage is EPHEMERAL and dies with the app.
  // Bookmarks, history, profile, contacts, and session restore all live there,
  // so preload.js hydrates localStorage from this store at boot and streams
  // snapshots back. Main keeps the authoritative copy in memory (no read/write
  // disk races) and persists it to userData/shell-storage.json.
  const _shellStoreFile = () => path.join(app.getPath('userData'), 'shell-storage.json');
  let _shellStoreCache = null;
  let _shellStoreTimer = null;
  ipcMain.on('get-app-version', (e) => {
    e.returnValue = isInternalOrigin(e.sender) ? app.getVersion() : '';
  });

  ipcMain.on('shell-storage:load', (e) => {
    if (!isInternalOrigin(e.sender)) { e.returnValue = {}; return; }
    if (!_shellStoreCache) {
      try { _shellStoreCache = JSON.parse(fs.readFileSync(_shellStoreFile(), 'utf8')) || {}; }
      catch (_) { _shellStoreCache = {}; }
    }
    e.returnValue = _shellStoreCache;
  });
  ipcMain.on('shell-storage:save', (e, snapshot) => {
    if (!isInternalOrigin(e.sender) || !snapshot || typeof snapshot !== 'object') return;
    _shellStoreCache = snapshot;
    clearTimeout(_shellStoreTimer);
    _shellStoreTimer = setTimeout(() => {
      try {
        const tmp = _shellStoreFile() + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(_shellStoreCache), 'utf8');
        fs.renameSync(tmp, _shellStoreFile());
      } catch (err) { console.error('[ShellStorage] persist failed:', err.message); }
    }, 250);
  });

  // Clear browsing data (cache, cookies, storage) — renderer clears its own history/bookmarks
  ipcMain.handle('clear-browsing-data', async (_e, opts = {}) => {
    try {
      await session.defaultSession.clearCache();
      const storages = ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'];
      await session.defaultSession.clearStorageData({ storages });
      return { ok: true };
    } catch (e) {
      console.error('Failed to clear browsing data:', e);
      return { ok: false, error: e.message };
    }
  });

  // Settings
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_e, settings) => {
    saveSettings(settings);
    adBlockEnabled = settings.adBlockEnabled;
    httpsOnlyEnabled = settings.httpsOnly;
    // Update the in-memory allowlist
    originAllowlist = settings.originAllowlist || [];
    return { ok: true };
  });

  // Ad-blocker stats
  ipcMain.handle('get-blocked-count', () => blockedCount);
  ipcMain.on('toggle-adblock', (_e, enabled) => {
    adBlockEnabled = enabled;
  });

  // Platform info
  ipcMain.handle('get-platform', () => process.platform);

  // V2: deferred to next release — wallet-reset handler
  // ipcMain.handle('wallet-reset', async () => {
  //   return require('./bucks-node').resetWallets();
  // });

  // ─── Phase 7: Security Hardening ───

  // V2: deferred to next release — wallet endpoint allowlists
  // const ALLOWED_WALLET_METHODS = ['GET', 'POST'];
  // const ALLOWED_WALLET_ENDPOINTS = [
  //   '/api/economy/status',
  //   '/api/wallets',
  //   '/api/wallets/create',
  //   '/api/wallets/restore',
  //   '/api/transactions/send',
  //   '/api/transactions/broadcast',
  //   '/api/wallets/mnemonic/generate',
  //   '/api/wallets/primary',
  //   '/api/blockchain/info',
  //   '/api/mining/mine',
  //   '/api/mining/start',
  //   '/api/mining/stop',
  //   '/api/mining/status',
  //   '/api/mining/address',
  //   '/api/wallets/sign'
  // ];

  // V2: deferred to next release — wallet address prefix routes
  // const ALLOWED_WALLET_PREFIXES = [
  //   '/api/address/'
  // ];

  let originAllowlist = loadSettings().originAllowlist || [];



  function validateOriginAccess(event) {
    const sender = event.sender;
    const origin = new URL(sender.getURL()).origin;

    // 1. Block file:// (except internal), null, and unknown origins (STRIDE: Spoofing)
    if (origin === 'null') return 'BLOCKED';
    if (origin.startsWith('file:') && !isInternalOrigin(sender)) return 'BLOCKED';

    // 2. Internal Shell is always allowed
    if (isInternalOrigin(sender)) return 'ALLOWED';

    // 3. Check User-Managed Allowlist
    if (originAllowlist.includes(origin)) return 'ALLOWED';

    // 4. Unknown Origin -> Needs Approval
    return 'PENDING_APPROVAL';
  }

  // V2: deferred to next release — validateWalletSchema (wallet request schema enforcement)
  // function validateWalletSchema(params) {
  //   if (!params || typeof params !== 'object') {
  //     console.error('[ATTACK SIGNAL] Malformed IPC: Request is not an object');
  //     return false;
  //   }
  //   const { method, endpoint, body } = params;
  //   const endpointAllowed = ALLOWED_WALLET_ENDPOINTS.includes(endpoint) ||
  //     ALLOWED_WALLET_PREFIXES.some(p => endpoint.startsWith(p));
  //   if (!ALLOWED_WALLET_METHODS.includes(method) || !endpointAllowed) {
  //     console.error(`[ATTACK SIGNAL] Invalid Endpoint/Method: ${method} ${endpoint}`);
  //     return false;
  //   }
  //   if (method === 'POST') {
  //     const bodyOptionalEndpoints = ['/api/wallets/create', '/api/mining/mine',
  //       '/api/mining/start', '/api/mining/stop'];
  //     if (body && typeof body === 'object') {
  //       const keys = Object.keys(body);
  //       const schemas = {
  //         '/api/transactions/send': ['from', 'to', 'amount'],
  //         '/api/wallets/restore': ['mnemonic'],
  //         '/api/wallets/sign': ['address', 'message'],
  //         '/api/transactions/broadcast': ['rawTx'],
  //         '/api/mining/address': ['address']
  //       };
  //       const allowedKeys = schemas[endpoint];
  //       if (allowedKeys) {
  //         const hasExtra = keys.some(k => !allowedKeys.includes(k));
  //         if (hasExtra) {
  //           console.error(`[ATTACK SIGNAL] Unauthorized keys detected in ${endpoint}: ${keys}`);
  //           return false;
  //         }
  //       }
  //     } else if (!bodyOptionalEndpoints.includes(endpoint)) {
  //       console.error(`[ATTACK SIGNAL] Missing or invalid POST body for ${endpoint}`);
  //       return false;
  //     }
  //   } else if (body) {
  //     console.error(`[ATTACK SIGNAL] Forbidden body detected in GET request to ${endpoint}`);
  //     return false;
  //   }
  //   return true;
  // }

  // V2: deferred to next release — pendingApprovals (wallet access approval flow)
  // const pendingApprovals = new Map();

  // V2: deferred to next release — wallet-rpc IPC handler
  // ipcMain.handle('wallet-rpc', async (event, params) => {
  //   const access = validateOriginAccess(event);
  //   const origin = new URL(event.sender.getURL()).origin;
  //   if (access === 'BLOCKED') {
  //     console.error(`[ATTACK SIGNAL] Blocked unauthorized origin: ${origin}`);
  //     return { error: 'Access Denied: Origin blocked by policy' };
  //   }
  //   if (access === 'PENDING_APPROVAL') {
  //     const requestId = Math.random().toString(36).substring(7);
  //     mainWindow.webContents.send('wallet-access-request', { requestId, origin });
  //     const approved = await new Promise((resolve) => {
  //       pendingApprovals.set(requestId, resolve);
  //     });
  //     if (!approved) return { error: 'User denied wallet access.' };
  //     originAllowlist.push(origin);
  //     const settings = loadSettings();
  //     settings.originAllowlist = originAllowlist;
  //     saveSettings(settings);
  //   }
  //   if (!validateWalletSchema(params)) {
  //     console.error(`[ATTACK SIGNAL] Blocked malformed wallet-rpc request: ${JSON.stringify(params)}`);
  //     return { error: 'Invalid request schema' };
  //   }
  //   const method = params.method || 'GET';
  //   const endpoint = params.endpoint;
  //   const body = params.body || null;
  //   try {
  //     return await require('./bucks-node').handleRPC(method, endpoint, body);
  //   } catch (err) {
  //     return { error: err.message };
  //   }
  // });

  /* ─── Social RPC (proxied to port 8000) ─── */
  ipcMain.handle('social-rpc', async (event, params) => {
    // Only internal shell can use social-rpc in this version
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized origin' };

    const { method = 'GET', endpoint, body = null, headers = {} } = params;
    try {
      return new Promise((resolve) => {
        const options = {
          hostname: 'localhost',
          port: 8000,
          path: endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`,
          method: method,
          headers: { ...headers, 'Content-Type': 'application/json' },
        };
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { resolve(data); }
          });
        });
        req.on('error', (err) => resolve({ error: `Social Service Offline: ${err.message}` }));
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
      });
    } catch (err) {
      return { error: err.message };
    }
  });

  // V2: deferred to next release — wallet-access-response handler
  // ipcMain.on('wallet-access-response', (_e, { requestId, approved }) => {
  //   const resolve = pendingApprovals.get(requestId);
  //   if (resolve) {
  //     resolve(approved);
  //     pendingApprovals.delete(requestId);
  //   }
  // });

  /* ─── Web Intelligence: Fetch & Search (Agent Browser) ─── */
  const https = require('https');
  const http2 = http; // reuse existing http for http urls

  function httpGet(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
          ...options.headers
        },
        timeout: 8000
      }, (res) => {
        // Follow redirects up to 3 hops
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && (options._redirects || 0) < 3) {
          const nextUrl = res.headers.location.startsWith('http') ? res.headers.location : `${parsed.origin}${res.headers.location}`;
          return resolve(httpGet(nextUrl, { ...options, _redirects: (options._redirects || 0) + 1 }));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { if (data.length < 500000) data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
  }

  // Strip HTML tags for clean text extraction
  function stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Extract meaningful text sections from HTML
  function extractPageContent(html, maxChars = 4000) {
    // Get title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Get meta description
    const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)[^>]+name=["']description["']/i);
    const description = metaMatch ? metaMatch[1].trim() : '';

    // Get paragraphs and headings
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[0] : html;

    // Extract h1-h3 and p tags content
    const headings = [...(bodyHtml.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))].map(m => stripHtml(m[1])).filter(t => t.length > 2).join('. ');
    const paragraphs = [...(bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))].map(m => stripHtml(m[1])).filter(t => t.length > 30).join(' ');

    const content = [description, headings, paragraphs].filter(Boolean).join(' ').slice(0, maxChars);
    return { title, description, content };
  }

  // IPC: General URL fetch (text/HTML content)
  ipcMain.handle('web-fetch', async (_e, { url, maxChars }) => {
    if (!isInternalOrigin(_e.sender)) return { error: 'Unauthorized' };
    try {
      const result = await httpGet(url);
      const contentType = result.headers['content-type'] || '';
      if (contentType.includes('json')) {
        try { return { ok: true, json: JSON.parse(result.body), url }; } catch (_) {}
      }
      const { title, description, content } = extractPageContent(result.body, maxChars || 4000);
      return { ok: true, title, description, content, status: result.status, url };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  });

  // Helper: DuckDuckGo HTML Search Scraper
  async function ddgSearch(query, maxResults) {
    const results = [];
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      const response = await httpGet(ddgUrl, { headers });
      const html = response.body;
      
      const resultRegex = /<a\s+class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a\s+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<span\s+class="result__snippet"[^>]*>([\s\S]*?)<\/span>)/gi;
      
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < (maxResults || 5)) {
        let link = match[1];
        const title = stripHtml(match[2]).trim();
        const snippet = stripHtml(match[3] || match[4] || '').trim();
        
        if (link.includes('uddg=')) {
          const parts = link.split('uddg=');
          if (parts[1]) {
            link = decodeURIComponent(parts[1].split('&')[0]);
          }
        }
        
        if (link.startsWith('http') && !link.includes('duckduckgo.com')) {
          results.push({
            title,
            snippet: snippet || 'Visit page for details.',
            url: link,
            source: new URL(link).hostname.replace('www.', '')
          });
        }
      }
    } catch (err) {
      console.error('[DDG Search Error]', err);
    }
    return results;
  }

  // IPC: Google search + top results fetched
  ipcMain.handle('web-search', async (_e, { query, maxResults }) => {
    if (!isInternalOrigin(_e.sender)) return { error: 'Unauthorized' };
    let results = [];
    let instant = null;
    try {
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      const response = await httpGet(googleUrl, { headers });
      const html = response.body;

      // 1. Extract organic search results
      const linkRegex = /<a\s+href="([^"]+)"[^>]*><h3[^>]*>([\s\S]*?)<\/h3>/gi;
      let match;
      const matches = [];
      while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1];
        const title = stripHtml(match[2]).trim();
        if (url.startsWith('http') && !url.includes('google.com')) {
          matches.push({ url, title });
        }
      }

      // 2. Extract snippets for matched URLs
      for (let i = 0; i < Math.min(matches.length, maxResults || 5); i++) {
        const item = matches[i];
        let snippet = '';
        const escapedUrl = item.url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const snippetRegex = new RegExp(`href="${escapedUrl}"[\\s\\S]*?<div[^>]+class="[^"]*(?:VwiC3b|yDJP4c|MUbB0c|s3xf6)[^"]*"[^>]*>([\\s\\S]*?)<\/div>`, 'i');
        const snippetMatch = snippetRegex.exec(html);
        if (snippetMatch) {
          snippet = stripHtml(snippetMatch[1]).trim();
        } else {
          const fallbackRegex = new RegExp(`href="${escapedUrl}"[\\s\\S]*?<(?:div|span)[^>]*class="[^"]*(?:VwiC3b|yDJP4c|MUbB0c|s3xf6|BNeawe)[^"]*"[^>]*>([\\s\\S]*?)<\/(?:div|span)>`, 'i');
          const fallbackMatch = fallbackRegex.exec(html);
          if (fallbackMatch) {
            snippet = stripHtml(fallbackMatch[1]).trim();
          }
        }
        results.push({
          title: item.title,
          snippet: snippet || 'Visit page for more details.',
          url: item.url,
          source: new URL(item.url).hostname.replace('www.', '')
        });
      }

      // 3. Try to extract a Quick Answer (Google featured snippet)
      const featuredRegex = /<div[^>]+class="[^"]*(?:hgKElc|zzzZ1e|LGOj8)[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
      const featuredMatch = featuredRegex.exec(html);
      if (featuredMatch && results.length > 0) {
        instant = {
          title: 'Google Quick Answer',
          snippet: stripHtml(featuredMatch[1]).trim(),
          url: results[0].url,
          source: 'Google'
        };
      }

      // 4. DuckDuckGo Fallback if < 2 results
      if (results.length < 2) {
        try {
          const ddgResults = await ddgSearch(query, maxResults || 5);
          if (ddgResults && ddgResults.length > 0) {
            results = [...results, ...ddgResults];
          }
        } catch (_) {}
      }

      // 5. Wikipedia Fallback if still < 2 results
      if (results.length < 2) {
        try {
          const wikiQuery = encodeURIComponent(query.replace(/\s+/g, '_').slice(0, 60));
          const wikiRes = await httpGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${wikiQuery}`, { headers: { Accept: 'application/json' } });
          const wiki = JSON.parse(wikiRes.body);
          if (wiki.extract && !wiki.type?.includes('disambig')) {
            results.unshift({ title: wiki.title, snippet: wiki.extract.slice(0, 400), url: wiki.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${wikiQuery}`, source: 'Wikipedia' });
          }
        } catch (_) {}
      }

      return { ok: true, query, instant, results: results.slice(0, maxResults || 5) };
    } catch (err) {
      return { ok: false, error: err.message, query, results };
    }
  });

  // IPC: Fetch a specific page and return its extracted content for agent context
  ipcMain.handle('web-fetch-summary', async (_e, { url }) => {
    if (!isInternalOrigin(_e.sender)) return { error: 'Unauthorized' };
    try {
      const result = await httpGet(url);
      const { title, description, content } = extractPageContent(result.body, 3000);
      return { ok: true, title, description, content: content.slice(0, 3000), url };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  });
}

/**
 * Service Liveness Protection
 * Checks if key backends are responsive on startup
 */
async function checkServiceLiveness() {
  // Blockchain node is now embedded (bucks-node.js) — nothing to probe.
  // Soul Engine is optional; log its state for diagnostics.
  const services = [
    { name: 'Soul Engine (Agent AI)', port: 8765, path: '/health' }
  ];

  for (const s of services) {
    const req = http.get(`http://127.0.0.1:${s.port}${s.path}`, (res) => {
      const online = res.statusCode >= 200 && res.statusCode < 300;
      console.log(`[Liveness] ${s.name} is ${online ? 'ONLINE' : `RESPONDING (HTTP ${res.statusCode})`} (Port ${s.port})`);
      res.resume();
    });
    req.on('error', () => {
      console.warn(`[Liveness] ${s.name} is OFFLINE (Port ${s.port})`);
    });
  }
}

/* ─── IPFS Social IPC Handlers ─── */
function setupIPFS() {
  ipcMain.handle('ipfs-connect', async (_e, { multiaddr }) => {
    return await ipfs.connectPeer(multiaddr);
  });

  ipcMain.handle('ipfs-info', async () => {
    return ipfs.getNodeInfo();
  });

  ipcMain.handle('ipfs-peers', async () => {
    return ipfs.getPeers();
  });

  ipcMain.handle('ipfs-publish', async (_e, { content, metadata }) => {
    return await ipfs.publishContent(content, metadata);
  });

  ipcMain.handle('get-memory-usage', async () => {
    return process.memoryUsage();
  });

  ipcMain.on('send-telemetry', (_e, { event, data }) => {
    console.log(`[Telemetry] Event: ${event}, Data:`, data);
    try {
      const fs = require('fs');
      const path = require('path');
      const { app } = require('electron');
      const logPath = path.join(app.getPath('userData'), 'telemetry.log');
      fs.appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), event, data }) + '\n');
    } catch (e) {
      console.error('Failed to write telemetry log', e);
    }
  });

  ipcMain.handle('ipfs-feed', async () => {
    return ipfs.getFeed({ clusterOnly: true });
  });

  ipcMain.handle('ipfs-feed-global', async () => {
    return ipfs.getFeed({ clusterOnly: false });
  });

  ipcMain.handle('ipfs-follow', async (_e, { peerId }) => {
    return ipfs.followPeer(peerId);
  });

  ipcMain.handle('ipfs-unfollow', async (_e, { peerId }) => {
    return ipfs.unfollowPeer(peerId);
  });

  ipcMain.handle('ipfs-upvote', async (_e, { cid }) => {
    return await ipfs.upvoteContent(cid);
  });

  /* ─── Recommend / not-recommend — a pure network signal, INDEPENDENT of
     pinning (a user can recommend without hosting, or host without
     recommending). Pinning is handled separately below. ─── */
  ipcMain.handle('cluster-vote', async (_e, { cid, direction }) => {
    if (direction === 'down') return await ipfs.unrecommendContent(cid);
    return await ipfs.recommendContent(cid);
  });

  ipcMain.handle('cluster-get-votes', async (_e, { cid }) => {
    const soul = ipfs.getLocalSoul();
    return { ...ipfs.getVoteCounts(cid), myVote: ipfs.getMyVote(cid, soul ? soul.soulId : null) };
  });

  /* ─── Pin / unpin — standalone "host this locally" toggle, no vote. ─── */
  ipcMain.handle('cluster-pin', async (_e, { cid }) => {
    return await ipfs.pinContent(cid);
  });
  ipcMain.handle('cluster-unpin', async (_e, { cid }) => {
    return await ipfs.unpinContent(cid);
  });

  ipcMain.handle('ipfs-get', async (_e, { cid }) => {
    const data = await ipfs.getContent(cid);
    return Array.from(data); // Convert Uint8Array for IPC transport
  });

  ipcMain.handle('ipfs-unpin', async (_e, { cid }) => {
    return await ipfs.unpinContent(cid);
  });

  ipcMain.handle('ipfs-storage-stats', async () => {
    return ipfs.getStorageStats();
  });

  ipcMain.handle('ipfs-publish-dweb', async (_e, { name, cid, title, desc }) => {
    return await ipfs.publishDweb(name, cid, title, desc);
  });

  ipcMain.handle('ipfs-search-dweb', async (_e, { query }) => {
    return ipfs.searchDweb(query);
  });

  /* ─── Cluster membership (invite-grown exclusive swarm) ───
     No 'cluster-admit-request' or similar handler for anyone but the LOCAL
     user to admit a peer — admission is always a direct call the renderer
     makes on the user's own explicit "Add" click (see renderer.js), never
     something driven by a remote message. */
  const clusterMembership = require('./cluster-membership');
  ipcMain.handle('cluster-my-identity', async () => clusterMembership.getMyIdentity());
  ipcMain.handle('cluster-members', async () => clusterMembership.getMembers());
  ipcMain.handle('cluster-discovered', async () => clusterMembership.getDiscovered());
  ipcMain.handle('cluster-search', async (_e, { query }) => clusterMembership.search(query));
  ipcMain.handle('cluster-admit', async (_e, { soulId, displayName }) => {
    try {
      return await clusterMembership.admitMember(soulId, { displayName });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ─── Device sync (multi-device linking for one Soul) ───
     Same pattern as cluster admission: linking is always a direct call the
     renderer makes on the user's own explicit action (after a pairing flow
     that exchanged soulIds), never driven by a remote message alone. */
  const deviceSync = require('./device-sync');
  ipcMain.handle('device-link-initiate', async (_e, { soulId }) => {
    try {
      return await deviceSync.initiateLinkDevice(soulId);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('device-linked-list', async () => deviceSync.getLinkedDevices());
  ipcMain.handle('device-link-pending', async () => deviceSync.getPendingLinks());
  ipcMain.handle('device-sync-publish', async () => {
    try {
      return await deviceSync.publishStateSnapshot();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('device-sync-pins', async () => deviceSync.getSyncedPins());

  /* ─── Cluster-native updates (replaces GitHub electron-updater) ─── */
  const clusterUpdater = require('./cluster-updater');
  ipcMain.handle('cluster-update-pending', async () => clusterUpdater.getPendingUpdate());
  ipcMain.handle('cluster-update-apply', async () => {
    try {
      return await clusterUpdater.applyPendingUpdate();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ─── P2P Encrypted Chat (Signal protocol over Gossipsub) ─── */
  const chatEngine = require('./chat-engine');
  ipcMain.handle('chat-send', (_e, { peerId, text, attachmentCid }) => chatEngine.sendMessage(peerId, text, attachmentCid || null));
  ipcMain.handle('chat-send-file', (_e, { peerId, fileData, filename }) => chatEngine.sendFile(peerId, fileData, filename));
  ipcMain.handle('chat-history', (_e, { peerId }) => chatEngine.getChatHistory(peerId));
  ipcMain.handle('chat-conversations', () => chatEngine.getConversations());
  ipcMain.handle('chat-mark-read', (_e, { peerId }) => chatEngine.markAsRead(peerId));
  ipcMain.handle('chat-own-bundle', () => chatEngine.getOwnBundle());
  ipcMain.handle('chat-process-bundle', (_e, { peerId, bundle }) => chatEngine.processPeerBundle(peerId, bundle));
  ipcMain.handle('chat-has-bundle', (_e, { peerId }) => chatEngine.hasPeerBundle(peerId));

  /* ─── Local model discovery (GGUF files in userData/models) ─── */
  ipcMain.handle('get-available-models', async () => {
    try {
      const modelsDir = path.join(app.getPath('userData'), 'models');
      if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.gguf'));
      return files.map(f => ({
        id: f,
        name: f.replace('.gguf', '').replace(/-/g, ' '),
        size: (fs.statSync(path.join(modelsDir, f)).size / 1e9).toFixed(1) + ' GB',
        downloaded: true,
        path: path.join(modelsDir, f)
      }));
    } catch (_) { return []; }
  });

  ipcMain.handle('download-model', async (_e, { url, filename }) => {
    try {
      const modelsDir = path.join(app.getPath('userData'), 'models');
      fs.mkdirSync(modelsDir, { recursive: true });
      const dest = path.join(modelsDir, path.basename(String(filename)));
      // Inform renderer — actual download should be kicked off by soul_engine.py
      return { ok: true, path: dest, note: 'Use Soul Engine /models/select to trigger download.' };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ─── File Manager state & download handlers ─── */
  ipcMain.handle('file-manager-get', async () => {
    const filePath = path.join(app.getPath('userData'), 'file-manager.json');
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('[FileManager] Failed to read file-manager.json:', e);
      return [];
    }
  });

  /* Composer attachments.
   * Attachments only become useful to the agent if the agent can actually
   * open them. Its file tools are sandboxed to BUCKS_ROOT (the repo) by
   * _safe_path, so attachments are written to a gitignored folder INSIDE that
   * root and the agent is handed a relative path. It can then read_file them
   * on demand — far better than dumping file bytes into an 8k-token prompt,
   * and it lets the agent re-read or process the file across several steps. */
  ipcMain.handle('composer-save-attachment', async (_e, { name, dataBase64 }) => {
    try {
      const repoRoot = path.resolve(__dirname, '..');
      const dir = path.join(repoRoot, '.bucks-attachments');
      fs.mkdirSync(dir, { recursive: true });

      // Sanitise: basename only, no traversal, bounded length.
      const safeName = path.basename(String(name || 'attachment'))
        .replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
      const stamped = `${Date.now()}-${safeName}`;
      const dest = path.join(dir, stamped);
      if (!path.resolve(dest).startsWith(path.resolve(dir))) {
        return { ok: false, error: 'invalid attachment path' };
      }

      fs.writeFileSync(dest, Buffer.from(String(dataBase64 || ''), 'base64'));
      return { ok: true, relPath: `.bucks-attachments/${stamped}` };
    } catch (err) {
      console.error('[Composer] attachment save failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('file-manager-save', async (_e, data) => {
    const filePath = path.join(app.getPath('userData'), 'file-manager.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { success: true };
    } catch (e) {
      console.error('[FileManager] Failed to write file-manager.json:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('file-manager-download', async (_e, { cid, name }) => {
    try {
      const dataArray = await ipfs.getContent(cid);
      const buffer = Buffer.from(dataArray);
      const { dialog } = require('electron');
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath('downloads'), name),
        title: 'Save File from IPFS'
      });
      if (filePath) {
        fs.writeFileSync(filePath, buffer);
        return { success: true, filePath };
      }
      return { success: false, canceled: true };
    } catch (e) {
      console.error('[FileManager] Download failed:', e);
      return { success: false, error: e.message };
    }
  });
}

/* ─── Protocol Handlers ─── */
function setupProtocols() {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg'
  };

  // Handle bucks:// protocol (internal app navigation)
  protocol.handle('bucks', async (request) => {
    const urlStr = request.url.replace(/^bucks:\/\//i, '').split('?')[0].split('#')[0].replace(/\/+$/, '');
    
    if (urlStr === 'newtab' || urlStr === '' || !urlStr) {
      // Redirect to home page
      if (mainWindow && mainWindow.webContents) {
        mainWindow.loadFile(path.join(__dirname, 'index.html')).catch(err => {
          console.error('[Bucks Protocol] Failed to load homepage:', err);
        });
      }
      return new Response('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/"></head></html>', {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    if (urlStr === 'studio' || urlStr === 'dweb-studio') {
      const fs = require('fs');
      try {
        const filePath = path.join(__dirname, 'dweb-studio.html');
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          return new Response(content, {
            headers: { 'Content-Type': 'text/html' }
          });
        }
      } catch (err) {
        console.error('[Bucks Protocol] Failed to load studio:', err);
      }
    }
    
    // Check if the requested urlStr corresponds to a file in __dirname
    const fileBasename = path.basename(urlStr);
    const ext = path.extname(fileBasename).toLowerCase();
    if (ext && mimeTypes[ext]) {
      const fs = require('fs');
      const filePath = path.join(__dirname, fileBasename);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath);
          return new Response(content, {
            headers: {
              'Content-Type': mimeTypes[ext] + '; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          });
        } catch (err) {
          console.error(`[Bucks Protocol] Failed to load resource ${fileBasename}:`, err);
        }
      }
    }
    
    // Built-in mini apps
    const miniApps = { 
      calc: 'bucks-calc.html', 
      notes: 'bucks-notes.html', 
      clock: 'bucks-clock.html', 
      converter: 'bucks-converter.html', 
      qr: 'bucks-qr.html', 
      universe: 'bucks-universe.html',
      studio: 'dweb-studio.html',
      portfolio: 'bucks-template-portfolio.html',
      dashboard: 'bucks-template-dashboard.html',
      store: 'bucks-template-store.html',
      blog: 'bucks-template-blog.html',
      landing: 'bucks-template-landing.html'
    };
    console.log('[Bucks Protocol] route:', urlStr);
    const appFile = miniApps[urlStr];
    if (appFile) {
      try {
        const filePath = path.join(__dirname, appFile);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          return new Response(content, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      } catch (err) {
        console.error('[Bucks Protocol] Failed to load mini app:', err);
      }
    }

    // Other bucks:// routes
    return new Response(`<!DOCTYPE html><html><body>Bucks: ${urlStr}</body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    });
  });

  protocol.handle('ipfs', async (request) => {
    try {
      let urlStr = request.url.replace(/^ipfs:\/\//i, '');
      urlStr = urlStr.split('?')[0].split('#')[0];

      const ext = path.extname(urlStr).toLowerCase();
      const mimeType = mimeTypes[ext] || 'text/html';

      if (!ipfs || !ipfs.getContent) {
        return new Response('IPFS Node is starting...', { status: 503 });
      }

      const data = await ipfs.getContent(urlStr);
      return new Response(Buffer.from(data), {
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (err) {
      console.error('[Protocol] IPFS load failed:', request.url, err);
      return new Response('Content not found on IPFS network', { status: 404 });
    }
  });

  protocol.handle('ipns', async (request) => {
    try {
      let urlStr = request.url.replace(/^ipns:\/\//i, '');
      urlStr = urlStr.split('?')[0].split('#')[0];

      const ext = path.extname(urlStr).toLowerCase();
      const mimeType = mimeTypes[ext] || 'text/html';

      if (!ipfs || !ipfs.getContent) {
        return new Response('IPFS Node is starting...', { status: 503 });
      }

      const data = await ipfs.getContent(urlStr);
      return new Response(Buffer.from(data), {
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (err) {
      console.error('[Protocol] IPNS load failed:', request.url, err);
      return new Response('Content not found on IPNS network', { status: 404 });
    }
  });
}

let ipfsServerProcess = null;

// Is something already listening on a local TCP port? Resolves quickly so we
// can skip spawning a helper that would just crash with EADDRINUSE.
function _portInUse(port) {
  return new Promise((resolve) => {
    const socket = require('net').connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

async function startIpfsServer() {
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const serverPath = path.join(__dirname, '../ipfs/server.js');
  // Skip if the file-manager proxy is already up (a prior run or a standalone
  // cluster stack) — spawning a second one would EADDRINUSE-crash on :3939.
  if (await _portInUse(3939)) {
    console.log('[App] IPFS proxy server already running on :3939 — reusing it.');
    return;
  }
  if (fs.existsSync(serverPath)) {
    console.log('[App] Starting IPFS proxy server...');
    ipfsServerProcess = spawn('node', [serverPath], {
      cwd: path.join(__dirname, '../ipfs'),
      env: { ...process.env, PORT: '3939' }
    });
    ipfsServerProcess.stdout.on('data', (data) => {
      console.log(`[IPFS Server] ${data.toString().trim()}`);
    });
    ipfsServerProcess.stderr.on('data', (data) => {
      console.error(`[IPFS Server Error] ${data.toString().trim()}`);
    });
    ipfsServerProcess.on('close', (code) => {
      console.log(`[IPFS Server] closed with code ${code}`);
    });
  } else {
    console.error(`[App] IPFS server not found at ${serverPath}`);
  }
}

/* ─── App lifecycle ─── */
/* ─── External link handling (macOS open-url; fires when Bucks is the
   default browser or a bucks:// link is clicked in another app). URLs that
   arrive before the shell window exists are queued and flushed. ─── */
const _pendingExternalUrls = [];
function _deliverExternalUrl(url) {
  const win = (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed())
    ? mainWindow
    : BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
  if (win) {
    win.webContents.send('open-external-url', { url });
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    _pendingExternalUrls.push(url);
  }
}
app.on('open-url', (event, url) => {
  event.preventDefault();
  _deliverExternalUrl(url);
});

ipcMain.handle('set-default-browser', () => {
  const ok = app.setAsDefaultProtocolClient('http') && app.setAsDefaultProtocolClient('https');
  return { ok };
});
ipcMain.handle('is-default-browser', () => ({
  http: app.isDefaultProtocolClient('http'),
  https: app.isDefaultProtocolClient('https'),
}));

app.whenReady().then(async () => {
  // Lazy-load IPFS module after app is ready
  ipfs = require('./ipfs-node');
  const agentSwarm = require('./agent-swarm');
  const soulBridge = require('./ipfs-agent-soul');
  const nexusBridge = require('./nexus-ipc-bridge');
  // ── Soul Engine supervisor: Electron owns the local-AI lifecycle now ──
  const soulEngine = require('./soul-engine-supervisor');
  const mcpBridge = require('./mcp-bridge');
  const ephemeralCommandCenter = require('./ephemeral-window');

  const settings = loadSettings();

  // ── Bucks Blockchain Node & Miner (Phase 2 & 4 integration) ─────────────
  const bucksNodeManager  = require('./bucks-node-manager');
  const bucksMinerManager = require('./bucks-miner-manager');
  try {
    bucksNodeManager.init(mainWindow);
    bucksMinerManager.init(mainWindow);
  } catch (e) {
    console.error('[App] Bucks node/miner init failed:', e.message);
  }

  setupProtocols();

  setupIPC();
  // Tab hosting: WebContentsView-backed tabs (see tab-manager.js).
  require('./tab-manager').setupTabIPC();

  // Agent document output: create_document / create_pdf (doc-factory.js).
  require('./doc-factory').setupDocFactoryIPC();
  // Web permissions (geolocation, camera/mic, notifications, …) + Bluetooth.
  require('./permission-manager').setupPermissions();
  // Network trust boundary: TLS interstitial, HTTP auth dialog, Chrome UA.
  require('./web-security').setupWebSecurity();
  // Chrome extensions: unpacked folders under ~/.bucks/extensions.
  require('./extension-loader').loadUserExtensions();
  setupIPFS();

  // ─── App Store IPC ────────────────────────────────────────────────────────
  const appRunner = require('./app-runner');
  const { BUCKS_APPS } = require('./app-store-data');

  ipcMain.handle('app-store-get-apps', async () => {
    const installed = appRunner.getInstalled();
    return BUCKS_APPS.map(app => ({
      ...app,
      installed: !!installed[app.id]
    }));
  });

  ipcMain.handle('app-store-launch-web', async (event, { appId }) => {
    const app = BUCKS_APPS.find(a => a.id === appId);
    if (!app) return { success: false, error: 'App not found' };
    return appRunner.launchWeb(mainWindow, app);
  });

  ipcMain.handle('app-store-install', async (event, { appId }) => {
    const app = BUCKS_APPS.find(a => a.id === appId);
    if (!app) return { success: false, error: 'App not found' };
    return appRunner.installLocal(appId, app.repo, event);
  });

  ipcMain.handle('app-store-launch-local', async (event, { appId }) => {
    const app = BUCKS_APPS.find(a => a.id === appId);
    if (!app) return { success: false, error: 'App not found' };
    return appRunner.launchLocal(mainWindow, app);
  });

  ipcMain.handle('app-store-uninstall', async (event, { appId }) => {
    return appRunner.uninstall(appId);
  });

  ipcMain.handle('app-store-close', async () => {
    appRunner.closeAppView(mainWindow);
    return { success: true };
  });
  // ─────────────────────────────────────────────────────────────────────────

  startIpfsServer();
  createWindow(settings);

  // Flush any external URLs that arrived before the shell was ready.
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        while (_pendingExternalUrls.length) _deliverExternalUrl(_pendingExternalUrls.shift());
      }, 1500);
    });
  }

  ephemeralCommandCenter.createEphemeralWindow(mainWindow);
  ephemeralCommandCenter.setupEphemeralShortcuts();
  ephemeralCommandCenter.setupEphemeralIPC(mainWindow);

  app.on('will-quit', () => {
    ephemeralCommandCenter.cleanupEphemeralShortcuts();
  });

  // Register NEXUS bridge now that mainWindow exists
  nexusBridge.register(mainWindow, agentSwarm);

  // Bring the local AI up as part of core startup. Pushes status to the
  // renderer so the agent UI can show "warming up / ready / unavailable"
  // instead of the old silent "/health OFFLINE" failure.
  soulEngine.start((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('soul-engine-status', status);
    }
  }).catch((e) => console.error('[App] Soul Engine supervisor error:', e.message));
  ipcMain.handle('soul-engine-status', () => soulEngine.getStatus());

  // ─── MCP (Model Context Protocol) Server for Claude Code Integration ──────
  // Exposes Bucks tools and file system access as MCP-compliant capabilities.
  // Starts alongside Soul Engine on port 9999 (configurable via BUCKS_MCP_PORT).
  mcpBridge.start((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mcp-status', status);
    }
  }).catch((e) => console.error('[App] MCP server error:', e.message));
  ipcMain.handle('mcp-status', () => mcpBridge.getStatus());

  // ─── Soul Engine QNN Swarm IPC ───────────────────────────────────────────
  // soul-bridge.js manages the persistent Python subprocess (soul_bridge.py)
  // that keeps BGE-M3 + FAISS + pheromone swarm hot in memory.
  const qnnBridge = require('./soul-bridge');
  qnnBridge.start().catch((e) =>
    console.warn('[App] QNN bridge start failed (non-fatal):', e.message)
  );

  // Helper: call NVIDIA NIM API as cloud fallback
  async function _callNIM(query, apiKey) {
    const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const NIM_MODEL = process.env.NIM_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: null }));
    const fetcher = fetch || require('https');
    const body = JSON.stringify({
      model: NIM_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are the Soul Engine, an intelligent assistant embedded inside Bucks — a privacy-first, decentralised browser built on IPFS and peer-to-peer technology. \n\nYou run alongside a local neural search system powered by a proprietary neural architecture trained on an ancient corpus of human wisdom (114 resonance layers, 6,236 resonance units). Together, you form a dual-engine intelligence: the local system handles deep semantic retrieval, you handle reasoning, synthesis, and generation.\n\nBucks users value: privacy, data sovereignty, open-source tools, decentralisation, and self-hosting. When answering questions about tools or architecture, favour self-hosted and open-source options. Be direct, substantive, and technically precise. Never mention the names of underlying AI models or training infrastructure.`,
        },
        { role: 'user', content: query },
      ],
      max_tokens: 3000,
      temperature: 0.5,
    });
    return new Promise((resolve, reject) => {
      const url = new URL(NIM_URL);
      const req = require('https').request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.message?.content || '';
            resolve({ response: text, model: NIM_MODEL });
          } catch (e) { reject(new Error('NIM parse error: ' + e.message)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * soul-query — Primary entry point for all Soul Engine queries.
   * Chain: local QNN → NIM cloud → offline fallback.
   * Payload in:  { query: string, sessionId?: string }
   * Payload out: { query_id, response, citations, quality, strategy, latency_ms,
   *               source: 'local'|'nim'|'offline' }
   */
  ipcMain.handle('soul-query', async (event, { query, sessionId }) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    if (!query || typeof query !== 'string') return { error: 'query must be a non-empty string' };

    // 1. Try local QNN bridge
    if (qnnBridge.isConnected()) {
      try {
        const result = await qnnBridge.query(query, sessionId || null);
        if (result && (result.quality === null || result.quality === undefined || result.quality > 0.15)) {
          return { ...result, source: 'local' };
        }
        console.log('[SoulQuery] Local quality too low (' + result.quality + ') — falling back to NIM');
      } catch (e) {
        console.warn('[SoulQuery] Local bridge error:', e.message);
      }
    }

    // 2. NIM cloud fallback
    const nimKey = process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || (() => {
      try {
        const settings = loadSettings();
        return settings.nimApiKey || '';
      } catch (_) { return ''; }
    })();

    if (nimKey) {
      try {
        const nim = await _callNIM(query, nimKey);
        return {
          query_id  : `nim-${Date.now()}`,
          response  : nim.response,
          citations : [],
          quality   : null,
          strategy  : 'nim',
          latency_ms: 0,
          source    : 'nim',
          model     : nim.model,
        };
      } catch (e) {
        console.warn('[SoulQuery] NIM error:', e.message);
      }
    }

    // 3. Offline fallback
    return {
      query_id  : `offline-${Date.now()}`,
      response  : 'Soul Engine is offline. Start the QNN swarm or configure a NIM API key in Settings.',
      citations : [],
      quality   : 0,
      strategy  : 'offline',
      latency_ms: 0,
      source    : 'offline',
    };
  });

  /**
   * soul-status — Lightweight health check for the status bar.
   * Returns: { local: bool, nim: bool, activeModel: string, bridgeStatus: object }
   */
  ipcMain.handle('soul-status', async (event) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    const nimKey = process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || '';
    const bridgeSt = qnnBridge.status();
    let activeModel = 'offline';
    if (bridgeSt.connected) activeModel = 'local-qnn';
    else if (nimKey) activeModel = 'nim-cloud';
    return {
      local       : bridgeSt.connected,
      nim         : !!nimKey,
      activeModel,
      bridgeStatus: bridgeSt,
      soulEngine  : soulEngine.getStatus(),
    };
  });

  /**
   * soul-log-feedback — Record user rating to close the RL loop.
   * Payload: { queryId: string, rating: 1|-1, correction?: string }
   * Appends the rating to soul_interactions.jsonl in the QNN directory.
   */
  ipcMain.handle('soul-log-feedback', async (event, { queryId, rating, correction }) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    try {
      const logPath = path.join(QNN_PATH, 'soul_interactions.jsonl');
      const entry = JSON.stringify({
        query_id   : queryId,
        rating     : rating,        // 1 = thumbs up, -1 = thumbs down
        correction : correction || null,
        feedback_ts: new Date().toISOString(),
      }) + '\n';
      fs.appendFileSync(logPath, entry, 'utf8');

      // If rating is very negative, nudge the bridge to re-load updated weights
      if (rating === -1) {
        qnnBridge.reload().catch(() => {});
      }

      return { ok: true };
    } catch (e) {
      console.error('[SoulFeedback] Failed to log:', e.message);
      return { ok: false, error: e.message };
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Agentic Interface IPC handlers (agent-interface.js) ─────────────────

  // Initialise AgentInterface singleton with main-process references
  const agentInterface = require('./agent-interface');
  agentInterface.init({
    mainWindow,
    qnnBridge,
    callNIM   : _callNIM,
    loadSettings,
  });

  /**
   * agent-submit — AG-UI entry point. Runs QNN + NIM in parallel (race mode).
   * Quality gate at 0.65 — QNN wins if it passes, else NIM overrides silently.
   * Emits 'agent-event' push events throughout the lifecycle.
   *
   * Payload in:  { query: string, sessionId?: string }
   * Payload out: { query_id, response, citations, quality, strategy,
   *               latency_ms, source, _winner }
   */
  ipcMain.handle('agent-submit', async (event, { query, sessionId }) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    if (!query || typeof query !== 'string') return { error: 'query must be a non-empty string' };
    try {
      const result = await agentInterface.submitQuery(query, sessionId || null);
      agentInterface.pruneOldTasks();
      return result;
    } catch (err) {
      console.error('[agent-submit] Error:', err.message);
      return { error: err.message };
    }
  });

  /**
   * quality-history — Return rolling quality history (last N entries).
   * Used by benchmark-panel.js sparklines and refresh polling.
   *
   * Payload in:  { n?: number }   (default 20)
   * Payload out: Array<{ ts, quality, winner, latency_ms }>
   */
  ipcMain.handle('quality-history', async (event, { n } = {}) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    return agentInterface.getQualityHistory(n || 20);
  });

  /**
   * agent-metrics — Return session-level metrics from AgentInterface.
   *
   * Payload out: { totalQueries, qnnWins, nimWins, offlineFalls,
   *               avgQnnQuality, avgLatency, qnnWinRate }
   */
  ipcMain.handle('agent-metrics', async (event) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    return agentInterface.getSessionMetrics();
  });

  /**
   * benchmark-run — Spawns soul_benchmark.py and returns the JSON summary.
   * benchmark-panel.js calls this when the user hits "Run Benchmark".
   *
   * Payload in:  { nimKey?: string }
   * Payload out: benchmark JSON summary (or { error })
   */
  ipcMain.handle('benchmark-run', async (event, { nimKey } = {}) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    const { spawn }  = require('child_process');
    const scriptPath = path.join(QNN_PATH, 'soul_benchmark.py');
    const outputPath = path.join(QNN_PATH, 'benchmark_results.json');
    const key        = nimKey || process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || '';

    return new Promise((resolve) => {
      const args = ['--output', outputPath, '--parallel'];
      if (key) args.push('--nim-key', key);

      const child = spawn('python3', [scriptPath, ...args], {
        env: { ...process.env, NVIDIA_API_KEY: key },
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        try {
          const summary = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
          resolve(summary);
        } catch (_) {
          resolve({ error: `Benchmark exited with code ${code}`, stderr });
        }
      });

      child.on('error', (err) => {
        resolve({ error: err.message });
      });
    });
  });

  /**
   * ephemeral-context — Lightweight semantic look-up for ephemeral overlays
   * (selection insight, URL preview, etc.). Routes through QNN if available,
   * falls back to NIM or a minimal offline response.
   *
   * Payload in:  { text: string, type?: string }
   * Payload out: { summary, citations?, quality? }
   */
  ipcMain.handle('ephemeral-context', async (event, { text, type } = {}) => {
    if (!isInternalOrigin(event.sender)) return { error: 'Unauthorized' };
    if (!text) return { summary: '' };
    try {
      const prompt = type === 'url'
        ? `Briefly summarise this URL or resource in 2–3 sentences: ${text}`
        : `Explain briefly (2–3 sentences) the significance of: ${text}`;

      if (qnnBridge.isConnected()) {
        const r = await qnnBridge.query(prompt, null);
        return { summary: r.response || '', citations: r.citations, quality: r.quality };
      }

      // NIM fallback
      const key = process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || loadSettings().nimApiKey || '';
      if (key) {
        const r = await _callNIM(prompt, key);
        return { summary: r.response || '' };
      }

      return { summary: 'Soul Engine is offline.' };
    } catch (err) {
      return { summary: '', error: err.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────

  // ─── Phase 1.8: Context Menus ───
  app.on('web-contents-created', (event, contents) => {
    // Lock down any <webview> tag the shell attaches (the file manager panel
    // is the only current user, pointed at a fixed localhost src) so a future
    // injected/compromised guest page can't request nodeIntegration, disable
    // sandboxing, or swap in its own preload.
    contents.on('will-attach-webview', (_event, webPreferences, params) => {
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      delete webPreferences.preload;
      delete webPreferences.preloadURL;
      params.allowpopups = false;
    });

    contents.on('context-menu', (event, params) => {
      const { selectionText, isEditable, mediaType, linkURL, srcURL } = params;
      const menu = new Menu();
      const isMainWindow = (mainWindow && contents === mainWindow.webContents);

      if (isEditable) {
        menu.append(new MenuItem({ role: 'undo' }));
        menu.append(new MenuItem({ role: 'redo' }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ role: 'cut' }));
        menu.append(new MenuItem({ role: 'copy' }));
        menu.append(new MenuItem({ role: 'paste' }));
        menu.append(new MenuItem({ role: 'selectAll' }));
      } else if (selectionText && selectionText.trim() !== '') {
        menu.append(new MenuItem({ role: 'copy' }));
        if (isMainWindow) {
          menu.append(new MenuItem({ type: 'separator' }));
          menu.append(new MenuItem({ label: 'Ask Agent for Context', click: () => { mainWindow.webContents.send('ask-agent-context', { text: selectionText }); } }));
          menu.append(new MenuItem({ label: 'Save Results', click: () => { mainWindow.webContents.send('save-agent-results', { text: selectionText }); } }));
        }
        menu.append(new MenuItem({ type: 'separator' }));
      }

      if (linkURL) {
        menu.append(new MenuItem({ label: 'Copy Link Address', click: () => { require('electron').clipboard.writeText(linkURL); } }));
        if (isMainWindow) {
          menu.append(new MenuItem({ label: 'Open Link in New Tab', click: () => { mainWindow.webContents.send('new-window', { url: linkURL }); } }));
          menu.append(new MenuItem({ label: 'Open Link in Split Pane', click: () => { mainWindow.webContents.send('open-in-pane', { url: linkURL }); } }));
        }
      }

      if (mediaType === 'image') {
        menu.append(new MenuItem({ label: 'Save Image As...', click: () => { contents.downloadURL(srcURL); } }));
      }

      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'reload' }));
      menu.append(new MenuItem({ label: 'Inspect Element', click: () => { contents.inspectElement(params.x, params.y); } }));

      // Show the menu at the cursor position
      const win = BrowserWindow.fromWebContents(contents) || BrowserWindow.getFocusedWindow();
      if (win) {
        menu.popup({ window: win });
      } else {
        menu.popup();
      }
    });
  });

  // ─── Phase 1.8: Downloads Manager ───
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const url = item.getURL();

    // Notify frontend download started
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('download-event', {
        type: 'start',
        fileName,
        url,
        totalBytes: item.getTotalBytes()
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'progressing' && !item.isPaused()) {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('download-event', {
            type: 'progress',
            fileName,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes()
          });
        }
      }
    });

    item.once('done', (event, state) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('download-event', {
          type: 'done',
          fileName,
          state, // 'completed', 'cancelled', 'interrupted'
          savePath: item.getSavePath(),
          totalBytes: item.getTotalBytes()
        });
      }
    });
  });

  // 1. Check if external services are online
  checkServiceLiveness();

  // 2. Start local IPFS node in background
  try {
    await ipfs.startNode();
    console.log('[App] IPFS node initialized.');

    // 3. Start agent swarm layer (multi-browser coordination)
    const heliaNode = ipfs.getHeliaNode();
    const gossip    = ipfs.getGossip();
    if (heliaNode && gossip) {
      // Attach blockchain sync to the swarm mesh
      try {
        bucksNode.attachGossip(gossip);
      } catch (err) {
        console.error('[App] Bucks node gossip attach failed:', err.message);
      }
      // Swarm delegation targets an agent server on :3000 the app does not
      // start, and its gossip messages are unsigned (spoofable nodeId, forgeable
      // results, ballot-stuffable consensus). It stays OFF unless explicitly
      // enabled, so a future contributor can't silently ship the un-audited path.
      if (process.env.BUCKS_EXPERIMENTAL_SWARM === '1') {
        try {
          await agentSwarm.start(heliaNode, gossip);
          console.log('[App] Agent swarm layer started (EXPERIMENTAL — unsigned, unaudited).');
        } catch (err) {
          console.error('[App] Agent swarm failed to start:', err.message);
        }
      } else {
        console.log('[App] Agent swarm disabled (set BUCKS_EXPERIMENTAL_SWARM=1 to enable).');
      }

      // 4. Start soul bridge (advertise own soul, handle peer souls)
      try {
        await soulBridge.start(3000); // 3 s grace period for agent server
        console.log('[App] Soul bridge started.');
      } catch (err) {
        console.error('[App] Soul bridge failed to start:', err.message);
      }

      // 4b. Start IPFS content bridge: Kubo-compatible HTTP API over the
      // Helia node for the Python agent, plus Helia↔Kubo peering when a
      // local daemon is running (see ipfs-bridge.js).
      try {
        await require('./ipfs-bridge').start(ipfs);
        console.log('[App] IPFS content bridge started.');
      } catch (err) {
        console.error('[App] IPFS content bridge failed to start:', err.message);
      }

      // 5. Start E2E-encrypted P2P chat engine (Signal over gossipsub)
      try {
        const chatEngine = require('./chat-engine');
        await chatEngine.initChat(heliaNode, gossip, ipfs.getFsModule());
        chatEngine.setOnMessageCallback((payload) => {
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('chat-message', payload);
          }
        });
        console.log('[App] Chat engine started.');
      } catch (err) {
        console.error('[App] Chat engine failed to start:', err.message);
      }

      // 5b. Cluster membership (invite-grown exclusive swarm) — gates who
      // counts as a trusted member on top of the open CIDN discovery layer.
      try {
        require('./cluster-membership').init(heliaNode, gossip);
        console.log('[App] Cluster membership module started.');
      } catch (err) {
        console.error('[App] Cluster membership failed to start:', err.message);
      }

      // 5c. Device sync (multi-device linking for one Soul) — mutual device
      // attestation + pinned/followed state snapshot sync between a person's
      // own linked installs. Independent of cluster membership.
      try {
        require('./device-sync').init(ipfs, heliaNode, gossip);
        console.log('[App] Device sync module started.');
      } catch (err) {
        console.error('[App] Device sync failed to start:', err.message);
      }

      // 6. Check for updates via the cluster's own IPFS swarm (replaces the
      // old GitHub-releases electron-updater path).
      try {
        await require('./cluster-updater').start(ipfs, mainWindow);
        console.log('[App] Cluster updater started.');
      } catch (err) {
        console.error('[App] Cluster updater failed to start:', err.message);
      }
    }
  } catch (err) {
    console.error('[App] IPFS node failed to start:', err.message);
  }
});

app.on('before-quit', async () => {
  if (ipfsServerProcess) {
    try {
      ipfsServerProcess.kill();
      console.log('[App] IPFS proxy server stopped.');
    } catch (e) {
      console.error('[App] Failed to kill IPFS proxy server:', e);
    }
  }
  try { require('./soul-engine-supervisor').stop(); } catch (_) {}
  try { require('./mcp-bridge').stop(); } catch (_) {}
  try { require('./soul-bridge').shutdown(); } catch (_) {}
  try { require('./agent-swarm').stop(); } catch (_) {}
  try { require('./ipfs-agent-soul').stop(); } catch (_) {}
  try { require('./ipfs-bridge').stop(); } catch (_) {}
  try { require('./bucks-node-manager').stop(); }  catch (_) {}
  try { require('./bucks-miner-manager').stop(); } catch (_) {}
  if (ipfs) await ipfs.stopNode();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // BUG FIX: pass saved settings so homepage, adBlock, and cluster config are
  // applied correctly when the window is reopened from the Dock (macOS).
  if (BrowserWindow.getAllWindows().length === 0) createWindow(loadSettings());
});

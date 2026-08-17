/**
 * Electron main process — Bucks Miner GUI
 *
 * Responsibilities:
 *   1. Create the main BrowserWindow and load the React renderer.
 *   2. Locate the bundled `bucksminer` binary and spawn it as a child process.
 *   3. Bridge IPC between the renderer and the miner API (localhost:8194).
 *   4. Manage system tray icon and graceful shutdown.
 */

'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const { spawn, execFile }  = require('child_process');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');
const http   = require('http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MINER_API   = 'http://127.0.0.1:8194';
const DEV_MODE    = process.env.NODE_ENV === 'development' || !app.isPackaged;
const RENDERER_URL = DEV_MODE
  ? 'http://localhost:5174'
  : `file://${path.join(__dirname, '../dist/index.html')}`;

// ---------------------------------------------------------------------------
// Locate bucksminer binary
// ---------------------------------------------------------------------------

function getMinerBinaryPath() {
  const platform = os.platform();
  const arch     = os.arch();

  const nameMap = {
    'darwin-arm64':  'bucksminer-darwin-arm64',
    'darwin-x64':    'bucksminer-darwin-amd64',
    'linux-x64':     'bucksminer-linux-amd64',
    'linux-arm64':   'bucksminer-linux-arm64',
    'win32-x64':     'bucksminer.exe',
  };
  const key  = `${platform}-${arch}`;
  const name = nameMap[key] ?? 'bucksminer';

  // Packaged app: extraResources places binaries in resources/miners/
  const packedPath = path.join(process.resourcesPath ?? '', 'miners', name);
  if (fs.existsSync(packedPath)) return packedPath;

  // Development: look in the sibling miner/dist/ folder.
  const devPath = path.join(__dirname, '../../miner/dist', name);
  if (fs.existsSync(devPath)) return devPath;

  return null; // binary not found — GUI will show install instructions
}

// ---------------------------------------------------------------------------
// Miner process management
// ---------------------------------------------------------------------------

let minerProcess = null;
let minerConfig  = {};

function loadConfig() {
  const cfgPath = path.join(os.homedir(), '.bucks', 'miner.toml');
  if (fs.existsSync(cfgPath)) {
    // Parse TOML manually (minimal) or read as string and hand to renderer.
    return { path: cfgPath, exists: true };
  }
  return { path: cfgPath, exists: false };
}

function spawnMiner(config) {
  if (minerProcess) return;

  const binary = getMinerBinaryPath();
  if (!binary) {
    console.error('[electron] bucksminer binary not found');
    return;
  }

  const args = [
    'mine',
    '--address', config.walletAddress ?? '',
    '--mode',    config.mode    ?? 'solo',
    '--node',    config.nodeUrl ?? 'http://127.0.0.1:8192',
    '--threads', String(config.threads ?? 0),
    '--api-addr', '127.0.0.1:8194',
  ];

  if (config.mode === 'pool' && config.poolUrl) {
    args.push('--pool', config.poolUrl);
  }

  console.log('[electron] Spawning bucksminer:', binary, args.join(' '));

  minerProcess = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  minerProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    console.log('[bucksminer]', line);
    mainWindow?.webContents.send('miner:log', line);
  });

  minerProcess.stderr.on('data', (data) => {
    console.error('[bucksminer:err]', data.toString().trim());
  });

  minerProcess.on('exit', (code) => {
    console.log(`[electron] bucksminer exited (code ${code})`);
    minerProcess = null;
    mainWindow?.webContents.send('miner:stopped', { code });
  });
}

function killMiner() {
  if (minerProcess) {
    minerProcess.kill('SIGTERM');
    minerProcess = null;
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIPC() {
  // Renderer → spawn miner with config.
  ipcMain.handle('miner:start', async (_event, config) => {
    minerConfig = config;
    spawnMiner(config);
    return { ok: true };
  });

  // Renderer → stop miner.
  ipcMain.handle('miner:stop', async () => {
    killMiner();
    return { ok: true };
  });

  // Renderer → proxy GET to miner API.
  ipcMain.handle('miner:status', async () => {
    return new Promise((resolve) => {
      http.get(`${MINER_API}/api/status`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(body) }); }
          catch { resolve({ ok: false, data: null }); }
        });
      }).on('error', () => resolve({ ok: false, data: null }));
    });
  });

  // Renderer → check if binary is present.
  ipcMain.handle('miner:binary-path', async () => {
    const p = getMinerBinaryPath();
    return { path: p, found: !!p };
  });

  // Renderer → get/set config.
  ipcMain.handle('config:get',   async () => loadConfig());
  ipcMain.handle('config:write', async (_event, toml) => {
    const cfgPath = path.join(os.homedir(), '.bucks', 'miner.toml');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, toml, 'utf8');
    return { ok: true };
  });

  // Open external links safely.
  ipcMain.handle('shell:open', async (_event, url) => {
    shell.openExternal(url);
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow = null;
let tray       = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           840,
    height:          620,
    minWidth:        720,
    minHeight:       520,
    titleBarStyle:   'hiddenInset',
    backgroundColor: '#0a0a1e',
    webPreferences:  {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadURL(RENDERER_URL);

  if (DEV_MODE) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (e) => {
    // Minimise to tray instead of quitting.
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use a blank icon for now; replace with assets/tray-icon.png in production.
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Bucks Miner');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Bucks Miner', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIPC();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  killMiner();
});

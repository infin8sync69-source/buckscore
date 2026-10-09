'use strict';
const { BrowserView, BrowserWindow } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const APPS_DIR = path.join(os.homedir(), '.bucks', 'apps');
const INSTALLED_DB = path.join(APPS_DIR, 'installed.json');

// Ensure apps dir exists
if (!fs.existsSync(APPS_DIR)) fs.mkdirSync(APPS_DIR, { recursive: true });

function getInstalled() {
  try { return JSON.parse(fs.readFileSync(INSTALLED_DB, 'utf8')); }
  catch { return {}; }
}

function saveInstalled(db) {
  fs.writeFileSync(INSTALLED_DB, JSON.stringify(db, null, 2));
}

// Tier 1: Open hosted web URL in a sandboxed BrowserView
async function launchWeb(mainWindow, app) {
  // Remove any existing app view
  closeAppView(mainWindow);

  const view = new BrowserView({
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.addBrowserView(view);
  mainWindow.currentAppView = view;

  // Position view below the tab bar (adjust bounds to match Bucks layout)
  const bounds = mainWindow.getContentBounds();
  view.setBounds({ x: 0, y: 60, width: bounds.width, height: bounds.height - 60 });
  view.setAutoResize({ width: true, height: true });
  view.webContents.loadURL(app.runUrl);

  return { success: true, mode: 'web', url: app.runUrl };
}

function closeAppView(mainWindow) {
  if (mainWindow.currentAppView) {
    mainWindow.removeBrowserView(mainWindow.currentAppView);
    mainWindow.currentAppView = null;
  }
}

// Tier 2: Clone repo and install locally
async function installLocal(appId, repo, event) {
  const appDir = path.join(APPS_DIR, appId);

  if (fs.existsSync(appDir)) {
    return { success: false, error: 'Already installed' };
  }

  return new Promise((resolve) => {
    event.sender.send('app-install-progress', { appId, stage: 'cloning', message: 'Downloading...' });

    exec(`git clone --depth 1 https://github.com/${repo} "${appDir}"`, (err) => {
      if (err) return resolve({ success: false, error: err.message });

      event.sender.send('app-install-progress', { appId, stage: 'installing', message: 'Installing...' });

      exec(`cd "${appDir}" && npm install --prefer-offline`, (err2) => {
        if (err2) return resolve({ success: false, error: err2.message });

        const db = getInstalled();
        db[appId] = { installedAt: Date.now(), dir: appDir, repo };
        saveInstalled(db);

        event.sender.send('app-install-progress', { appId, stage: 'ready', message: 'Ready' });
        resolve({ success: true, dir: appDir });
      });
    });
  });
}

// Tier 3: Launch local install
async function launchLocal(mainWindow, app) {
  const db = getInstalled();
  const info = db[app.id];
  if (!info) return { success: false, error: 'Not installed' };

  return new Promise((resolve) => {
    const proc = spawn('npm', ['start'], { cwd: info.dir, env: { ...process.env, BROWSER: 'none' } });

    // Wait for port to open (poll for up to 30s)
    const port = app.localRun?.port || 3000;
    let attempts = 0;
    const check = setInterval(async () => {
      attempts++;
      try {
        await fetch(`http://localhost:${port}`);
        clearInterval(check);
        await launchWeb(mainWindow, { ...app, runUrl: `http://localhost:${port}` });
        resolve({ success: true, mode: 'local', port });
      } catch {
        if (attempts > 30) {
          clearInterval(check);
          proc.kill();
          resolve({ success: false, error: 'App did not start in time' });
        }
      }
    }, 1000);
  });
}

async function uninstall(appId) {
  const db = getInstalled();
  const info = db[appId];
  if (!info) return { success: false, error: 'Not installed' };

  exec(`rm -rf "${info.dir}"`);
  delete db[appId];
  saveInstalled(db);
  return { success: true };
}

module.exports = { launchWeb, launchLocal, installLocal, closeAppView, uninstall, getInstalled };

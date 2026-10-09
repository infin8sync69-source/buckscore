const { BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');

let ephemeralWindow = null;
let isPinned = false;

const EPHEMERAL_DEFAULT_WIDTH  = 680;
const EPHEMERAL_HEIGHT_INPUT   = 68;   // collapsed: input only
const EPHEMERAL_HEIGHT_MAX     = 620;  // expanded: input + response + chips

function createEphemeralWindow(parentWindow) {
  if (ephemeralWindow) return ephemeralWindow;

  ephemeralWindow = new BrowserWindow({
    width:  EPHEMERAL_DEFAULT_WIDTH,
    height: EPHEMERAL_HEIGHT_INPUT,
    minWidth: 380,
    minHeight: 52,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    resizable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'ephemeral-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  ephemeralWindow.loadFile(path.join(__dirname, 'ephemeral.html'));

  ephemeralWindow.on('blur', () => {
    // Only auto-hide on blur if not pinned by the user
    if (!isPinned && ephemeralWindow && !ephemeralWindow.isDestroyed()) {
      ephemeralWindow.hide();
    }
  });

  ephemeralWindow.on('closed', () => {
    ephemeralWindow = null;
    isPinned = false;
  });

  return ephemeralWindow;
}

function toggleEphemeralWindow() {
  if (!ephemeralWindow) return;
  if (ephemeralWindow.isVisible()) {
    ephemeralWindow.hide();
  } else {
    ephemeralWindow.center();
    const bounds = ephemeralWindow.getBounds();
    ephemeralWindow.setBounds({
      ...bounds,
      width: Math.max(EPHEMERAL_DEFAULT_WIDTH, bounds.width),
      height: Math.max(EPHEMERAL_HEIGHT_INPUT, bounds.height),
      y: Math.max(60, bounds.y - 120)
    });
    ephemeralWindow.show();
    ephemeralWindow.focus();
    ephemeralWindow.webContents.send('focus-input');
  }
}

function setupEphemeralShortcuts() {
  globalShortcut.register('CommandOrControl+K', () => {
    toggleEphemeralWindow();
  });
}

function cleanupEphemeralShortcuts() {
  globalShortcut.unregister('CommandOrControl+K');
}

// IPC Handlers
function setupEphemeralIPC(mainBrowserWindow) {
  // "Open in chat" — route to main window and hide
  ipcMain.handle('ephemeral:submit', (event, { query }) => {
    if (ephemeralWindow && !ephemeralWindow.isDestroyed()) {
      ephemeralWindow.hide();
    }
    if (mainBrowserWindow && !mainBrowserWindow.isDestroyed()) {
      mainBrowserWindow.webContents.send('agent:ephemeral-query', { query });
    }
  });

  ipcMain.on('ephemeral:pin', (event, { isPinned: pinned }) => {
    isPinned = !!pinned;
    if (ephemeralWindow && !ephemeralWindow.isDestroyed()) {
      ephemeralWindow.setAlwaysOnTop(isPinned, 'floating');
    }
  });

  ipcMain.on('ephemeral:hide', () => {
    if (ephemeralWindow && !ephemeralWindow.isDestroyed()) {
      ephemeralWindow.hide();
      if (!isPinned) {
        ephemeralWindow.setBounds({
          ...ephemeralWindow.getBounds(),
          height: EPHEMERAL_HEIGHT_INPUT
        });
      }
    }
  });

  ipcMain.on('ephemeral:set-mode', (event, { mode }) => {
    if (!ephemeralWindow || ephemeralWindow.isDestroyed()) return;
    const current = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = current.workArea;

    if (mode === 'card') {
      ephemeralWindow.setBounds({
        x: Math.round(area.x + (area.width - 760) / 2),
        y: Math.round(area.y + (area.height - 580) / 2),
        width: 760,
        height: 580
      });
    } else if (mode === 'dock') {
      ephemeralWindow.setBounds({
        x: Math.round(area.x + area.width - 450),
        y: Math.round(area.y + 20),
        width: 440,
        height: Math.round(area.height - 40)
      });
    } else if (mode === 'spotlight') {
      ephemeralWindow.setBounds({
        x: Math.round(area.x + (area.width - EPHEMERAL_DEFAULT_WIDTH) / 2),
        y: Math.round(area.y + 120),
        width: EPHEMERAL_DEFAULT_WIDTH,
        height: EPHEMERAL_HEIGHT_INPUT
      });
    }
  });

  // Renderer calls this to expand/shrink the window during streaming
  ipcMain.on('ephemeral:resize', (event, { width, height }) => {
    if (!ephemeralWindow || ephemeralWindow.isDestroyed()) return;
    const clampedHeight = Math.max(EPHEMERAL_HEIGHT_INPUT, Math.min(height || EPHEMERAL_HEIGHT_INPUT, EPHEMERAL_HEIGHT_MAX));
    const bounds = ephemeralWindow.getBounds();
    const newWidth = width ? Math.max(380, width) : bounds.width;

    ephemeralWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: newWidth,
      height: clampedHeight
    });
  });
}

module.exports = {
  createEphemeralWindow,
  setupEphemeralShortcuts,
  cleanupEphemeralShortcuts,
  setupEphemeralIPC,
  toggleEphemeralWindow
};

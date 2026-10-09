/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS TAB MANAGER — main-process WebContentsView host      ║
   ║                                                            ║
   ║  Replaces the legacy <webview> tag for tab hosting. Each   ║
   ║  tab is a first-class WebContentsView child of the window  ║
   ║  (Chrome-grade site isolation & performance). The renderer ║
   ║  keeps a placeholder <div> per tab (tab-view.js) and       ║
   ║  mirrors its geometry/visibility here over IPC.            ║
   ║                                                            ║
   ║  Channels (invoke): tabs:create/navigate/close/setBounds/  ║
   ║    setVisible/goBack/goForward/reload/stop/setZoom/find/   ║
   ║    stopFind/execJS/capture/print/openDevTools              ║
   ║  Events (send): 'tabs:event' {tabId, type, ...payload}     ║
   ╚══════════════════════════════════════════════════════════╝ */
'use strict';

const { app, WebContentsView, BrowserWindow, Menu, clipboard, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { attachBluetoothChooser } = require('./permission-manager');
const { spellcheckMenuItems } = require('./web-security');

/** tabId -> { view, winId, lastBounds, visible } */
const tabsById = new Map();

function _win(e) {
  return BrowserWindow.fromWebContents(e.sender);
}

function _shellSend(winId, payload) {
  const win = BrowserWindow.fromId(winId);
  if (win && !win.isDestroyed()) win.webContents.send('tabs:event', payload);
}

function _navState(wc) {
  const h = wc.navigationHistory;
  return h
    ? { canGoBack: h.canGoBack(), canGoForward: h.canGoForward() }
    : { canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() };
}

function _wireEvents(tabId, winId, view) {
  const wc = view.webContents;
  const send = (type, payload = {}) => _shellSend(winId, { tabId, type, ...payload });
  const sendNav = () => send('nav-state', _navState(wc));

  wc.on('did-start-loading', () => send('did-start-loading'));
  wc.on('did-stop-loading', () => { send('did-stop-loading'); sendNav(); });
  wc.on('page-title-updated', (_e, title) => send('page-title-updated', { title }));
  wc.on('page-favicon-updated', (_e, favicons) => send('page-favicon-updated', { favicons }));
  wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (isMainFrame) send('did-start-navigation', { url });
  });
  wc.on('did-navigate', (_e, url) => { send('did-navigate', { url }); sendNav(); });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) { send('did-navigate-in-page', { url }); sendNav(); }
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* ERR_ABORTED: benign */) {
      send('did-fail-load', { errorCode: code, errorDescription: desc, validatedURL: url });
      // Show a friendly in-tab error page (a blank void is not a browser).
      wc.loadURL(_errorPageURL(code, desc, url)).catch(() => {});
    }
  });
  wc.on('found-in-page', (_e, result) => send('found-in-page', { result }));
  // Clicking into a page focuses its webContents — the shell uses this to
  // track which pane is focused when a tab hosts several (pane-manager.js).
  wc.on('focus', () => send('view-focus'));

  // Popups / target=_blank → let the shell open them as tabs.
  wc.setWindowOpenHandler(({ url }) => {
    send('new-window', { url });
    return { action: 'deny' };
  });

  // HTML fullscreen (e.g. video players): expand to the whole window, then
  // restore the tracked placeholder bounds on exit.
  wc.on('enter-html-full-screen', () => {
    const win = BrowserWindow.fromId(winId);
    const rec = tabsById.get(tabId);
    if (win && rec) {
      const [w, h] = win.getContentSize();
      view.setBounds({ x: 0, y: 0, width: w, height: h });
    }
  });
  wc.on('leave-html-full-screen', () => {
    const rec = tabsById.get(tabId);
    if (rec && rec.lastBounds) view.setBounds(rec.lastBounds);
  });

  // Native context menu — floats above the view (OS-level), giving proper
  // browser UX that DOM menus can't provide over a native view.
  wc.on('context-menu', (_e, params) => {
    const items = [];
    // Spelling suggestions first, like every browser (only on misspellings).
    items.push(...spellcheckMenuItems(wc, params));
    const nav = _navState(wc);
    items.push(
      { label: 'Back', enabled: nav.canGoBack, click: () => wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack() },
      { label: 'Forward', enabled: nav.canGoForward, click: () => wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
    );
    if (params.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', click: () => send('new-window', { url: params.linkURL }) },
        { label: 'Open Link in Split Pane', click: () => send('open-in-pane', { url: params.linkURL }) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      );
    }
    if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy' }, { type: 'separator' });
    }
    if (params.isEditable) {
      items.push(
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { type: 'separator' },
      );
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) }, { type: 'separator' });
    }
    items.push({ label: 'Inspect Element', click: () => { wc.inspectElement(params.x, params.y); } });
    Menu.buildFromTemplate(items).popup();
  });
}

function _errorPageURL(code, desc, url) {
  const offline = code === -106; // ERR_INTERNET_DISCONNECTED
  const dns = code === -105;     // ERR_NAME_NOT_RESOLVED
  const heading = offline ? 'You’re offline' : dns ? 'Site not found' : 'This page didn’t load';
  const hint = offline
    ? 'Check your Wi-Fi or network connection, then retry.'
    : dns
      ? 'The address couldn’t be resolved — check the spelling of the domain.'
      : `${desc || 'Unknown error'} (${code})`;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(heading)}</title><style>
    body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
         background:linear-gradient(160deg,#131316,#0b0b0e);color:#eee;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .card{max-width:420px;text-align:center;padding:40px}
    .icon{font-size:44px;margin-bottom:14px}
    h1{font-size:20px;margin:0 0 8px;font-weight:650}
    p{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.62);margin:0 0 6px;word-break:break-all}
    .url{font-size:12px;color:rgba(255,255,255,.4)}
    button{margin-top:20px;padding:10px 26px;border-radius:99px;border:1px solid rgba(255, 255, 255, 0.55);
           background:rgba(255, 255, 255, 0.18);color:#c9a6ff;font-size:13.5px;font-weight:600;cursor:pointer}
    button:hover{background:rgba(255, 255, 255, 0.32)}
  </style></head><body><div class="card">
    <div class="icon">${offline ? '📡' : dns ? '🧭' : '⚠️'}</div>
    <h1>${esc(heading)}</h1>
    <p>${esc(hint)}</p>
    <p class="url">${esc(url)}</p>
    <button onclick="location.replace(${JSON.stringify(url)})">Retry</button>
  </div></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function _get(tabId) {
  const rec = tabsById.get(tabId);
  if (!rec || rec.view.webContents.isDestroyed()) return null;
  return rec;
}

/**
 * Release every WebContentsView owned by a window.
 *
 * Call this on window close AND on shell reload: the renderer's view registry
 * (tab-view.js `instances`) is rebuilt from scratch when index.html reloads,
 * but these native views survive it. An orphan stays attached to the window's
 * contentView and keeps painting ON TOP of the rebuilt UI — which looks like
 * "every new tab shows the previous page", because the page you are seeing
 * belongs to no tab at all.
 *
 * removeChildView matters as much as close(): a closed webContents whose view
 * is still a child leaves a dead rectangle over the shell.
 */
function destroyTabsForWindow(winId) {
  const win = BrowserWindow.fromId(winId);
  let n = 0;
  for (const [tabId, rec] of tabsById) {
    if (rec.winId !== winId) continue;
    try { if (win && !win.isDestroyed()) win.contentView.removeChildView(rec.view); } catch (_) {}
    try { rec.view.webContents.close(); } catch (_) {}
    tabsById.delete(tabId);
    n++;
  }
  if (n) console.log(`[TabManager] Released ${n} view(s) for window ${winId}`);
  return n;
}

function setupTabIPC() {
  ipcMain.handle('tabs:create', (e, { tabId, url, partition }) => {
    const win = _win(e);
    if (!win || tabsById.has(tabId)) return false;

    // Load javascript and webrtc preference from settings.json
    let jsEnabled = true;
    let webrtcProtection = true;
    try {
      const settingsFile = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        jsEnabled = settings.jsEnabled !== false;
        webrtcProtection = settings.webrtcProtection !== false;
      }
    } catch (err) {
      console.error('[TabManager] Failed to read settings for webPreferences:', err);
    }

    const view = new WebContentsView({
      webPreferences: {
        partition: partition || undefined,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: jsEnabled,
      },
    });

    try {
      // setWebRTCIPHandlingPolicy lives on webContents, not session.
      const policy = webrtcProtection ? 'default_public_interface_only' : 'default';
      view.webContents.setWebRTCIPHandlingPolicy(policy);
    } catch (err) {
      console.error('[TabManager] Failed to set WebRTC policy:', err);
    }

    view.setVisible(false);
    win.contentView.addChildView(view);
    tabsById.set(tabId, { view, winId: win.id, lastBounds: null, visible: false });
    _wireEvents(tabId, win.id, view);
    attachBluetoothChooser(view.webContents);
    if (url) view.webContents.loadURL(url).catch(() => {});
    return true;
  });

  ipcMain.handle('tabs:close', (_e, { tabId }) => {
    const rec = tabsById.get(tabId);
    if (!rec) return false;
    const win = BrowserWindow.fromId(rec.winId);
    try { if (win && !win.isDestroyed()) win.contentView.removeChildView(rec.view); } catch (_) {}
    try { rec.view.webContents.close(); } catch (_) {}
    tabsById.delete(tabId);
    return true;
  });

  ipcMain.handle('tabs:navigate', (_e, { tabId, url }) => {
    const rec = _get(tabId);
    if (rec) rec.view.webContents.loadURL(url).catch(() => {});
    return !!rec;
  });

  ipcMain.handle('tabs:setBounds', (_e, { tabId, bounds }) => {
    const rec = _get(tabId);
    if (!rec) return false;
    const b = {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    rec.lastBounds = b;
    rec.view.setBounds(b);
    return true;
  });

  ipcMain.handle('tabs:setVisible', (_e, { tabId, visible }) => {
    const rec = _get(tabId);
    if (!rec) return false;
    rec.visible = !!visible;
    rec.view.setVisible(!!visible);
    // Raise the active view above sibling views (last child paints on top).
    if (visible) {
      const win = BrowserWindow.fromId(rec.winId);
      if (win && !win.isDestroyed()) {
        try { win.contentView.addChildView(rec.view); } catch (_) {}
      }
    }
    return true;
  });

  ipcMain.handle('tabs:setBorderRadius', (_e, { tabId, radius }) => {
    const rec = _get(tabId);
    if (rec && typeof rec.view.setBorderRadius === 'function') {
      try { rec.view.setBorderRadius(radius); } catch (_) {}
      return true;
    }
    return false;
  });

  ipcMain.handle('tabs:goBack', (_e, { tabId }) => {
    const rec = _get(tabId);
    if (rec) {
      const wc = rec.view.webContents;
      wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack();
    }
  });
  ipcMain.handle('tabs:goForward', (_e, { tabId }) => {
    const rec = _get(tabId);
    if (rec) {
      const wc = rec.view.webContents;
      wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward();
    }
  });
  ipcMain.handle('tabs:reload', (_e, { tabId }) => { const r = _get(tabId); if (r) r.view.webContents.reload(); });
  ipcMain.handle('tabs:stop', (_e, { tabId }) => { const r = _get(tabId); if (r) r.view.webContents.stop(); });
  ipcMain.handle('tabs:setZoom', (_e, { tabId, factor }) => { const r = _get(tabId); if (r) r.view.webContents.setZoomFactor(factor); });
  ipcMain.handle('tabs:print', (_e, { tabId }) => { const r = _get(tabId); if (r) r.view.webContents.print(); });
  ipcMain.handle('tabs:openDevTools', (_e, { tabId }) => {
    try {
      const settingsFile = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        if (settings.devtoolsHotkey === false) {
          console.warn('[TabManager] DevTools is disabled by advanced settings');
          return;
        }
      }
    } catch (_) {}
    const r = _get(tabId);
    if (r) r.view.webContents.openDevTools({ mode: 'detach' });
  });

  ipcMain.handle('tabs:find', (_e, { tabId, text, options }) => {
    const rec = _get(tabId);
    if (rec && text) rec.view.webContents.findInPage(text, options || {});
  });
  ipcMain.handle('tabs:stopFind', (_e, { tabId, action }) => {
    const rec = _get(tabId);
    if (rec) rec.view.webContents.stopFindInPage(action || 'clearSelection');
  });

  ipcMain.handle('tabs:execJS', async (_e, { tabId, code, userGesture }) => {
    const rec = _get(tabId);
    if (!rec) throw new Error('No such tab');
    return rec.view.webContents.executeJavaScript(code, !!userGesture);
  });

  ipcMain.handle('tabs:capture', async (_e, { tabId }) => {
    const rec = _get(tabId);
    if (!rec) throw new Error('No such tab');
    const img = await rec.view.webContents.capturePage();
    return img.toPNG().toString('base64');
  });

  // Print the live page of a tab/pane to a PDF in ~/Documents/Bucks.
  ipcMain.handle('tabs:printToPDF', async (_e, { tabId, title }) => {
    const rec = _get(tabId);
    if (!rec) throw new Error('No such tab');
    const { targetPath } = require('./doc-factory');
    const wc = rec.view.webContents;
    const name = title || wc.getTitle() || 'page';
    const p = targetPath(name, 'pdf');
    const data = await wc.printToPDF({ pageSize: 'A4', printBackground: true });
    require('fs').writeFileSync(p, data);
    try { require('electron').shell.showItemInFolder(p); } catch (_) {}
    return { path: p };
  });

  ipcMain.handle('tabs:getURL', (_e, { tabId }) => {
    const rec = _get(tabId);
    return rec ? rec.view.webContents.getURL() : '';
  });
}

module.exports = { setupTabIPC, destroyTabsForWindow };

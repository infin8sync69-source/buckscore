/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS EXTENSION LOADER — unpacked Chrome extensions        ║
   ║                                                            ║
   ║  Loads every unpacked extension folder found under         ║
   ║  ~/.bucks/extensions/<name>/ (each must contain a           ║
   ║  manifest.json) into the default session at startup.       ║
   ║                                                            ║
   ║  Electron supports a subset of the chrome.* surface —      ║
   ║  content scripts, storage, tabs basics — which covers      ║
   ║  ad-blockers and userscript managers; it does NOT render   ║
   ║  extension toolbars/popups (tracked in docs/                ║
   ║  CHROMIUM-ENGINE.md roadmap).                                ║
   ║                                                            ║
   ║  IPC: 'extensions:list' → [{id, name, version, path}]      ║
   ╚══════════════════════════════════════════════════════════╝ */
'use strict';

const { app, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT_DIR = path.join(os.homedir(), '.bucks', 'extensions');
const _loaded = [];

async function loadUserExtensions() {
  try { fs.mkdirSync(EXT_DIR, { recursive: true }); } catch (_) {}

  let entries = [];
  try { entries = fs.readdirSync(EXT_DIR, { withFileTypes: true }); } catch (_) {}

  const sess = session.defaultSession;
  // Electron ≥ 36 exposes session.extensions; fall back for older API shape.
  const loader = sess.extensions
    ? (p) => sess.extensions.loadExtension(p, { allowFileAccess: false })
    : (p) => sess.loadExtension(p, { allowFileAccess: false });

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(EXT_DIR, ent.name);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
    try {
      const ext = await loader(dir);
      _loaded.push({ id: ext.id, name: ext.name, version: ext.version, path: dir });
      console.log(`[Extensions] loaded ${ext.name}@${ext.version} (${ext.id})`);
    } catch (e) {
      console.error(`[Extensions] failed to load ${ent.name}:`, e.message);
    }
  }
  if (!_loaded.length) {
    console.log(`[Extensions] none loaded — drop unpacked extensions into ${EXT_DIR}`);
  }

  ipcMain.handle('extensions:list', () => _loaded.slice());
  return _loaded;
}

module.exports = { loadUserExtensions, EXT_DIR };

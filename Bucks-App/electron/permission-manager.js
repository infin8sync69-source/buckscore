/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS PERMISSION MANAGER — per-origin web permissions       ║
   ║                                                            ║
   ║  A real browser must broker geolocation, camera/mic,       ║
   ║  notifications, and device access between pages and the    ║
   ║  OS. Without these handlers Chromium silently denies (or   ║
   ║  hangs) every request. Decisions are remembered per        ║
   ║  origin+permission in userData/permissions.json.           ║
   ║                                                            ║
   ║  Policy:                                                   ║
   ║    AUTO-ALLOW  — harmless page UX (fullscreen, pointer     ║
   ║                  lock, sanitized clipboard write)           ║
   ║    PROMPT      — privacy-sensitive (geolocation, media,    ║
   ║                  notifications, midi, hid, serial)          ║
   ║    DENY        — everything else, and the private partition ║
   ║                  never persists grants                      ║
   ╚══════════════════════════════════════════════════════════╝ */
'use strict';

const { app, dialog, session, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const AUTO_ALLOW = new Set([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
  'window-management',
]);
const PROMPT = new Set([
  'geolocation',
  'media',            // camera and/or microphone (details.mediaTypes)
  'notifications',
  'midi',
  'midiSysex',
  'hid',
  'serial',
]);

const LABELS = {
  geolocation: 'know your location',
  media: 'use your camera/microphone',
  notifications: 'show notifications',
  midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices (system exclusive)',
  hid: 'access HID devices',
  serial: 'access serial devices',
};

let _store = null;
function _storeFile() {
  return path.join(app.getPath('userData'), 'permissions.json');
}
function _load() {
  if (_store) return _store;
  try { _store = JSON.parse(fs.readFileSync(_storeFile(), 'utf8')); }
  catch (_) { _store = {}; }
  return _store;
}
function _save() {
  try { fs.writeFileSync(_storeFile(), JSON.stringify(_load(), null, 2), 'utf8'); }
  catch (e) { console.error('[Permissions] save failed:', e.message); }
}

function _origin(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

function getGrant(origin, permission) {
  const o = _load()[origin];
  return o ? o[permission] : undefined;   // true | false | undefined
}
function setGrant(origin, permission, allowed, persist = true) {
  const store = _load();
  (store[origin] = store[origin] || {})[permission] = allowed;
  if (persist) _save();
}

// One prompt at a time per origin+permission — concurrent requests coalesce.
const _pending = new Map();

async function _prompt(origin, permission, details) {
  const key = `${origin}|${permission}`;
  if (_pending.has(key)) return _pending.get(key);

  let what = LABELS[permission] || permission;
  if (permission === 'media' && Array.isArray(details?.mediaTypes)) {
    const t = details.mediaTypes;
    what = t.includes('video') && t.includes('audio') ? 'use your camera and microphone'
      : t.includes('video') ? 'use your camera'
      : t.includes('audio') ? 'use your microphone' : what;
  }

  const p = (async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Permission request',
      message: `${origin || 'This page'} wants to ${what}.`,
      detail: 'Bucks remembers this choice for this site. You can reset it by deleting permissions.json in the app data folder.',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
    });
    return response === 0;
  })();
  _pending.set(key, p);
  try { return await p; } finally { _pending.delete(key); }
}

function _handleSession(sess, { persist }) {
  sess.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (AUTO_ALLOW.has(permission)) return callback(true);
    if (!PROMPT.has(permission)) {
      console.warn(`[Permissions] denied (unhandled type): ${permission}`);
      return callback(false);
    }
    const origin = _origin(details.requestingUrl || (wc ? wc.getURL() : ''));
    const stored = persist ? getGrant(origin, permission) : undefined;
    if (typeof stored === 'boolean') return callback(stored);
    let allowed = false;
    try { allowed = await _prompt(origin, permission, details); }
    catch (e) { console.error('[Permissions] prompt failed:', e.message); }
    if (persist && origin) setGrant(origin, permission, allowed);
    callback(allowed);
  });

  // Synchronous capability checks (navigator.permissions.query, media
  // enumeration): mirror stored grants, allow the auto-allow set.
  sess.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    if (!PROMPT.has(permission)) return false;
    const stored = persist ? getGrant(_origin(requestingOrigin) || requestingOrigin, permission) : undefined;
    return stored === true;
  });

  // Web Bluetooth: without this handler requestDevice() hangs forever.
  // The chooser fires repeatedly as devices are discovered; keep the latest
  // callback and resolve it when we have something (or cancel on timeout).
  sess.setBluetoothPairingHandler?.((details, callback) => {
    // PIN pairing UI is out of scope — confirm-only pairings are accepted.
    if (details.pairingKind === 'confirm') callback({ confirmed: true });
    else callback({ confirmed: false });
  });
}

function setupPermissions() {
  _handleSession(session.defaultSession, { persist: true });
  _handleSession(session.fromPartition('bucks-private'), { persist: false });
}

// Attach the Bluetooth device chooser to a webContents (shell and every tab).
// Auto-picks the first named device after a short discovery window; a proper
// picker UI can replace _select later without touching callers.
function attachBluetoothChooser(wc) {
  let picker = null; // { timer, callback, best }
  wc.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    const named = deviceList.find((d) => d.deviceName) || deviceList[0];
    if (!picker) {
      picker = { callback, best: named };
      picker.timer = setTimeout(() => {
        const chosen = picker.best;
        const cb = picker.callback;
        picker = null;
        cb(chosen ? chosen.deviceId : '');
      }, 3000);
    } else {
      picker.callback = callback;
      if (named && (!picker.best || (named.deviceName && !picker.best.deviceName))) picker.best = named;
    }
  });
}

module.exports = { setupPermissions, attachBluetoothChooser, getGrant, setGrant };

/**
 * Electron preload — contextBridge exposes a safe IPC API to the renderer.
 * contextIsolation is ON; no Node APIs leak into the renderer.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Miner lifecycle
  startMiner:  (config) => ipcRenderer.invoke('miner:start',  config),
  stopMiner:   ()       => ipcRenderer.invoke('miner:stop'),
  getMinerStatus: ()    => ipcRenderer.invoke('miner:status'),
  getBinaryPath:  ()    => ipcRenderer.invoke('miner:binary-path'),

  // Config persistence
  getConfig:   ()       => ipcRenderer.invoke('config:get'),
  writeConfig: (toml)   => ipcRenderer.invoke('config:write', toml),

  // Shell
  openExternal: (url)   => ipcRenderer.invoke('shell:open', url),

  // Push events from main → renderer
  onMinerLog:     (cb) => ipcRenderer.on('miner:log',     (_e, line) => cb(line)),
  onMinerStopped: (cb) => ipcRenderer.on('miner:stopped', (_e, data) => cb(data)),

  // Clean-up helpers for React useEffect returns
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});

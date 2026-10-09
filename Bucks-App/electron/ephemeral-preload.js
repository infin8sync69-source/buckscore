const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ephemeralAPI', {
  // Route query to main window chat pipeline (legacy / "Open in chat" action)
  submitQuery: (query) => ipcRenderer.invoke('ephemeral:submit', { query }),
  // Hide the ephemeral window immediately
  hide: () => ipcRenderer.send('ephemeral:hide'),
  // Resize the window dimensions
  resize: (width, height) => ipcRenderer.send('ephemeral:resize', { width, height }),
  // Pin window on top across all applications
  setPinned: (isPinned) => ipcRenderer.send('ephemeral:pin', { isPinned }),
  // Set layout mode: 'pill' | 'spotlight' | 'card' | 'dock'
  setMode: (mode) => ipcRenderer.send('ephemeral:set-mode', { mode }),
  // Focus-input event sent when the window is shown via Cmd+K
  onFocusInput: (callback) => ipcRenderer.on('focus-input', callback)
});

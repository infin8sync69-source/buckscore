const { contextBridge, ipcRenderer } = require('electron');

/* ─── Durable shell storage ───
   The file:// shell gets an OPAQUE origin in modern Chromium, so its
   localStorage never survives a relaunch (bookmarks, history, profile,
   session restore all silently reset). Hydrate from main's store before any
   shell script runs, then stream snapshots back: a dirty-checked 1.5s poll
   (prototype patching can't cross the contextIsolation boundary) plus an
   immediate flush on pagehide. Main keeps the authoritative in-memory copy. */
(function persistShellStorage() {
  try {
    const saved = ipcRenderer.sendSync('shell-storage:load') || {};
    for (const [k, v] of Object.entries(saved)) {
      // Keep in-session values (a reload mid-session is newer than the file).
      if (localStorage.getItem(k) === null) {
        try { localStorage.setItem(k, v); } catch (_) {}
      }
    }
    let lastSent = '';
    const flush = () => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      const json = JSON.stringify(out);
      if (json !== lastSent) {
        lastSent = json;
        ipcRenderer.send('shell-storage:save', out);
      }
    };
    setInterval(flush, 1500);
    window.addEventListener('pagehide', flush);
  } catch (e) {
    console.error('[Preload] shell storage persistence failed:', e);
  }
})();

const bucksAPI = {
  /* ─── Window Controls ─── */
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  /* ─── App info ─── */
  appVersion: ipcRenderer.sendSync('get-app-version'),

  /* ─── Settings ─── */
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  /* ─── Ad-blocker & Events ─── */
  getBlockedCount: () => ipcRenderer.invoke('get-blocked-count'),
  toggleAdBlock: (enabled) => ipcRenderer.send('toggle-adblock', enabled),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  // V2: deferred to next release — wallet access approval UI bridge
  // onWalletAccessRequest: (callback) => ipcRenderer.on('wallet-access-request', (_e, data) => callback(data)),
  // respondToWalletAccess: (requestId, approved) => ipcRenderer.send('wallet-access-response', { requestId, approved }),
  onDownloadEvent: (callback) => ipcRenderer.on('download-event', (_e, data) => callback(data)),
  openDownloadsFolder: () => ipcRenderer.send('open-downloads-folder'),
  showDownloadInFolder: (savePath) => ipcRenderer.send('show-download-in-folder', savePath),
  
  // Advanced Agentic Context Menu Events
  onAskAgentContext: (callback) => ipcRenderer.on('ask-agent-context', (_e, data) => callback(data)),
  onSaveAgentResults: (callback) => ipcRenderer.on('save-agent-results', (_e, data) => callback(data)),
  onNewWindowContext: (callback) => ipcRenderer.on('new-window', (_e, data) => callback(data)),
  onOpenInPaneContext: (callback) => ipcRenderer.on('open-in-pane', (_e, data) => callback(data)),

  /* ─── Profile / Identity ─── */
  profileGet: () => ipcRenderer.invoke('profile-get'),
  profileUpdate: (updates) => ipcRenderer.invoke('profile-update', updates),

  /* ─── Core browser ─── */
  openPrivateWindow: () => ipcRenderer.send('open-private-window'),
  clearBrowsingData: (opts) => ipcRenderer.invoke('clear-browsing-data', opts),
  onOpenExternalUrl: (callback) => ipcRenderer.on('open-external-url', (_e, data) => callback(data)),
  setDefaultBrowser: () => ipcRenderer.invoke('set-default-browser'),
  isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser'),
  listExtensions: () => ipcRenderer.invoke('extensions:list'),

  /* ─── Wallet RPC (proxied through main process) — V2: deferred to next release ─── */
  // walletRPC: (params) => ipcRenderer.invoke('wallet-rpc', params),
  // walletReset: () => ipcRenderer.invoke('wallet-reset'),

  /* ─── IPFS Social Network (Local Helia) ─── */
  ipfsInfo: () => ipcRenderer.invoke('ipfs-info'),
  ipfsConnect: (multiaddr) => ipcRenderer.invoke('ipfs-connect', { multiaddr }),
  ipfsPeers: () => ipcRenderer.invoke('ipfs-peers'),
  ipfsPublish: (content, metadata) => ipcRenderer.invoke('ipfs-publish', { content, metadata }),
  ipfsFeed: () => ipcRenderer.invoke('ipfs-feed'),
  ipfsFeedGlobal: () => ipcRenderer.invoke('ipfs-feed-global'),
  ipfsFollow: (peerId) => ipcRenderer.invoke('ipfs-follow', { peerId }),
  ipfsUnfollow: (peerId) => ipcRenderer.invoke('ipfs-unfollow', { peerId }),
  ipfsUpvote: (cid) => ipcRenderer.invoke('ipfs-upvote', { cid }),
  clusterVote: (cid, direction) => ipcRenderer.invoke('cluster-vote', { cid, direction }),
  clusterGetVotes: (cid) => ipcRenderer.invoke('cluster-get-votes', { cid }),
  clusterPin: (cid) => ipcRenderer.invoke('cluster-pin', { cid }),
  clusterUnpin: (cid) => ipcRenderer.invoke('cluster-unpin', { cid }),
  ipfsGet: (cid) => ipcRenderer.invoke('ipfs-get', { cid }),
  ipfsUnpin: (cid) => ipcRenderer.invoke('ipfs-unpin', { cid }),
  ipfsStorageStats: () => ipcRenderer.invoke('ipfs-storage-stats'),
  ipfsPublishDweb: (name, cid, title, desc) => ipcRenderer.invoke('ipfs-publish-dweb', { name, cid, title, desc }),
  ipfsSearchDweb: (query) => ipcRenderer.invoke('ipfs-search-dweb', { query }),

  /* ─── Cluster membership ─── */
  clusterMyIdentity: () => ipcRenderer.invoke('cluster-my-identity'),
  clusterMembers: () => ipcRenderer.invoke('cluster-members'),
  clusterDiscovered: () => ipcRenderer.invoke('cluster-discovered'),
  clusterSearch: (query) => ipcRenderer.invoke('cluster-search', { query }),
  clusterAdmit: (soulId, displayName) => ipcRenderer.invoke('cluster-admit', { soulId, displayName }),

  /* ─── Device sync (multi-device linking for one Soul) ─── */
  deviceLinkInitiate: (soulId) => ipcRenderer.invoke('device-link-initiate', { soulId }),
  deviceLinkedList: () => ipcRenderer.invoke('device-linked-list'),
  deviceLinkPending: () => ipcRenderer.invoke('device-link-pending'),
  deviceSyncPublish: () => ipcRenderer.invoke('device-sync-publish'),
  deviceSyncPins: () => ipcRenderer.invoke('device-sync-pins'),

  /* Composer attachments — written inside BUCKS_ROOT so the agent's
     sandboxed read_file can open them by path. */
  composerSaveAttachment: (name, dataBase64) =>
    ipcRenderer.invoke('composer-save-attachment', { name, dataBase64 }),
  clusterUpdatePending: () => ipcRenderer.invoke('cluster-update-pending'),
  clusterUpdateApply: () => ipcRenderer.invoke('cluster-update-apply'),
  onClusterUpdateAvailable: (cb) => ipcRenderer.on('cluster-update-available', (_e, manifest) => cb(manifest)),
  onClusterUpdateRestarting: (cb) => ipcRenderer.on('cluster-update-restarting', (_e, manifest) => cb(manifest)),

  /* ─── File Manager API ─── */
  fileManagerGet: () => ipcRenderer.invoke('file-manager-get'),
  fileManagerSave: (data) => ipcRenderer.invoke('file-manager-save', data),
  fileManagerDownload: (cid, name) => ipcRenderer.invoke('file-manager-download', { cid, name }),

  /* ─── Social RPC (proxied through main to port 8000) ─── */
  socialRPC: (params) => ipcRenderer.invoke('social-rpc', params),

  /* ─── P2P Encrypted Chat (Signal over Gossipsub, no server) ─── */
  chatSend: (peerId, text, attachmentCid) => ipcRenderer.invoke('chat-send', { peerId, text, attachmentCid }),
  chatSendFile: (peerId, fileData, filename) => ipcRenderer.invoke('chat-send-file', { peerId, fileData, filename }),
  chatHistory: (peerId) => ipcRenderer.invoke('chat-history', { peerId }),
  chatConversations: () => ipcRenderer.invoke('chat-conversations'),
  chatMarkRead: (peerId) => ipcRenderer.invoke('chat-mark-read', { peerId }),
  chatOwnBundle: () => ipcRenderer.invoke('chat-own-bundle'),
  chatProcessBundle: (peerId, bundle) => ipcRenderer.invoke('chat-process-bundle', { peerId, bundle }),
  chatHasBundle: (peerId) => ipcRenderer.invoke('chat-has-bundle', { peerId }),
  onChatMessage: (callback) => ipcRenderer.on('chat-message', (_e, data) => callback(data)),

  /* ─── Web Intelligence (Agent Browser — proxied through main) ─── */
  webSearch: (query, maxResults) => ipcRenderer.invoke('web-search', { query, maxResults: maxResults || 5 }),
  webFetch: (url, maxChars) => ipcRenderer.invoke('web-fetch', { url, maxChars: maxChars || 4000 }),
  webFetchSummary: (url) => ipcRenderer.invoke('web-fetch-summary', { url }),
  getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
  sendTelemetry: (event, data) => ipcRenderer.send('send-telemetry', { event, data }),
  showWallet: process.env.BUCKS_SHOW_WALLET === '1',

  /* ─── Local model discovery (Soul Engine IPC fallback) ─── */
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  downloadModel: (url, filename) => ipcRenderer.invoke('download-model', { url, filename }),

  /* ─── Soul Engine QNN Swarm ───────────────────────────────────────────────
   * Three channels form the complete query + RL feedback loop:
   *   soulQuery      — send a query; returns response + citations + quality
   *   soulStatus     — get engine health (local/NIM/offline) for the status bar
   *   soulFeedback   — record thumbs-up/down to soul_interactions.jsonl
   * ─────────────────────────────────────────────────────────────────────── */
  soulQuery: (query, sessionId) =>
    ipcRenderer.invoke('soul-query', { query, sessionId: sessionId || null }),

  soulStatus: () =>
    ipcRenderer.invoke('soul-status'),

  soulFeedback: (queryId, rating, correction) =>
    ipcRenderer.invoke('soul-log-feedback', { queryId, rating, correction: correction || null }),

  /* ─── Agentic Interface (AG-UI) ────────────────────────────────────────────
   * agent-interface.js: race mode QNN+NIM, 0.65 quality gate, AG-UI events.
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * Submit a query to the AgentInterface race engine.
   * QNN and NIM run in parallel; QNN wins if quality ≥ 0.65, else NIM overrides.
   * Emits 'agent-event' push events throughout lifecycle.
   */
  agentSubmit: (query, sessionId) =>
    ipcRenderer.invoke('agent-submit', { query, sessionId: sessionId || null }),

  /** Return rolling quality history (last n entries) for sparklines. */
  qualityHistory: (n) =>
    ipcRenderer.invoke('quality-history', { n: n || 20 }),

  /** Return session-level metrics: wins, avg quality, avg latency. */
  agentMetrics: () =>
    ipcRenderer.invoke('agent-metrics'),

  /** Run soul_benchmark.py (20 fixed queries). Returns JSON summary. */
  benchmarkRun: (nimKey) =>
    ipcRenderer.invoke('benchmark-run', { nimKey: nimKey || '' }),

  /** Fast ephemeral look-up for selection/URL overlays (ephemeral-ui.js). */
  ephemeralContext: (text, type) =>
    ipcRenderer.invoke('ephemeral-context', { text, type: type || 'selection' }),

  /**
   * Subscribe to AG-UI push events from agent-interface.js.
   * Events: task.start, task.thinking, task.tool_call, task.result,
   *         task.quality_score, task.nim_override, task.qnn_improving,
   *         task.error, task.complete, nim.stream_start/chunk/end
   * @param {function} cb - Receives event object { type, taskId, ... }
   * @returns {function} Unsubscribe function
   */
  onAgentEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('agent-event', handler);
    return () => ipcRenderer.removeListener('agent-event', handler);
  },

  /* ─── App Store API ─── */
  getApps:           () => ipcRenderer.invoke('app-store-get-apps'),
  launchWebApp:      (appId) => ipcRenderer.invoke('app-store-launch-web', { appId }),
  installApp:        (appId) => ipcRenderer.invoke('app-store-install', { appId }),
  launchLocalApp:    (appId) => ipcRenderer.invoke('app-store-launch-local', { appId }),
  uninstallApp:      (appId) => ipcRenderer.invoke('app-store-uninstall', { appId }),
  closeApp:          () => ipcRenderer.invoke('app-store-close'),
  onInstallProgress: (cb) => ipcRenderer.on('app-install-progress', (_, data) => cb(data)),
};

// ── Project NEXUS — Agentic Interface API ─────────────────────────────────────
const nexusAPI = {
  /**
   * Start an agent goal. Streams typed events back via onStep().
   * @param {string} prompt - The user's natural language goal
   * @param {object} [opts] - { context, agentic, sessionId }
   * @returns {Promise<{ok: boolean, session_id: string}>}
   */
  startGoal: (prompt, opts = {}) =>
    ipcRenderer.invoke('nexus:start-goal', { prompt, ...opts }),

  /**
   * Approve a pending browser action (e.g. browser_click).
   * @param {string} sessionId
   * @param {string} actionId
   */
  approveAction: (sessionId, actionId) =>
    ipcRenderer.invoke('nexus:approve-action', { sessionId, actionId }),

  /**
   * Deny a pending browser action.
   * @param {string} sessionId
   * @param {string} actionId
   */
  denyAction: (sessionId, actionId) =>
    ipcRenderer.invoke('nexus:deny-action', { sessionId, actionId }),

  /**
   * Cancel an in-flight agent session.
   * @param {string} sessionId
   */
  cancelGoal: (sessionId) =>
    ipcRenderer.invoke('nexus:cancel-goal', { sessionId }),

  /** Get swarm peer topology and load status. */
  getSwarmStatus: () => ipcRenderer.invoke('nexus:swarm-status'),

  /** List all persisted goals from the DB. */
  listGoals: () => ipcRenderer.invoke('nexus:list-goals'),

  /** Current Soul Engine lifecycle status (starting/loading/ready/unavailable). */
  soulEngineStatus: () => ipcRenderer.invoke('soul-engine-status'),

  /**
   * Subscribe to Soul Engine status changes pushed from the supervisor.
   * @param {function} cb - Receives { state, model?, provider?, detail? }
   * @returns {function} Unsubscribe function
   */
  onSoulEngineStatus: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('soul-engine-status', handler);
    return () => ipcRenderer.removeListener('soul-engine-status', handler);
  },

  /**
   * Subscribe to typed agent step events.
   * @param {function} cb - Receives a NEXUS step event object
   * @returns {function} Unsubscribe function
   */
  onStep: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('nexus:step', handler);
    return () => ipcRenderer.removeListener('nexus:step', handler);
  },

  /**
   * Subscribe to browser action approval requests.
   * @param {function} cb - Receives { sessionId, actionId, name, args, label }
   * @returns {function} Unsubscribe function
   */
  onApprovalRequired: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('nexus:action-approval-required', handler);
    return () => ipcRenderer.removeListener('nexus:action-approval-required', handler);
  },
};

/* ─── Tab hosting (WebContentsView) ───
   Renderer-side tab placeholders (tab-view.js) drive real Chromium views in
   the main process (tab-manager.js) through this narrow surface. */
const bucksTabs = {
  create: (tabId, url, partition) => ipcRenderer.invoke('tabs:create', { tabId, url, partition }),
  close: (tabId) => ipcRenderer.invoke('tabs:close', { tabId }),
  navigate: (tabId, url) => ipcRenderer.invoke('tabs:navigate', { tabId, url }),
  setBounds: (tabId, bounds) => ipcRenderer.invoke('tabs:setBounds', { tabId, bounds }),
  setVisible: (tabId, visible) => ipcRenderer.invoke('tabs:setVisible', { tabId, visible }),
  setBorderRadius: (tabId, radius) => ipcRenderer.invoke('tabs:setBorderRadius', { tabId, radius }),
  goBack: (tabId) => ipcRenderer.invoke('tabs:goBack', { tabId }),
  goForward: (tabId) => ipcRenderer.invoke('tabs:goForward', { tabId }),
  reload: (tabId) => ipcRenderer.invoke('tabs:reload', { tabId }),
  stop: (tabId) => ipcRenderer.invoke('tabs:stop', { tabId }),
  setZoom: (tabId, factor) => ipcRenderer.invoke('tabs:setZoom', { tabId, factor }),
  print: (tabId) => ipcRenderer.invoke('tabs:print', { tabId }),
  openDevTools: (tabId) => ipcRenderer.invoke('tabs:openDevTools', { tabId }),
  find: (tabId, text, options) => ipcRenderer.invoke('tabs:find', { tabId, text, options }),
  stopFind: (tabId, action) => ipcRenderer.invoke('tabs:stopFind', { tabId, action }),
  execJS: (tabId, code, userGesture) => ipcRenderer.invoke('tabs:execJS', { tabId, code, userGesture }),
  capture: (tabId) => ipcRenderer.invoke('tabs:capture', { tabId }),
  printToPDF: (tabId, title) => ipcRenderer.invoke('tabs:printToPDF', { tabId, title }),
  getURL: (tabId) => ipcRenderer.invoke('tabs:getURL', { tabId }),
  onEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('tabs:event', handler);
    return () => ipcRenderer.removeListener('tabs:event', handler);
  },
  onEphemeralQuery: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('agent:ephemeral-query', handler);
    return () => ipcRenderer.removeListener('agent:ephemeral-query', handler);
  },
};

// STRIDE: Tampering Mitigation - Freeze the APIs to prevent prototype pollution
// Agent document output (doc-factory.js): files land in ~/Documents/Bucks.
const bucksDocs = {
  create: (title, content, format) => ipcRenderer.invoke('docs:create', { title, content, format }),
  createPdf: (title, content) => ipcRenderer.invoke('docs:createPdf', { title, content }),
};

/* ── Bucks Blockchain Node API ─────────────────────────────────────────
   window.bucksBlockchain exposes:
     getStatus()     → NodeStatus
     rpc(method, params) → proxied JSON-RPC result (avoids CORS)
     start()         → manual start
     stop()          → manual stop
     onStatus(cb)    → subscribe to status-push events
     onLog(cb)       → subscribe to streaming log lines
     onBlock(cb)     → subscribe to new-block events
   ────────────────────────────────────────────────── */
const bucksBlockchain = {
  getStatus: () => ipcRenderer.invoke('bucks-node:status'),
  switchEngine: (engineType) => ipcRenderer.invoke('bucks-node:switch-engine', engineType),
  rpc: (method, params) => ipcRenderer.invoke('bucks-node:rpc', { method, params }),
  start: () => ipcRenderer.send('bucks-node:start'),
  stop:  () => ipcRenderer.send('bucks-node:stop'),
  onStatus: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('bucks-node:status-push', h);
    return () => ipcRenderer.removeListener('bucks-node:status-push', h);
  },
  onLog: (cb) => {
    const h = (_e, line) => cb(line);
    ipcRenderer.on('bucks-node:log', h);
    return () => ipcRenderer.removeListener('bucks-node:log', h);
  },
  onBlock: (cb) => {
    const h = (_e, block) => cb(block);
    ipcRenderer.on('bucks-node:block', h);
    return () => ipcRenderer.removeListener('bucks-node:block', h);
  },
};

/* ── Bucks Miner API ─────────────────────────────────────────────────
   window.bucksMiner exposes:
     start({ threads, walletAddress, mode, poolUrl }) → { ok, error? }
     stop()                                          → { ok }
     getStats()                                      → MinerStats
     onStats(cb)     → subscribe to live stats updates (every ~2s)
     onLog(cb)       → subscribe to miner log lines
     onBlock(cb)     → subscribe to block-found events
   ────────────────────────────────────────────────── */
const bucksMiner = {
  start:    (opts) => ipcRenderer.invoke('bucks-miner:start', opts),
  stop:     () => ipcRenderer.invoke('bucks-miner:stop'),
  getStats: () => ipcRenderer.invoke('bucks-miner:stats'),
  onStats:  (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('bucks-miner:stats-push', h);
    return () => ipcRenderer.removeListener('bucks-miner:stats-push', h);
  },
  onLog: (cb) => {
    const h = (_e, line) => cb(line);
    ipcRenderer.on('bucks-miner:log', h);
    return () => ipcRenderer.removeListener('bucks-miner:log', h);
  },
  onBlock: (cb) => {
    const h = (_e, block) => cb(block);
    ipcRenderer.on('bucks-miner:block', h);
    return () => ipcRenderer.removeListener('bucks-miner:block', h);
  },
};

Object.freeze(bucksAPI);
Object.freeze(nexusAPI);
Object.freeze(bucksTabs);
Object.freeze(bucksDocs);
Object.freeze(bucksBlockchain);
Object.freeze(bucksMiner);

contextBridge.exposeInMainWorld('bucksAPI',       bucksAPI);
contextBridge.exposeInMainWorld('nexusAPI',        nexusAPI);
contextBridge.exposeInMainWorld('bucksTabs',       bucksTabs);
contextBridge.exposeInMainWorld('bucksDocs',       bucksDocs);
contextBridge.exposeInMainWorld('bucksBlockchain', bucksBlockchain);
contextBridge.exposeInMainWorld('bucksMiner',      bucksMiner);

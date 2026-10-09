// messages-ui.js — E2E-encrypted P2P Messages view.
// Talks to chat-engine.js in the main process via window.bucksAPI.chat*.
// Delivery is Signal-protocol (X3DH + Double Ratchet) over gossipsub —
// a peer must be online (or reachable through the mesh) to receive.
(function () {
  let ownPeerId = null;
  let ownAddresses = [];
  let activePeer = null;
  let conversations = []; // { peer_id, last_message, timestamp, unread_count, hasSession }
  // Contacts added manually before any message exists (so they show in the list)
  let contacts = [];
  try { contacts = JSON.parse(localStorage.getItem('bucks-msg-contacts') || '[]'); } catch (_) { contacts = []; }

  // DOM
  let listEl, notificationsEl, threadBodyEl, threadTitleEl, threadSessionEl, composerEl, sendBtn,
      attachBtn, fileInput, addPeerInput, addPeerBtn, ownPeerEl, unreadBadge, viewEl;

  const toast = (msg) => (window._showToast ? window._showToast(msg) : console.log('[Messages]', msg));

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  const shortId = (id) => (id && id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id || '?');

  // Get the saved display name for a peer (or use short ID)
  function getPeerName(peerId) {
    if (peerId === ownPeerId) {
      return localStorage.getItem('bucks-profile-name') || 'You';
    }
    try {
      const names = JSON.parse(localStorage.getItem('bucks-peer-names') || '{}');
      if (names[peerId]) return names[peerId];
    } catch (_) {}
    return shortId(peerId);
  }

  function savePeerName(peerId, name) {
    try {
      const names = JSON.parse(localStorage.getItem('bucks-peer-names') || '{}');
      names[peerId] = name;
      localStorage.setItem('bucks-peer-names', JSON.stringify(names));
    } catch (_) {}
  }

  function saveContacts() {
    try { localStorage.setItem('bucks-msg-contacts', JSON.stringify(contacts)); } catch (_) {}
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function init() {
    viewEl = document.getElementById('view-messages');
    listEl = document.getElementById('msg-conversation-list');
    notificationsEl = document.getElementById('msg-notifications-list');
    threadBodyEl = document.getElementById('msg-thread-body');
    threadTitleEl = document.getElementById('msg-thread-title');
    threadSessionEl = document.getElementById('msg-thread-session');
    composerEl = document.getElementById('msg-composer');
    sendBtn = document.getElementById('msg-send-btn');
    attachBtn = document.getElementById('msg-attach-btn');
    fileInput = document.getElementById('msg-file-input');
    addPeerInput = document.getElementById('msg-add-peer-input');
    addPeerBtn = document.getElementById('msg-add-peer-btn');
    ownPeerEl = document.getElementById('msg-own-peer');
    unreadBadge = document.getElementById('messages-unread-badge');
    if (!viewEl) return;

    wireEvents(); // always wire DOM events so buttons are clickable
    renderNotificationsList();

    if (!window.bucksAPI || typeof window.bucksAPI.chatConversations !== 'function') {
      if (ownPeerEl) ownPeerEl.textContent = 'P2P node offline';
      if (listEl) listEl.innerHTML = '<div style="padding:20px; text-align:center; font-size:12px; color:rgba(255,255,255,0.4);">P2P messaging unavailable — node not running.</div>';
      return;
    }

    loadOwnIdentity();
    refreshConversations();

    // Live incoming messages
    window.bucksAPI.onChatMessage(({ peerId, message }) => {
      if (peerId === activePeer && !viewEl.classList.contains('hidden')) {
        appendBubble(message);
        window.bucksAPI.chatMarkRead(peerId);
      }
      refreshConversations();
    });

    window.addEventListener('bucks:app-alert', () => renderNotificationsList());

    // Refresh identity + list while the view is visible
    setInterval(() => {
      if (!viewEl.classList.contains('hidden')) {
        if (!ownPeerId) loadOwnIdentity();
        refreshConversations();
      }
    }, 5000);

    // Instant refresh when switching to the Messages tab
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          if (!viewEl.classList.contains('hidden')) {
            loadOwnIdentity();
            refreshConversations();
          }
        }
      });
    });
    observer.observe(viewEl, { attributes: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function wireEvents() {
    document.querySelectorAll('.msg-view-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.msg-view-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const subview = tab.dataset.subview;
        const isNotifications = subview === 'notifications';
        listEl.classList.toggle('hidden', isNotifications);
        notificationsEl.classList.toggle('hidden', !isNotifications);
        if (isNotifications) renderNotificationsList();
      });
    });

    sendBtn.addEventListener('click', sendCurrent);
    composerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
    });

    attachBtn.addEventListener('click', () => { if (activePeer) fileInput.click(); });
    fileInput.addEventListener('change', async (e) => {
      if (!e.target.files.length || !activePeer) return;
      const file = e.target.files[0];
      fileInput.value = '';
      await sendFileAttachment(file);
    });

    // Drag and drop file support on the thread body
    if (threadBodyEl) {
      threadBodyEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        threadBodyEl.style.outline = '2px dashed var(--accent-ring)';
        threadBodyEl.style.outlineOffset = '-4px';
      });
      threadBodyEl.addEventListener('dragleave', (e) => {
        e.preventDefault();
        threadBodyEl.style.outline = 'none';
      });
      threadBodyEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        threadBodyEl.style.outline = 'none';
        if (!activePeer) { toast('Select a conversation first'); return; }
        if (e.dataTransfer.files.length) {
          await sendFileAttachment(e.dataTransfer.files[0]);
        }
      });
    }

    addPeerBtn.addEventListener('click', addContact);
    addPeerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addContact(); });

    ownPeerEl.addEventListener('click', () => {
      if (ownAddresses && ownAddresses.length > 0) {
        const bestAddr = ownAddresses.find(addr => !addr.includes('127.0.0.1') && !addr.includes('::1')) || ownAddresses[0];
        navigator.clipboard.writeText(bestAddr);
        toast('Your Swarm Address copied — share it with a friend');
      } else if (ownPeerId) {
        navigator.clipboard.writeText(ownPeerId);
        toast('Your PeerID copied (no swarm address available)');
      }
    });
  }

  async function sendFileAttachment(file) {
    if (!activePeer) return;
    const maxSize = 50 * 1024 * 1024; // 50 MB
    if (file.size > maxSize) {
      toast(`File too large (${formatFileSize(file.size)}). Max: 50 MB`);
      return;
    }

    // Show sending indicator
    const indicator = document.createElement('div');
    indicator.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:10px; background:var(--accent-soft); border:1px solid var(--accent-ring); margin:4px 0; align-self:flex-end;';
    indicator.innerHTML = `<span style="font-size:11px; color:rgba(255,255,255,0.7);">Sending ${escapeHtml(file.name)} (${formatFileSize(file.size)})…</span><span style="width:14px; height:14px; border:2px solid var(--accent-ring); border-top-color:var(--accent); border-radius:50%; display:inline-block; animation:spin 0.8s linear infinite;"></span>`;
    threadBodyEl.appendChild(indicator);
    threadBodyEl.scrollTop = threadBodyEl.scrollHeight;

    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const res = await window.bucksAPI.chatSendFile(activePeer, bytes, file.name);
      indicator.remove();
      if (res.success) {
        toast(`File sent: ${file.name}`);
        openThread(activePeer);
      } else {
        toast('File send failed: ' + (res.error || 'unknown'));
      }
    } catch (err) {
      indicator.remove();
      toast('File send failed: ' + err.message);
    }
  }

  async function loadOwnIdentity() {
    try {
      const info = await window.bucksAPI.ipfsInfo();
      if (info && info.peerId) {
        ownPeerId = info.peerId;
        ownAddresses = info.addresses || [];
        const myName = localStorage.getItem('bucks-profile-name') || 'You';
        // ownPeerEl is now a <code> chip — just show name · short ID
        ownPeerEl.innerHTML =
          `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="opacity:0.6;flex-shrink:0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>` +
          `<span style="font-weight:600;color:rgba(255,255,255,0.75);">${escapeHtml(myName)}</span>` +
          `<span style="opacity:0.45">·</span>` +
          `<span title="${escapeHtml(ownPeerId)}">${shortId(ownPeerId)}</span>`;
      }
    } catch (_) {}
  }

  async function addContact() {
    const inputVal = addPeerInput.value.trim();
    if (!inputVal) return;

    let peerId = inputVal;
    let isMultiaddr = false;

    if (inputVal.includes('/p2p/')) {
      peerId = inputVal.split('/p2p/')[1].split('/')[0];
      isMultiaddr = true;
    }

    if (peerId === ownPeerId) { toast("That's your own PeerID"); return; }
    if (peerId.length < 20) { toast('That does not look like a PeerID'); return; }

    if (isMultiaddr) {
      toast('Connecting to peer swarm address…');
      window.bucksAPI.ipfsConnect(inputVal).then(res => {
        if (res && res.success) {
          toast('Connected to peer swarm! Exchange of key bundles in progress…');
        } else {
          toast('Swarm connection failed: ' + (res.error || 'unknown'));
        }
      }).catch(err => {
        toast('Swarm connection error: ' + err.message);
      });
    }

    if (!contacts.includes(peerId)) {
      contacts.push(peerId);
      saveContacts();
    }
    addPeerInput.value = '';
    await refreshConversations();
    openThread(peerId);
  }

  async function refreshConversations() {
    try {
      const res = await window.bucksAPI.chatConversations();
      conversations = (res && res.conversations) || [];
    } catch (_) {
      conversations = [];
    }

    // Merge in manually-added contacts that have no messages yet
    const known = new Set(conversations.map((c) => c.peer_id));
    for (const id of contacts) {
      if (!known.has(id)) {
        conversations.push({ peer_id: id, last_message: 'No messages yet', timestamp: '', unread_count: 0, hasSession: false });
      }
    }

    renderList();
    updateBadge();
  }

  function renderList() {
    if (!conversations.length) {
      listEl.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; padding:30px 16px; text-align:center;">
          <div style="font-size:36px; margin-bottom:10px;">•</div>
          <p style="font-size:12px; color:rgba(255,255,255,0.5); margin:0;">No conversations yet.</p>
          <p style="font-size:11px; color:rgba(255,255,255,0.35); margin:4px 0 0;">Paste a friend's PeerID above to start chatting.</p>
        </div>`;
      return;
    }
    listEl.innerHTML = conversations.map((c) => {
      const time = c.timestamp ? new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const active = c.peer_id === activePeer;
      const peerName = getPeerName(c.peer_id);
      const sessionIcon = c.hasSession ? 'Encrypted' : 'Pending';
      return `
        <div class="msg-conv-item" data-peer="${escapeHtml(c.peer_id)}" role="button" tabindex="0" aria-label="${escapeHtml(peerName)} conversation" style="display:flex; flex-direction:column; gap:2px; padding:10px 12px; border-radius:12px; cursor:pointer; background:${active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.04)'}; border:1px solid rgba(255,255,255,${active ? '0.22' : '0.06'}); transition:background 0.15s;">
          <div style="display:flex; align-items:center; gap:6px;">
            <div style="width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg, var(--accent)55, var(--accent)55); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:rgba(255,255,255,0.8); flex-shrink:0;">${escapeHtml(peerName.charAt(0).toUpperCase())}</div>
            <span style="font-size:12px; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(peerName)}</span>
            ${c.unread_count ? `<span style="min-width:16px; height:16px; border-radius:8px; background:#ff4757; color:#fff; font-size:10px; font-weight:700; line-height:16px; text-align:center; padding:0 4px;">${c.unread_count}</span>` : ''}
            <span style="font-size:10px; color:rgba(255,255,255,0.45);">${time}</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px; padding-left:34px;">
            <span style="font-size:9px;">${sessionIcon}</span>
            <span style="font-size:11px; color:rgba(255,255,255,0.45); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(c.last_message || '')}</span>
          </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.msg-conv-item').forEach((el) => {
      el.addEventListener('click', () => openThread(el.dataset.peer));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(el.dataset.peer); }
      });
    });
  }

  function renderNotificationsList() {
    if (!notificationsEl) return;
    let alerts = [];
    try {
      alerts = JSON.parse(localStorage.getItem('bucks-app-alerts') || '[]');
    } catch (_) {}

    if (!alerts.length) {
      notificationsEl.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; padding:30px 16px; text-align:center;">
          <div style="font-size:36px; margin-bottom:10px;">•</div>
          <p style="font-size:12px; color:rgba(255,255,255,0.5); margin:0;">No notifications yet.</p>
          <p style="font-size:11px; color:rgba(255,255,255,0.35); margin:4px 0 0;">System alerts and status updates will appear here.</p>
        </div>`;
      return;
    }

    notificationsEl.innerHTML = alerts.map((alert) => {
      const type = alert.type || 'info';
      const when = new Date(alert.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="msg-notification-item" style="display:flex; gap:8px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
          <span class="msg-notification-dot" style="width:8px; height:8px; border-radius:50%; background:${type === 'error' ? '#ff6b6b' : type === 'success' ? '#42d392' : '#8ab4ff'}; margin-top:4px; flex-shrink:0;"></span>
          <div style="min-width:0; flex:1;">
            <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.92);">${escapeHtml(alert.text || '')}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.45); margin-top:4px;">${when}</div>
          </div>
        </div>`;
    }).join('');
  }

  function updateBadge() {
    if (!unreadBadge) return;
    const total = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
    unreadBadge.style.display = total > 0 ? 'block' : 'none';
    unreadBadge.textContent = total > 99 ? '99+' : String(total);
  }

  async function openThread(peerId) {
    activePeer = peerId;
    composerEl.disabled = false;
    sendBtn.disabled = false;

    const peerName = getPeerName(peerId);
    threadTitleEl.innerHTML = `
      <span style="font-weight:700;">${escapeHtml(peerName)}</span>
      <span style="font-size:10px; color:rgba(255,255,255,0.4); margin-left:6px;" title="${escapeHtml(peerId)}">${shortId(peerId)}</span>`;

    let data = { history: [], hasSession: false };
    try { data = await window.bucksAPI.chatHistory(peerId); } catch (_) {}
    try { await window.bucksAPI.chatMarkRead(peerId); } catch (_) {}

    // Session / reachability status
    let status = '';
    if (data.hasSession) {
      status = 'Encrypted session active';
      if (data.sessionInfo) {
        status += ` · ${data.sessionInfo.messagesSent || 0} sent · ${data.sessionInfo.messagesReceived || 0} received`;
      }
    } else {
      let hasBundle = false;
      try { hasBundle = await window.bucksAPI.chatHasBundle(peerId); } catch (_) {}
      status = hasBundle
        ? 'Key bundle received — session starts with your first message'
        : 'Waiting for peer to come online (no key bundle yet)';
    }
    threadSessionEl.textContent = status;

    threadBodyEl.innerHTML = '';
    if (!data.history.length) {
      threadBodyEl.innerHTML = `
        <div style="margin:auto; text-align:center; padding:40px 20px;">
          <div style="font-size:48px; margin-bottom:12px;">•</div>
          <p style="font-size:13px; color:rgba(255,255,255,0.6); margin:0;">No messages yet — say hi!</p>
          <p style="font-size:11px; color:rgba(255,255,255,0.35); margin:6px 0 0;">Messages are end-to-end encrypted.<br/>You can also drag & drop files here to share them.</p>
        </div>`;
    } else {
      // Group messages by date
      let lastDate = '';
      data.history.forEach((msg) => {
        if (msg.timestamp) {
          const date = new Date(msg.timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          if (date !== lastDate) {
            lastDate = date;
            const dateSep = document.createElement('div');
            dateSep.style.cssText = 'text-align:center; padding:8px 0; font-size:10px; color:rgba(255,255,255,0.35); font-weight:600; letter-spacing:0.5px;';
            dateSep.textContent = date;
            threadBodyEl.appendChild(dateSep);
          }
        }
        appendBubble(msg);
      });
    }
    threadBodyEl.scrollTop = threadBodyEl.scrollHeight;
    renderList();
    updateBadge();
    composerEl.focus();
  }

  function appendBubble(message) {
    const empty = threadBodyEl.querySelector('div[style*="margin:auto"]');
    if (empty) empty.remove();

    const mine = message.sender === ownPeerId;
    const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex; flex-direction:column; align-items:${mine ? 'flex-end' : 'flex-start'}; max-width:100%;`;

    let attachmentHtml = '';
    if (message.cid) {
      const fname = (message.text || '').replace(/^\s*Attachment\s*/i, '') || 'attachment';
      attachmentHtml = `
        <div class="msg-attachment" data-cid="${escapeHtml(message.cid)}" data-name="${escapeHtml(fname)}" style="margin-top:6px; display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; background:rgba(255,255,255,0.08); cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7ec8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span style="font-size:11px; color:#7ec8ff;">${escapeHtml(fname)}</span>
        </div>`;
    }

    const senderLabel = mine ? '' : `<div style="font-size:10px; font-weight:600; color:rgba(255,255,255,0.5); margin-bottom:3px;">${escapeHtml(getPeerName(message.sender))}</div>`;

    wrap.innerHTML = `
      ${senderLabel}
      <div style="max-width:70%; padding:9px 13px; border-radius:${mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px'}; background:${mine ? 'linear-gradient(135deg,#3a6df0,#5a4fd0)' : 'rgba(255,255,255,0.09)'}; border:1px solid rgba(255,255,255,0.1); font-size:13px; word-break:break-word;">
        ${escapeHtml(message.text || '')}
        ${attachmentHtml}
      </div>
      <span style="font-size:9px; color:rgba(255,255,255,0.4); margin-top:2px;">${time}${message.encrypted ? ' · encrypted' : ''}</span>`;

    const att = wrap.querySelector('.msg-attachment');
    if (att) {
      att.addEventListener('click', async () => {
        att.style.opacity = '0.5';
        toast('Fetching from IPFS…');
        try {
          const res = await window.bucksAPI.fileManagerDownload(att.dataset.cid, att.dataset.name);
          if (res.success) toast('Saved: ' + res.filePath);
          else if (!res.canceled) toast('Download failed: ' + (res.error || 'unknown'));
        } catch (err) {
          toast('Download failed: ' + err.message);
        }
        att.style.opacity = '1';
      });
    }

    threadBodyEl.appendChild(wrap);
    threadBodyEl.scrollTop = threadBodyEl.scrollHeight;
  }

  async function sendCurrent() {
    const text = composerEl.value.trim();
    if (!text || !activePeer) return;
    composerEl.value = '';
    sendBtn.disabled = true;

    try {
      const res = await window.bucksAPI.chatSend(activePeer, text, null);
      if (res.success) {
        appendBubble({ sender: ownPeerId, text, timestamp: new Date().toISOString(), encrypted: true });
        threadSessionEl.textContent = 'Encrypted session active';
        refreshConversations();
      } else {
        composerEl.value = text; // give the draft back
        toast('Not delivered: ' + (res.error || 'unknown'));
      }
    } catch (err) {
      composerEl.value = text;
      toast('Send failed: ' + err.message);
    }
    sendBtn.disabled = false;
  }
})();

/* ============================================================================
   BUCKS A2UI — AGENTIC CHAT COMPOSER
   ----------------------------------------------------------------------------
   The full-page chat view (#view-chat-tab) shipped without a composer: renderer.js
   wires #chat-tab-input / #chat-tab-send / #chat-tab-stop in wireChatTab(), but
   those elements existed nowhere in index.html, so every listener bound to null
   and the view was a read-only pane you could not type into.

   This module builds that missing surface and three things around it:

     1. The composer      — textarea, send, stop, attachments, skill chips.
     2. The trace rail    — what the agent is doing right now, step by step.
     3. The source rail   — every web origin and IPFS CID the turn actually used.

   INTEGRATION CONTRACT — this file adds, it does not replace. renderer.js still
   owns sending, streaming, threading, and A2UI component rendering. We only:
     · create the DOM it already expects, synchronously at parse time so that
       wireChatTab() (which runs on DOMContentLoaded, strictly later) binds to
       real elements;
     · register our own listeners FIRST, so attachment references are folded
       into the textarea before renderer.js reads its value;
     · observe the message list to derive the trace and source rails.

   Nothing here calls into renderer.js internals — they live inside an IIFE and
   are deliberately not reachable. That keeps this module safe against changes
   on the other side of the boundary.
   ========================================================================== */

(function () {
  'use strict';

  const SOUL_ENGINE = 'http://127.0.0.1:8765';

  /* A CIDv0 (Qm…, 46 chars) or a CIDv1 (bafy…/bafk… base32). Deliberately
     anchored on the known prefixes rather than a generic base58/base32 match,
     which would light up on ordinary words and hex digests. */
  const CID_RE = /\b(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{57,})\b/g;
  const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;

  /* Skill chips. Each maps to a slash command renderer.js already routes in
     sendChatTab() — we only prefill the box, we never invent an endpoint. */
  const CHIPS = [
    { cmd: '/research ',  label: 'Research',  hint: 'Multi-source dossier with sources & images' },
    { cmd: '/search ',    label: 'Web',       hint: 'Search the web and synthesize' },
    { cmd: '/images ',    label: 'Images',    hint: 'Image gallery with lightbox' },
    { cmd: '/video ',     label: 'Video',     hint: 'Search YouTube and play inline' },
    { cmd: '/weather ',   label: 'Weather',   hint: 'Current conditions + forecast' },
    { cmd: '/summarize ', label: 'Summarize', hint: 'Read and condense a page' },
    { cmd: '/agent ',     label: 'Agent',     hint: 'Autonomous multi-step task' },
  ];

  const ICON = {
    send:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
    stop:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    attach: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    cube:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l8.66 5v10L12 22 3.34 17V7z"/><path d="M12 22V12M3.34 7L12 12l8.66-5"/></svg>',
    spark:  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l1.7 4.6 4.6 1.7-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7z"/></svg>',
    link:   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  };

  /* Files and CIDs staged for the next message. Kept local to this module —
     renderer.js has its own tray for the new-tab composer and the two must not
     share state, or attaching in one surface would leak into the other. */
  const attachments = [];

  let els = null;          // resolved composer elements
  let suppressObserver = false;  // guards our own DOM writes from re-triggering us

  /* ── Utilities ─────────────────────────────────────────────────────────── */

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function shortCid(cid) {
    return cid.length > 16 ? cid.slice(0, 8) + '…' + cid.slice(-4) : cid;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (_) { return url.slice(0, 40); }
  }

  /* ── 1. Composer construction ──────────────────────────────────────────── */

  function buildComposer(view) {
    const dock = document.createElement('div');
    dock.className = 'a2ui-composer-dock';
    dock.id = 'a2ui-composer-dock';

    dock.innerHTML = `
      <div class="a2ui-trace" id="a2ui-trace" aria-live="polite">
        <div class="a2ui-trace-head">${ICON.spark} Agent activity</div>
        <div id="a2ui-trace-steps"></div>
      </div>

      <div class="a2ui-chips" id="a2ui-chips">
        ${CHIPS.map(c => `
          <button type="button" class="a2ui-chip" data-cmd="${esc(c.cmd)}" title="${esc(c.hint)}">
            ${ICON.spark}${esc(c.label)}
          </button>`).join('')}
        <span class="a2ui-conn" id="a2ui-conn" data-state="unknown" title="Soul Engine connection">
          <span class="a2ui-conn-dot"></span><span id="a2ui-conn-label">checking…</span>
        </span>
      </div>

      <div class="a2ui-composer">
        <div class="a2ui-tray" id="a2ui-tray"></div>
        <div class="a2ui-composer-row">
          <textarea id="chat-tab-input" rows="1"
                    placeholder="Ask anything — or attach a CID and let the agent read it from IPFS"
                    aria-label="Message the Bucks agent"></textarea>
          <input type="file" id="a2ui-file-input" multiple style="display:none" />
          <button type="button" class="a2ui-btn" id="a2ui-attach"
                  title="Attach files, or paste an IPFS CID">${ICON.attach}</button>
          <button type="button" class="a2ui-btn a2ui-hidden" id="chat-tab-stop"
                  title="Stop the running task">${ICON.stop} Stop</button>
          <button type="button" class="a2ui-btn" id="chat-tab-send"
                  title="Send (Enter · Shift+Enter for a newline)">${ICON.send}</button>
        </div>
      </div>
    `;

    /* The dock is a sibling of the message list inside the chat column, so the
       list keeps its own scroll and the composer stays pinned at the bottom. */
    const messages = view.querySelector('#chat-tab-messages');
    if (messages && messages.parentElement) {
      messages.parentElement.appendChild(dock);
      /* index.html reserves 120px of bottom padding for a composer that was
         never there. Now that one exists, hand that space back to the thread. */
      messages.style.paddingBottom = '16px';
    } else {
      view.appendChild(dock);
    }

    return {
      dock,
      input:   dock.querySelector('#chat-tab-input'),
      send:    dock.querySelector('#chat-tab-send'),
      stop:    dock.querySelector('#chat-tab-stop'),
      attach:  dock.querySelector('#a2ui-attach'),
      file:    dock.querySelector('#a2ui-file-input'),
      tray:    dock.querySelector('#a2ui-tray'),
      chips:   dock.querySelector('#a2ui-chips'),
      trace:   dock.querySelector('#a2ui-trace'),
      steps:   dock.querySelector('#a2ui-trace-steps'),
      conn:    dock.querySelector('#a2ui-conn'),
      connLbl: dock.querySelector('#a2ui-conn-label'),
      messages,
    };
  }

  /* ── 2. Attachments ────────────────────────────────────────────────────── */

  function renderTray() {
    if (!els) return;
    els.tray.classList.toggle('has-items', attachments.length > 0);
    els.tray.innerHTML = '';
    attachments.forEach((att, i) => {
      const pill = document.createElement('div');
      pill.className = 'a2ui-pill' + (att.kind === 'cid' ? ' a2ui-pill--cid' : '');
      pill.innerHTML = `
        ${att.kind === 'cid' ? ICON.cube : ''}
        <span class="a2ui-pill-label" title="${esc(att.kind === 'cid' ? att.cid : att.name)}">${esc(att.kind === 'cid' ? shortCid(att.cid) : att.name)}</span>
        <button type="button" class="a2ui-pill-x" data-i="${i}" aria-label="Remove attachment">×</button>`;
      els.tray.appendChild(pill);
    });
    els.tray.querySelectorAll('.a2ui-pill-x').forEach(btn => {
      btn.addEventListener('click', () => {
        attachments.splice(Number(btn.dataset.i), 1);
        renderTray();
        syncSend();
      });
    });
  }

  function addCid(raw) {
    const cid = String(raw || '').trim().replace(/^ipfs:\/\//i, '').split(/[\/?#]/)[0];
    CID_RE.lastIndex = 0;
    if (!CID_RE.test(cid)) return false;
    if (attachments.some(a => a.kind === 'cid' && a.cid === cid)) return true;
    attachments.push({ kind: 'cid', cid });
    renderTray();
    syncSend();
    return true;
  }

  async function addFiles(list) {
    for (const f of Array.from(list || [])) {
      if (attachments.length >= 8) break;
      const att = { kind: 'file', name: f.name, size: f.size, mime: f.type || '' };
      /* Only text-ish files get an inline excerpt; binaries are referenced by
         name so the agent can ask for them rather than us dumping bytes into
         an 8k context window. */
      if (/^text\/|json|javascript|xml|csv|markdown/.test(f.type) || /\.(md|txt|json|js|ts|py|csv|yml|yaml)$/i.test(f.name)) {
        try { att.text = (await f.text()).slice(0, 600); } catch (_) {}
      }
      attachments.push(att);
    }
    renderTray();
    syncSend();
  }

  /* Fold staged attachments into the outgoing text, using the same phrasing
     renderer.js's composerDecorate() uses for the new-tab composer — the agent
     gets one consistent instruction format regardless of entry surface. */
  function decorate(text) {
    if (!attachments.length) return text;
    const parts = [text];
    const cids = attachments.filter(a => a.kind === 'cid');
    const files = attachments.filter(a => a.kind === 'file');

    if (cids.length) {
      parts.push('\n\nAttached IPFS content — call ipfs_cat_text on each CID to read it. Do NOT guess the contents:');
      cids.forEach(c => parts.push(`- ${c.cid}`));
    }
    if (files.length) {
      parts.push('\n\nAttached files:');
      files.forEach(f => {
        parts.push(`- ${f.name} [${f.mime || 'unknown type'}, ${fmtSize(f.size)}]`);
        if (f.text) parts.push(`  First lines of ${f.name}:\n  ${f.text.replace(/\n/g, '\n  ')}`);
      });
    }
    return parts.join('\n');
  }

  function syncSend() {
    if (!els) return;
    const ready = !!els.input.value.trim() || attachments.length > 0;
    els.send.classList.toggle('is-ready', ready);
  }

  /* ── 3. Listeners ──────────────────────────────────────────────────────── */

  /* Registered synchronously at parse time, which puts them ahead of the
     listeners wireChatTab() adds on DOMContentLoaded. Ordering matters: ours
     must fold attachments into input.value BEFORE renderer.js reads it. */
  function wire() {
    const { input, send, attach, file, chips } = els;

    function foldAttachments() {
      if (!attachments.length) return;
      input.value = decorate(input.value);
      attachments.length = 0;
      renderTray();
      /* Send is about to fire and clear the box; keep the ready state honest
         in the window before that happens. */
      requestAnimationFrame(syncSend);
    }

    send.addEventListener('click', foldAttachments);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        /* Let the slash-command dropdown claim Enter first — renderer.js checks
           for it too, and folding here would corrupt a command completion. */
        const row = input.closest('div');
        if (row && row.querySelector('.command-suggestions-dropdown')) return;
        foldAttachments();
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      syncSend();
    });

    /* Pasting a bare CID stages it as an attachment instead of dropping an
       opaque 46-character string into the prompt. */
    input.addEventListener('paste', (e) => {
      const t = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      const trimmed = t.trim();
      CID_RE.lastIndex = 0;
      if (trimmed && !/\s/.test(trimmed) && CID_RE.test(trimmed.replace(/^ipfs:\/\//i, ''))) {
        e.preventDefault();
        addCid(trimmed);
      }
    });

    attach.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { addFiles(file.files); file.value = ''; });

    /* Drag-and-drop onto the composer. */
    const shell = els.dock.querySelector('.a2ui-composer');
    ['dragover', 'drop'].forEach(evt => {
      shell.addEventListener(evt, (e) => {
        e.preventDefault();
        if (evt === 'drop') {
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          else {
            const t = e.dataTransfer.getData('text');
            if (t) addCid(t);
          }
        }
      });
    });

    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.a2ui-chip');
      if (!chip) return;
      const cmd = chip.dataset.cmd;
      /* Replace an existing leading slash command rather than stacking them. */
      input.value = cmd + input.value.replace(/^\/[a-z-]+\s*/i, '');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      syncSend();
    });
  }

  /* ── 4. Trace rail ─────────────────────────────────────────────────────── */

  /* renderer.js reports agent activity through a single transient element
     (#chat-tab-agent-status) that it overwrites on every step, so only the
     latest line is ever visible and the history of the turn is lost. We watch
     that element and accumulate its distinct values into a persistent rail. */

  let traceSteps = [];

  function pushTrace(text) {
    const clean = String(text || '').replace(/^⋯\s*/, '').trim();
    if (!clean) return;
    if (traceSteps[traceSteps.length - 1] === clean) return;
    traceSteps.push(clean);
    if (traceSteps.length > 40) traceSteps.shift();
    renderTrace();
  }

  function renderTrace() {
    if (!els) return;
    if (!traceSteps.length) {
      els.trace.classList.remove('is-active');
      els.steps.innerHTML = '';
      return;
    }
    els.trace.classList.add('is-active');
    els.steps.innerHTML = traceSteps.map(s =>
      `<div class="a2ui-trace-step"><span class="a2ui-trace-dot"></span><span>${esc(s)}</span></div>`
    ).join('');
    els.steps.scrollTop = els.steps.scrollHeight;
    els.trace.scrollTop = els.trace.scrollHeight;
  }

  function clearTrace() {
    traceSteps = [];
    renderTrace();
  }

  function setBusy(busy) {
    if (!els) return;
    els.stop.classList.toggle('a2ui-hidden', !busy);
    setConn(busy ? 'busy' : (lastConnState === 'busy' ? 'online' : lastConnState), busy ? 'working' : null);
  }

  /* ── 5. Source rail ────────────────────────────────────────────────────── */

  /* Collects every citation in the most recent assistant turn — HTTP origins
     from the answer and any rendered A2UI component, plus IPFS CIDs — and
     renders one rail beneath it. Sources are the point of an agentic answer;
     without this they stay buried in prose. */

  function collectSources(view) {
    const kids = Array.from(view.children);
    const turn = [];
    /* Walk backwards to the start of the trailing assistant run. */
    for (let i = kids.length - 1; i >= 0; i--) {
      const el = kids[i];
      if (el.id === 'a2ui-source-rail' || el.id === 'chat-tab-agent-status') continue;
      /* A user bubble is right-aligned — that marks the boundary of this turn. */
      if (el.style && el.style.alignItems === 'flex-end') break;
      turn.unshift(el);
    }
    if (!turn.length) return [];

    const seen = new Set();
    const out = [];

    turn.forEach(el => {
      /* Anchors rendered by formatNexusAnswer carry their target in the
         onclick handler, not in href (href is "#"), so read it from there. */
      el.querySelectorAll('a').forEach(a => {
        const oc = a.getAttribute('onclick') || '';
        const m = oc.match(/openAgentLink\((['"])(.*?)\1\)/);
        const url = m ? m[2] : (a.getAttribute('href') || '');
        if (/^https?:\/\//i.test(url)) addSource(out, seen, url);
        else if (/^ipfs:\/\//i.test(url)) addSource(out, seen, url);
      });
      /* Component cards store their target on data attributes rather than
         anchors, and plain prose can cite a bare URL or CID. */
      el.querySelectorAll('[data-url]').forEach(n => {
        const u = n.getAttribute('data-url');
        if (/^https?:\/\//i.test(u)) addSource(out, seen, u);
      });
      const text = el.textContent || '';
      (text.match(URL_RE) || []).forEach(u => addSource(out, seen, u.replace(/[.,);]+$/, '')));
      (text.match(CID_RE) || []).forEach(c => addSource(out, seen, 'ipfs://' + c));
    });

    return out.slice(0, 12);
  }

  function addSource(out, seen, url) {
    const isIpfs = /^ipfs:\/\//i.test(url);
    /* Dedupe web sources per-origin so ten pages of one site read as one
       source, but keep every CID distinct — each is a different document. */
    const key = isIpfs ? url : hostOf(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ url, isIpfs, label: isIpfs ? shortCid(url.replace(/^ipfs:\/\//i, '')) : hostOf(url) });
  }

  function renderSourceRail(view) {
    const existing = view.querySelector('#a2ui-source-rail');
    const sources = collectSources(view);

    if (!sources.length) {
      if (existing) existing.remove();
      return;
    }

    const ipfsCount = sources.filter(s => s.isIpfs).length;
    const webCount = sources.length - ipfsCount;
    const summary = [
      webCount ? `${webCount} web` : '',
      ipfsCount ? `${ipfsCount} IPFS` : '',
    ].filter(Boolean).join(' · ');

    const rail = existing || document.createElement('div');
    rail.id = 'a2ui-source-rail';
    rail.className = 'a2ui-sources';
    rail.innerHTML = `
      <div class="a2ui-sources-head">
        ${ICON.link} Sources <span class="a2ui-sources-count">${esc(summary)}</span>
      </div>
      <div class="a2ui-sources-list">
        ${sources.map((s, i) => `
          <a class="a2ui-source${s.isIpfs ? ' a2ui-source--ipfs' : ''}"
             data-open="${esc(s.url)}" title="${esc(s.url)}">
            <span class="a2ui-source-idx">${i + 1}</span>
            <span class="a2ui-source-label">${esc(s.label)}</span>
          </a>`).join('')}
      </div>`;

    if (!existing) view.appendChild(rail);

    rail.querySelectorAll('[data-open]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const url = a.getAttribute('data-open');
        /* normalizeURL() in renderer.js already understands ipfs:// and
           upgrades CIDv0 to CIDv1, so both kinds go through one path. */
        if (typeof window.openAgentLink === 'function') window.openAgentLink(url);
      });
    });
  }

  /* ── 6. Observing the thread ───────────────────────────────────────────── */

  /* renderChatTabMessages() rewrites the list's innerHTML on every streamed
     token, which wipes anything we append. Rather than fight that, we re-derive
     our rails after each render, debounced so we run once per burst. */

  function observe(view) {
    let timer = null;
    const mo = new MutationObserver(() => {
      if (suppressObserver) return;

      /* Pick up the status line renderer.js writes, before the next render
         replaces it. */
      const status = view.querySelector('#chat-tab-agent-status');
      if (status) {
        pushTrace(status.textContent);
        setBusy(true);
      }

      clearTimeout(timer);
      timer = setTimeout(() => {
        suppressObserver = true;
        try {
          /* renderChatTabMessages() rebuilds the list's innerHTML on every
             streamed token, which destroys anything appended to it. Rendering
             the rail on each burst made it flash in and out for the whole turn,
             so build it only once the turn has settled — a live answer has no
             stable source set to show anyway. */
          const streaming = !!view.querySelector('#chat-tab-agent-status');
          if (streaming) {
            view.querySelector('#a2ui-source-rail')?.remove();
          } else {
            renderSourceRail(view);
            setBusy(false);
            if (traceSteps.length) setTimeout(clearTrace, 2500);
          }
        } catch (err) {
          console.error('[A2UI] rail update failed:', err);
        } finally {
          /* Release on the next frame so our own writes have flushed through
             the observer queue before we start listening again. */
          requestAnimationFrame(() => { suppressObserver = false; });
        }
      }, 220);
    });

    mo.observe(view, { childList: true, subtree: true, characterData: true });
  }

  /* ── 6b. Chrome de-confliction ─────────────────────────────────────────── */

  /* Two things sat on top of this view:
     · #global-agent-dock — a position:fixed bar at z-index 9000. It was the
       chat tab's stand-in composer (showDashboardView swaps its placeholder to
       "Message the agent…"), but it is a single-line bar with no attachments,
       no skill chips and no stop control. Now that a real composer exists it is
       a duplicate input floating over the real one, so it is hidden here — and
       restored on the way out, because every other view still uses it.
     · .top-bar-container — the browser chrome (z-index 100). #view-chat-tab is
       inset:0 against .app-container, so its header rendered underneath the URL
       bar. Offset the view to start below the chrome instead of guessing a
       constant, so it stays correct if the chrome's height ever changes. */

  /* Every fullscreen dashboard view is inset:0 against .app-container, which
     starts at the top of the window — above the browser chrome. Left alone,
     each one renders its header underneath the URL bar. Measuring the chrome
     rather than hardcoding a constant keeps this correct across window sizes
     and any future change to the chrome's height. */
  const FULLSCREEN_VIEWS = ['view-chat-tab', 'view-messages', 'view-files', 'view-studio'];

  function offsetBelowChrome(view) {
    const chrome = document.querySelector('.top-bar-container');
    if (!chrome) return;
    const bottom = Math.round(chrome.getBoundingClientRect().bottom);
    if (bottom <= 0 || bottom >= 240) return;   // chrome not laid out yet
    view.style.top = bottom + 'px';
    /* inset:0 pinned top AND bottom; re-pin bottom and drop any inline height
       so the view still reaches the window bottom after being pushed down. */
    view.style.bottom = '0';
    view.style.height = 'auto';
  }

  function syncChrome(view) {
    const visible = !view.classList.contains('hidden');
    const dock = document.getElementById('global-agent-dock');

    /* The dock is only a duplicate composer on the chat tab; the Messages and
       other views have no composer of their own and still want it. */
    if (dock && view.id === 'view-chat-tab') {
      if (visible) {
        if (dock.dataset.a2uiPrevDisplay === undefined) {
          dock.dataset.a2uiPrevDisplay = dock.style.display || '';
        }
        dock.style.display = 'none';
      } else if (dock.dataset.a2uiPrevDisplay !== undefined) {
        dock.style.display = dock.dataset.a2uiPrevDisplay;
        delete dock.dataset.a2uiPrevDisplay;
      }
    }

    if (visible) offsetBelowChrome(view);
  }

  function watchChrome() {
    const views = FULLSCREEN_VIEWS
      .map(id => document.getElementById(id))
      .filter(Boolean);

    views.forEach(view => {
      syncChrome(view);
      new MutationObserver(() => syncChrome(view))
        .observe(view, { attributes: true, attributeFilter: ['class'] });
    });

    window.addEventListener('resize', () => views.forEach(syncChrome));
  }

  /* ── 7. Connection status ──────────────────────────────────────────────── */

  let lastConnState = 'unknown';

  function setConn(state, label) {
    if (!els) return;
    if (state !== 'busy') lastConnState = state;
    els.conn.dataset.state = state;
    els.connLbl.textContent = label || (
      state === 'online' ? 'engine online' :
      state === 'offline' ? 'engine offline' :
      state === 'busy' ? 'working' : 'checking…'
    );
  }

  async function pollHealth() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(`${SOUL_ENGINE}/health`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setConn('online', data.model ? `${data.model}` : 'engine online');
    } catch (_) {
      setConn('offline');
    }
  }

  /* ── 8. Boot ───────────────────────────────────────────────────────────── */

  function init() {
    const view = document.getElementById('view-chat-tab');
    if (!view) {
      console.warn('[A2UI] #view-chat-tab not found — composer not installed.');
      return;
    }
    if (document.getElementById('chat-tab-input')) return;  // already installed

    els = buildComposer(view);
    if (!els.input) {
      console.error('[A2UI] composer failed to build.');
      return;
    }

    wire();
    renderTray();
    syncSend();
    watchChrome();
    if (els.messages) observe(els.messages);

    pollHealth();
    setInterval(pollHealth, 30000);

    window.BucksA2UIComposer = {
      focus: () => els.input.focus(),
      addCid,
      prefill: (t) => { els.input.value = t; syncSend(); els.input.focus(); },
      get attachments() { return attachments.slice(); },
    };

    console.log('[A2UI] Agentic composer installed.');
  }

  /* Run synchronously if the view is already parsed (this script is loaded at
     the end of <body>, so it normally is). That ordering is load-bearing:
     wireChatTab() runs on DOMContentLoaded and needs these elements to exist. */
  if (document.getElementById('view-chat-tab')) init();
  else document.addEventListener('DOMContentLoaded', init);
})();

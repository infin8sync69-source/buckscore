/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS PANE MANAGER — spatial multi-pane windows per tab    ║
   ║                                                            ║
   ║  Lets one tab host several live pages at once ("panes"),   ║
   ║  each a TabView (tab-view.js) whose placeholder div is      ║
   ║  laid out inside a .pane-stage. Panes carry a shell-DOM     ║
   ║  header (drag region + controls) that the native view      ║
   ║  never covers because the placeholder starts below it.     ║
   ║                                                            ║
   ║  Layout model: normalized rects {x,y,w,h} in 0..1 stage    ║
   ║  fractions, so window resizes and dock-clearance changes   ║
   ║  re-flow for free. Drag/resize updates the frame's %       ║
   ║  styles; tab-view.js's MutationObserver mirrors bounds to  ║
   ║  the native WebContentsView on the next rAF.               ║
   ║                                                            ║
   ║  Consumed by renderer.js (init/onTabActivated/onTabClosed) ║
   ║  and by the agent glue (list/resolve/add/close/focus/      ║
   ║  arrange) for pane-addressed browser tools.                 ║
   ╚══════════════════════════════════════════════════════════╝ */
(function () {
  'use strict';

  let deps = null;          // injected by renderer.js init()
  let SEQ = 0;
  const byTab = new Map();  // tabId -> { stage, panes: PaneRec[], focusedId }
  // PaneRec: { id, wv, frame, titleEl, rect:{x,y,w,h}, openedBy }

  const MIN_W_PX = 200, MIN_H_PX = 140, SNAP_PX = 10;

  const PRESETS = {
    'cols':  (n) => Array.from({ length: n }, (_, i) => ({ x: i / n, y: 0, w: 1 / n, h: 1 })),
    'rows':  (n) => Array.from({ length: n }, (_, i) => ({ x: 0, y: i / n, w: 1, h: 1 / n })),
    'main-left': (n) => {
      if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
      const side = n - 1;
      return [{ x: 0, y: 0, w: 0.62, h: 1 }].concat(
        Array.from({ length: side }, (_, i) => ({ x: 0.62, y: i / side, w: 0.38, h: 1 / side })));
    },
    'grid': (n) => {
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      return Array.from({ length: n }, (_, i) => ({
        x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows,
      }));
    },
    'focus': (n, focusedIdx) => {
      if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
      const side = n - 1;
      let s = 0;
      return Array.from({ length: n }, (_, i) => i === focusedIdx
        ? { x: 0, y: 0, w: 0.78, h: 1 }
        : { x: 0.78, y: (s++) / side, w: 0.22, h: 1 / side });
    },
  };
  const PRESET_NAMES = Object.keys(PRESETS);

  function autoPreset(n) { return n <= 2 ? 'cols' : n === 3 ? 'main-left' : 'grid'; }

  /* ── DOM helpers ── */

  function applyRect(rec) {
    const r = rec.rect;
    rec.frame.style.left = (r.x * 100) + '%';
    rec.frame.style.top = (r.y * 100) + '%';
    rec.frame.style.width = (r.w * 100) + '%';
    rec.frame.style.height = (r.h * 100) + '%';
  }

  function makeStage(tabId) {
    const stage = document.createElement('div');
    stage.className = 'pane-stage';
    stage.dataset.tabId = tabId;
    if (deps.walletSidebar && deps.walletSidebar.parentNode === deps.browserContent) {
      deps.browserContent.insertBefore(stage, deps.walletSidebar);
    } else if (deps.browserContent) {
      deps.browserContent.appendChild(stage);
    }
    return stage;
  }

  function makeFrame(entry, rec) {
    const frame = document.createElement('div');
    frame.className = 'pane-frame';
    frame.dataset.paneId = rec.id;
    frame.innerHTML = `
      <div class="pane-header">
        <span class="pane-dot"></span>
        <span class="pane-title">Loading…</span>
        <span class="pane-agent-badge hidden">agent</span>
        <div class="pane-actions">
          <button data-act="solo" title="Expand to fill the tab"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg></button>
          <button data-act="popout" title="Move to its own tab"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6v6m-11 5L21 3"/></svg></button>
          <button data-act="close" title="Close pane"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
      </div>
      <div class="pane-body"></div>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => `<div class="pane-rz pane-rz-${d}" data-dir="${d}"></div>`).join('')}`;

    rec.titleEl = frame.querySelector('.pane-title');
    frame.querySelector('.pane-body').appendChild(rec.wv.el);

    frame.addEventListener('pointerdown', () => focusPane(entry.tabId, rec.id));
    frame.querySelector('.pane-actions').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'close') closePane(entry.tabId, rec.id);
      else if (act === 'solo') soloPane(entry.tabId, rec.id);
      else if (act === 'popout') popOutPane(entry.tabId, rec.id);
    });
    wireDrag(entry, rec, frame);
    entry.stage.appendChild(frame);
    return frame;
  }

  /* ── drag / resize with edge snapping ── */

  function wireDrag(entry, rec, frame) {
    const header = frame.querySelector('.pane-header');

    function beginGesture(ev, mode, dir) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const stageR = entry.stage.getBoundingClientRect();
      const start = { mx: ev.clientX, my: ev.clientY, rect: { ...rec.rect } };
      const minW = Math.min(0.9, MIN_W_PX / stageR.width);
      const minH = Math.min(0.9, MIN_H_PX / stageR.height);
      // Snap targets: stage bounds, midlines, and every other pane's edges.
      const xs = [0, 0.5, 1], ys = [0, 0.5, 1];
      for (const p of entry.panes) {
        if (p === rec) continue;
        xs.push(p.rect.x, p.rect.x + p.rect.w);
        ys.push(p.rect.y, p.rect.y + p.rect.h);
      }
      const snapX = (v) => { for (const t of xs) if (Math.abs(v - t) * stageR.width < SNAP_PX) return t; return v; };
      const snapY = (v) => { for (const t of ys) if (Math.abs(v - t) * stageR.height < SNAP_PX) return t; return v; };

      frame.classList.add('pane-gesture');
      focusPane(entry.tabId, rec.id);

      function onMove(e) {
        const dx = (e.clientX - start.mx) / stageR.width;
        const dy = (e.clientY - start.my) / stageR.height;
        const r = { ...start.rect };
        if (mode === 'move') {
          r.x = snapX(Math.max(0, Math.min(1 - r.w, r.x + dx)));
          const x2 = snapX(r.x + r.w); if (x2 !== r.x + r.w) r.x = x2 - r.w;
          r.y = snapY(Math.max(0, Math.min(1 - r.h, r.y + dy)));
          const y2 = snapY(r.y + r.h); if (y2 !== r.y + r.h) r.y = y2 - r.h;
        } else {
          if (dir.includes('e')) r.w = Math.max(minW, Math.min(1 - r.x, snapX(r.x + r.w + dx) - r.x));
          if (dir.includes('s')) r.h = Math.max(minH, Math.min(1 - r.y, snapY(r.y + r.h + dy) - r.y));
          if (dir.includes('w')) {
            const right = r.x + r.w;
            r.x = snapX(Math.max(0, Math.min(right - minW, r.x + dx)));
            r.w = right - r.x;
          }
          if (dir.includes('n')) {
            const bottom = r.y + r.h;
            r.y = snapY(Math.max(0, Math.min(bottom - minH, r.y + dy)));
            r.h = bottom - r.y;
          }
        }
        rec.rect = r;
        applyRect(rec);
      }
      function onUp() {
        frame.classList.remove('pane-gesture');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persistNothing(); // placeholder: session-only layout
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    header.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      beginGesture(ev, 'move');
    });
    frame.querySelectorAll('.pane-rz').forEach((h) => {
      h.addEventListener('pointerdown', (ev) => beginGesture(ev, 'resize', h.dataset.dir));
    });
  }

  function persistNothing() { /* layout is per-session by design (see memory doc) */ }

  /* ── pane lifecycle ── */

  function wirePaneEvents(entry, rec) {
    rec.wv.addEventListener('page-title-updated', (e) => {
      rec.title = e.title || '';
      if (rec.titleEl) rec.titleEl.textContent = rec.title || rec.wv.getURL();
      if (deps.onWorkspaceChanged) deps.onWorkspaceChanged(entry.tabId);
    });
    rec.wv.addEventListener('did-navigate', (e) => {
      if (rec.titleEl && !rec.title) rec.titleEl.textContent = e.url;
      if (entry.focusedId === rec.id && entry.tabId === deps.getActiveTabId()) {
        deps.setAddressBar(e.url);
      }
    });
    // Links that request a new window from a pane open as a sibling pane —
    // popups stay inside the workspace instead of exploding into tabs.
    rec.wv.addEventListener('new-window', (e) => addPane(entry.tabId, e.url));
    rec.wv.addEventListener('open-in-pane', (e) => addPane(entry.tabId, e.url));
    // Clicking inside the native page focuses its pane (tab-manager forwards
    // webContents focus as 'view-focus').
    rec.wv.addEventListener('view-focus', () => focusPane(entry.tabId, rec.id));
  }

  function ensureEntry(tabId) {
    let entry = byTab.get(tabId);
    if (entry) return entry;

    const tab = deps.getTabs().find((t) => t.id === tabId);
    if (!tab || !tab.webview) return null;

    entry = { tabId, stage: makeStage(tabId), panes: [], focusedId: null };
    byTab.set(tabId, entry);

    // Adopt the tab's existing page as pane #1 (reparent its placeholder).
    const rec = {
      id: 'p' + (++SEQ), wv: tab.webview, frame: null, titleEl: null,
      rect: { x: 0, y: 0, w: 1, h: 1 }, title: tab.title || '', openedBy: 'user',
    };
    rec.frame = makeFrame(entry, rec);
    rec.titleEl.textContent = tab.title || tab.url;
    applyRect(rec);
    wirePaneEvents(entry, rec);
    entry.panes.push(rec);
    entry.focusedId = rec.id;
    return entry;
  }

  function addPane(tabId, url, opts = {}) {
    const entry = ensureEntry(tabId);
    if (!entry) return null;
    if (entry.panes.length >= 6) {
      return { error: 'Pane limit reached (6 per tab) — close one first.' };
    }
    const wv = deps.createTabView();
    wv.setAttribute('src', deps.normalizeURL ? deps.normalizeURL(url) : url);
    const rec = {
      id: 'p' + (++SEQ), wv, frame: null, titleEl: null,
      rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, title: '', openedBy: opts.openedBy || 'user',
    };
    rec.frame = makeFrame(entry, rec);
    if (rec.openedBy === 'agent') rec.frame.querySelector('.pane-agent-badge').classList.remove('hidden');
    wirePaneEvents(entry, rec);
    entry.panes.push(rec);
    arrange(tabId, opts.preset || autoPreset(entry.panes.length));
    syncActive(tabId);
    focusPane(tabId, rec.id);
    if (deps.onWorkspaceChanged) deps.onWorkspaceChanged(tabId);
    return rec.id;
  }

  function resolvePane(tabId, ref) {
    const entry = byTab.get(tabId);
    if (!entry) return null;
    if (ref == null || ref === 'focused') {
      return entry.panes.find((p) => p.id === entry.focusedId) || entry.panes[0] || null;
    }
    const s = String(ref);
    return entry.panes.find((p) => p.id === s)
      || entry.panes[parseInt(s, 10) - 1]  // 1-based index
      || null;
  }

  function focusPane(tabId, paneId) {
    const entry = byTab.get(tabId);
    const rec = entry && entry.panes.find((p) => p.id === paneId);
    if (!rec) return false;
    entry.focusedId = paneId;
    for (const p of entry.panes) p.frame.classList.toggle('focused', p === rec);
    // Native z-order: re-adding as last child paints on top (tab-manager).
    if (rec.wv.raise) rec.wv.raise();
    // Nav controls / zoom / find act on the focused pane.
    const tab = deps.getTabs().find((t) => t.id === tabId);
    if (tab) {
      tab.webview = rec.wv;
      if (tabId === deps.getActiveTabId()) {
        deps.setAddressBar(rec.wv.getURL() || '');
        deps.refreshNavState && deps.refreshNavState();
      }
    }
    return true;
  }

  function closePane(tabId, paneId) {
    const entry = byTab.get(tabId);
    if (!entry) return false;
    const idx = entry.panes.findIndex((p) => p.id === paneId);
    if (idx === -1) return false;
    const rec = entry.panes[idx];
    entry.panes.splice(idx, 1);
    rec.wv.remove();
    rec.frame.remove();

    const tab = deps.getTabs().find((t) => t.id === tabId);
    if (!entry.panes.length) {
      byTab.delete(tabId);
      entry.stage.remove();
      if (tab) deps.closeTab(tabId);
      return true;
    }
    if (entry.focusedId === paneId || (tab && tab.webview === rec.wv)) {
      focusPane(tabId, entry.panes[Math.max(0, idx - 1)].id);
    }
    if (entry.panes.length === 1) {
      unsplit(tabId);
    } else {
      arrange(tabId, autoPreset(entry.panes.length));
    }
    if (deps.onWorkspaceChanged) deps.onWorkspaceChanged(tabId);
    return true;
  }

  // Collapse a 1-pane workspace back to a plain tab (placeholder returns to
  // browser-content so the stock `body.web-mode .webview-host` inset applies).
  function unsplit(tabId) {
    const entry = byTab.get(tabId);
    if (!entry || entry.panes.length !== 1) return;
    const rec = entry.panes[0];
    const tab = deps.getTabs().find((t) => t.id === tabId);
    deps.browserContent.insertBefore(rec.wv.el, deps.walletSidebar);
    entry.stage.remove();
    byTab.delete(tabId);
    if (tab) {
      tab.webview = rec.wv;
      tab.url = rec.wv.getURL() || tab.url;
    }
  }

  function soloPane(tabId, paneId) {
    const entry = byTab.get(tabId);
    if (!entry) return false;
    for (const p of entry.panes.slice()) {
      if (p.id !== paneId) closePane(tabId, p.id);
    }
    return true;
  }

  function popOutPane(tabId, paneId) {
    const entry = byTab.get(tabId);
    const rec = entry && entry.panes.find((p) => p.id === paneId);
    if (!rec) return false;
    const url = rec.wv.getURL();
    closePane(tabId, paneId);
    if (url) deps.createTab(url);
    return true;
  }

  function arrange(tabId, preset) {
    const entry = byTab.get(tabId);
    if (!entry) return false;
    const fn = PRESETS[preset];
    if (!fn) return false;
    const focusedIdx = Math.max(0, entry.panes.findIndex((p) => p.id === entry.focusedId));
    const rects = fn(entry.panes.length, focusedIdx);
    entry.panes.forEach((p, i) => { p.rect = rects[i] || p.rect; applyRect(p); });
    return true;
  }

  function listPanes(tabId) {
    const entry = byTab.get(tabId);
    if (!entry) {
      const tab = deps.getTabs().find((t) => t.id === tabId);
      if (!tab || !tab.webview) return [];
      return [{ id: 'main', index: 1, title: tab.title, url: tab.url, focused: true, openedBy: 'user' }];
    }
    return entry.panes.map((p, i) => ({
      id: p.id, index: i + 1,
      title: p.title || p.titleEl.textContent,
      url: p.wv.getURL(),
      focused: p.id === entry.focusedId,
      openedBy: p.openedBy,
      rect: { ...p.rect },
    }));
  }

  /* ── renderer.js lifecycle hooks ── */

  function syncActive(tabId) {
    for (const [id, entry] of byTab) {
      const on = id === tabId;
      entry.stage.classList.toggle('active', on);
      for (const p of entry.panes) p.wv.classList.toggle('active', on);
    }
  }

  function onTabActivated(tabId) {
    syncActive(byTab.has(tabId) ? tabId : null);
  }

  function onTabClosed(tabId) {
    const entry = byTab.get(tabId);
    if (!entry) return;
    for (const p of entry.panes) { try { p.wv.remove(); } catch (_) {} }
    entry.stage.remove();
    byTab.delete(tabId);
  }

  function isSplit(tabId) { return byTab.has(tabId); }
  function setAgentReading(tabId, paneId, on) {
    const rec = resolvePane(tabId, paneId);
    if (rec && rec.frame) rec.frame.classList.toggle('agent-reading', !!on);
  }

  window.bucksPaneManager = {
    init(d) { deps = d; },
    addPane, closePane, focusPane, soloPane, popOutPane, arrange,
    listPanes, resolvePane, isSplit, onTabActivated, onTabClosed,
    setAgentReading,
    PRESET_NAMES,
  };
})();

/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS TAB VIEW — renderer-side shim for WebContentsView    ║
   ║                                                            ║
   ║  Drop-in replacement for the legacy <webview> element used ║
   ║  for tab hosting. Each TabView owns a placeholder <div      ║
   ║  class="webview-host"> that participates in normal layout/ ║
   ║  CSS (`.active` toggles it like the old webview) while the ║
   ║  actual page renders in a main-process WebContentsView     ║
   ║  whose bounds/visibility mirror the placeholder.           ║
   ║                                                            ║
   ║  Implements exactly the webview API surface renderer.js /  ║
   ║  agent-browser-control.js use: setAttribute('src'), src,   ║
   ║  remove, classList, dataset, addEventListener, goBack/     ║
   ║  goForward/canGoBack/canGoForward, reload, findInPage,     ║
   ║  stopFindInPage, setZoomFactor, print, executeJavaScript,  ║
   ║  capturePageBase64.                                        ║
   ╚══════════════════════════════════════════════════════════╝ */
(function () {
  'use strict';

  if (!window.bucksTabs) {
    console.warn('[TabView] bucksTabs preload API missing — tab shim disabled.');
    return;
  }

  let SEQ = 0;
  const instances = new Map(); // tabViewId -> TabView

  // Overlay panels that slide OVER the content area. A native view would
  // otherwise paint above them, so their footprint is subtracted from the
  // view bounds ("push" behavior) — and full-screen overlays hide the view.
  // The left dock + its web-mode reveal trigger MUST be here: they live at
  // the left edge as shell DOM, and without reserving their footprint the
  // native pane view paints straight over them, making the whole side nav
  // un-hoverable / un-clickable in web & spatial-pane mode.
  const SIDE_OVERLAYS = ['#left-dock-trigger', '.left-dock', '#wallet-sidebar', '#ipfs-sidebar', '#settings-panel', '#agent-sidecar-panel', '#nav-chat-panel.sidecar-mode', '.agent-sidecar-container'];
  // Dropdowns from the top bar (omnibox suggestions, find bar) push the
  // page down to stay visible — native views always paint above shell DOM.
  // Only overlays that are genuinely part of the page's frame belong here:
  // pushing the view down resizes the live page, which reads as the whole site
  // jumping/shrinking. Transient menus go in FLOAT_OVERLAYS instead.
  //
  // '#profile-dropdown' and '#wallet-dropdown' used to be listed here and match
  // nothing — the real elements are '#profile-panel' and '#wallet-sidebar'. A
  // dead selector is invisible: querySelector returns null, the loop skips it,
  // and the panel silently renders behind the native view.
  // #find-bar and #origin-approval are persistent bands that genuinely belong
  // to the page's frame while open, so pushing is right for them.
  // #omnibox-dropdown is NOT: it appears the instant you click the address bar
  // and disappears on blur, so pushing made the whole site jump down and back
  // on every search. It floats now (see FLOAT_OVERLAYS).
  const TOP_OVERLAYS = [
    '#find-bar',
    '#origin-approval'
  ];

  // Transient menus and panels. These must not resize the page — instead the
  // live view is swapped for a freeze-frame (same trick the agent panel uses),
  // so shell DOM paints on top without the page visibly reflowing.
  const FLOAT_OVERLAYS = [
    '#omnibox-dropdown',
    '#hamburger-menu-dropdown',
    '#profile-panel',
    '#bookmarks-panel',
    '#downloads-panel',
    '#history-panel',
    // NOT '#chat-tab-history-panel' — despite the name it is a permanently
    // docked 240px sidebar inside the chat view, always display:flex. Listing
    // it made `floating` true forever, which hid the page view for good and
    // left every site blank.
    '#space-selector-dropdown',
    '#tabs-slab-dropdown',
    '#tab-context-menu',
    '#create-space-modal'
  ];
  // The omnibar suggestion dropdown rises upward over the stage from the
  // bottom band, so its footprint is subtracted from the view's BOTTOM edge.
  // (#nt-ephemeral-zone no longer pushes: over a web page the agent panel is
  // an ephemeral overlay — renderer.js freezes the page into
  // #page-freeze-backdrop and sets body.agent-freeze, which hides the view.)
  // The agent dock is NOT listed here. The stage already keeps a band clear
  // for it via --agent-dock-clearance, which renderer.js now measures from the
  // dock itself. Pushing here as well reserved the space twice and showed up
  // as dead space under the page.
  const BOTTOM_OVERLAYS = ['.command-suggestions-dropdown'];
  const FULLSCREEN_OVERLAYS = ['#store-overlay'];

  function overlayVisible(el) {
    if (!el) return false;
    if (el.classList.contains('hidden') || el.classList.contains('sidebar-hidden')) return false;
    // getComputedStyle reports the element's OWN display, so a child of a
    // display:none parent still reads as "flex" and counted as visible. Ask
    // the layout engine whether it is actually being rendered instead —
    // getClientRects() is empty for anything not laid out, and unlike
    // offsetParent it stays correct for position:fixed overlays.
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  class TabView {
    constructor(opts = {}) {
      this.tabViewId = 'tv-' + Date.now().toString(36) + '-' + (SEQ++);
      this._events = {};
      this._url = '';
      this._canGoBack = false;
      this._canGoForward = false;
      this._destroyed = false;
      this._lastSig = '';

      this.el = document.createElement('div');
      this.el.className = 'webview-host';
      this.el.__tabView = this;

      const partition = opts.partition || undefined;
      this._ready = window.bucksTabs.create(this.tabViewId, '', partition);
      instances.set(this.tabViewId, this);
      this._ready.then(() => scheduleSync()).catch(() => {});
    }

    /* ── DOM-ish surface (renderer.js treats us like an element) ── */
    get classList() { return this.el.classList; }
    get dataset() { return this.el.dataset; }
    get style() { return this.el.style; }

    setAttribute(name, value) {
      if (name === 'src') { this.src = value; return; }
      if (name === 'partition' || name === 'allowpopups') return; // constructor-time / N/A
      this.el.setAttribute(name, value);
    }
    getAttribute(name) {
      if (name === 'src') return this._url;
      return this.el.getAttribute(name);
    }

    get src() { return this._url; }
    set src(url) {
      this._url = String(url || '');
      this._call('navigate', this._url);
    }

    remove() {
      this._destroyed = true;
      instances.delete(this.tabViewId);
      window.bucksTabs.close(this.tabViewId).catch(() => {});
      this.el.remove();
      scheduleSync();
    }

    sync() {
      this._sync();
    }

    /* ── events ── */
    addEventListener(type, fn, options) {
      const wrapped = (options && options.once)
        ? (ev) => { this.removeEventListener(type, wrapped); fn(ev); }
        : fn;
      (this._events[type] = this._events[type] || []).push(wrapped);
    }
    removeEventListener(type, fn) {
      const l = this._events[type];
      if (l) this._events[type] = l.filter((f) => f !== fn);
    }
    _emit(type, ev) {
      (this._events[type] || []).forEach((fn) => { try { fn(ev); } catch (err) { console.error('[TabView]', type, err); } });
    }

    /* ── navigation / page API ── */
    loadURL(url) { this.src = url; }
    getURL() { return this._url; }
    canGoBack() { return this._canGoBack; }
    canGoForward() { return this._canGoForward; }
    goBack() { this._call('goBack'); }
    goForward() { this._call('goForward'); }
    reload() { this._call('reload'); }
    stop() { this._call('stop'); }
    print() { this._call('print'); }
    openDevTools() { this._call('openDevTools'); }
    setZoomFactor(f) { window.bucksTabs.setZoom(this.tabViewId, f).catch(() => {}); }
    findInPage(text, options) { window.bucksTabs.find(this.tabViewId, text, options).catch(() => {}); }
    stopFindInPage(action) { window.bucksTabs.stopFind(this.tabViewId, action).catch(() => {}); }
    executeJavaScript(code, userGesture) {
      return window.bucksTabs.execJS(this.tabViewId, code, !!userGesture);
    }
    capturePageBase64() { return window.bucksTabs.capture(this.tabViewId); }
    // Paint above sibling views (re-adding as last child raises — tab-manager).
    raise() { return window.bucksTabs.setVisible(this.tabViewId, true); }

    _call(method, arg) {
      const p = this._ready.then(() => (arg !== undefined
        ? window.bucksTabs[method](this.tabViewId, arg)
        : window.bucksTabs[method](this.tabViewId)));
      p.catch(() => {});
      return p;
    }

    /* ── geometry/visibility mirroring ── */
    _sync() {
      if (this._destroyed) return;

      // Whether a transient menu is open is a property of the window, not of
      // this view — computed once per pass in syncAll(). Dispatching from here
      // fired once per TabView instance, and the second dispatch saw the freeze
      // the first had just applied, so the shell concluded it had not started
      // the freeze and never lifted it: the page stayed blank.
      const floating = floatOverlayActive;

      const visible = this.el.isConnected &&
        this.el.classList.contains('active') &&
        getComputedStyle(this.el).display !== 'none' &&
        !floating &&
        // Agent-panel overlay: the live page is swapped for a freeze-frame
        // backdrop (renderer.js) so shell DOM can paint on top of "the page".
        !document.body.classList.contains('agent-freeze') &&
        !FULLSCREEN_OVERLAYS.some((sel) => overlayVisible(document.querySelector(sel)));

      if (!visible) {
        if (this._lastSig !== 'hidden') {
          this._lastSig = 'hidden';
          window.bucksTabs.setVisible(this.tabViewId, false).catch(() => {});
        }
        return;
      }

      const r = this.el.getBoundingClientRect();
      let { left, top, right, bottom } = r;

      // Push behavior for slide-over panels.
      for (const sel of SIDE_OVERLAYS) {
        const el = document.querySelector(sel);
        if (!overlayVisible(el)) continue;
        const o = el.getBoundingClientRect();
        if (o.left < right && o.right > left && o.width > 0) {
          if (o.left > left + 40) right = Math.min(right, o.left); // docks right
          else left = Math.max(left, o.right);                     // docks left
        }
      }
      for (const sel of TOP_OVERLAYS) {
        const el = document.querySelector(sel);
        if (!overlayVisible(el)) continue;
        const o = el.getBoundingClientRect();
        if (o.bottom > top && o.top < bottom) top = Math.max(top, o.bottom + 8);
      }
      for (const sel of BOTTOM_OVERLAYS) {
        const el = document.querySelector(sel);
        if (!overlayVisible(el)) continue;
        const o = el.getBoundingClientRect();
        if (o.height > 0 && o.top < bottom && o.bottom > top) bottom = Math.min(bottom, o.top - 8);
      }

      const bounds = {
        x: left, y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
      const sig = [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round).join(',');
      if (sig !== this._lastSig) {
        this._lastSig = sig;
        window.bucksTabs.setBounds(this.tabViewId, bounds).catch(() => {});
        window.bucksTabs.setVisible(this.tabViewId, true).catch(() => {});
        // Native radius must mirror the CSS stage radius or the corners
        // mismatch. Web mode uses --radius-bar (16) so the page, the top nav
        // and the agent composer all share one corner; panes round at 10.
        const inPane = !!this.el.closest('.pane-body');
        window.bucksTabs.setBorderRadius(
          this.tabViewId,
          inPane ? 10 : document.body.classList.contains('web-mode') ? 16 : 32
        ).catch(() => {});
      }
    }
  }

  /* ── shared sync loop ──
     One rAF-debounced pass over all instances, kicked by layout-affecting
     signals and a low-frequency safety interval (covers CSS transitions). */
  // Window-level, not per-view: one evaluation and one event per pass.
  let floatOverlayActive = false;

  let syncQueued = false;
  function syncAll() {
    syncQueued = false;

    const floating = FLOAT_OVERLAYS.some(
      (sel) => overlayVisible(document.querySelector(sel))
    );
    if (floating !== floatOverlayActive) {
      floatOverlayActive = floating;
      document.dispatchEvent(new CustomEvent('bucks:float-overlay', {
        detail: { active: floating },
      }));
    }

    for (const tv of instances.values()) tv._sync();
  }
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncAll);
  }

  window.addEventListener('resize', scheduleSync);
  document.addEventListener('transitionend', scheduleSync, true);
  document.addEventListener('animationend', scheduleSync, true);
  setInterval(scheduleSync, 250);

  const mo = new MutationObserver(scheduleSync);
  window.addEventListener('DOMContentLoaded', () => {
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
  });

  /* ── main-process events → per-instance webview-style events ── */
  window.bucksTabs.onEvent((evt) => {
    const tv = instances.get(evt.tabId);
    if (!tv) return;
    switch (evt.type) {
      case 'nav-state':
        tv._canGoBack = !!evt.canGoBack;
        tv._canGoForward = !!evt.canGoForward;
        break;
      case 'did-navigate':
      case 'did-navigate-in-page':
        tv._url = evt.url || tv._url;
        tv._emit(evt.type, { url: evt.url });
        break;
      case 'page-title-updated':
        tv._emit(evt.type, { title: evt.title });
        break;
      case 'page-favicon-updated':
        tv._emit(evt.type, { favicons: evt.favicons });
        break;
      case 'found-in-page':
        tv._emit(evt.type, { result: evt.result });
        break;
      case 'new-window':
        tv._emit(evt.type, { url: evt.url });
        break;
      case 'did-fail-load':
        tv._emit(evt.type, { errorCode: evt.errorCode, errorDescription: evt.errorDescription, validatedURL: evt.validatedURL });
        break;
      default:
        tv._emit(evt.type, evt);
    }
  });

  window.BucksTabView = TabView;
})();

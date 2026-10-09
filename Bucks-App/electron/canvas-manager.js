/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS CANVAS MANAGER — Spatial Mini-Windows in Tabs        ║
   ║                                                            ║
   ║  Each tab can host multiple free-floating mini-windows on  ║
   ║  a 2D canvas. Each mini-window is a BucksTabView (native   ║
   ║  WebContentsView) with DOM controls above/around it.       ║
   ║                                                            ║
   ║  The key insight: native WebContentsViews paint ABOVE DOM. ║
   ║  So the titlebar + resize border are placed OUTSIDE the    ║
   ║  webview-host div's bounding rect. The sync loop in        ║
   ║  tab-view.js positions the native view to match the        ║
   ║  webview-host, leaving the DOM controls clickable.         ║
   ╚══════════════════════════════════════════════════════════╝ */
(function () {
  'use strict';

  const TITLEBAR_H = 32;
  const BORDER_W = 4;    // resize handle thickness
  const MIN_W = 280;
  const MIN_H = 180;

  const miniWindows = new Map();   // id -> MiniWindow
  let activeTabId = null;
  let zCounter = 100;

  /* ── DOM references (resolved lazily to survive load order) ── */
  function canvas() { return document.getElementById('spatial-canvas'); }

  /* ── Mini-Window ── */
  class MiniWindow {
    constructor(url, parentTabId) {
      this.id = 'mw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      this.parentTabId = parentTabId;
      this.url = url;
      this.tabView = null;
      this._minimised = false;
      this._savedSize = null;

      this._build();
      this._attachDrag();
      this._attachResize();
      this._spawnView();
    }

    /* ── Build the DOM shell ── */
    _build() {
      const c = canvas();
      // Outer frame — holds titlebar + content
      this.el = document.createElement('div');
      this.el.className = 'mini-window-frame';
      Object.assign(this.el.style, {
        position: 'absolute',
        left: (80 + Math.random() * 300) + 'px',
        top:  (40 + Math.random() * 120) + 'px',
        width: '480px', height: (320 + TITLEBAR_H) + 'px',
        display: 'flex', flexDirection: 'column',
        pointerEvents: 'auto',
        zIndex: zCounter++,
        borderRadius: '10px',
        overflow: 'visible',
        filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.55))',
      });

      // --- Title bar (ABOVE the native view) ---
      this.titleBar = document.createElement('div');
      Object.assign(this.titleBar.style, {
        height: TITLEBAR_H + 'px', minHeight: TITLEBAR_H + 'px',
        background: 'linear-gradient(150deg, rgba(50,50,56,0.95), rgba(28,28,32,0.95))',
        borderRadius: '10px 10px 0 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 8px',
        cursor: 'grab', userSelect: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      });

      // Window control buttons (macOS-style dots)
      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;align-items:center;gap:6px;padding-left:4px;';
      const makeBtn = (color, title, handler) => {
        const b = document.createElement('div');
        Object.assign(b.style, {
          width: '12px', height: '12px', borderRadius: '50%',
          background: color, cursor: 'pointer',
          border: '1px solid rgba(0,0,0,0.2)',
          transition: 'transform 0.1s',
        });
        b.title = title;
        b.onmouseenter = () => { b.style.transform = 'scale(1.25)'; };
        b.onmouseleave = () => { b.style.transform = 'scale(1)'; };
        b.onmousedown = (e) => e.stopPropagation(); // don't start drag
        b.onclick = (e) => { e.stopPropagation(); handler(); };
        return b;
      };
      controls.appendChild(makeBtn('#ff5f57', 'Close',    () => this.close()));
      controls.appendChild(makeBtn('#febc2e', 'Minimise', () => this.toggleMinimise()));
      controls.appendChild(makeBtn('#28c840', 'Maximise', () => this.toggleMaximise()));
      this.titleBar.appendChild(controls);

      // Title text
      this.titleText = document.createElement('span');
      Object.assign(this.titleText.style, {
        flex: '1', textAlign: 'center',
        fontSize: '11px', fontWeight: '600',
        color: 'rgba(255,255,255,0.75)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        padding: '0 8px', pointerEvents: 'none',
      });
      this.titleText.textContent = url.replace(/^https?:\/\//, '').substring(0, 40);
      this.titleBar.appendChild(this.titleText);

      // Spacer for symmetry
      const spacer = document.createElement('div');
      spacer.style.width = '60px';
      this.titleBar.appendChild(spacer);

      this.el.appendChild(this.titleBar);

      // --- Content host (this is the webview-host placeholder) ---
      this.contentHost = document.createElement('div');
      Object.assign(this.contentHost.style, {
        flex: '1', position: 'relative',
        background: '#111114',
        borderRadius: '0 0 10px 10px',
        overflow: 'hidden',
      });
      this.el.appendChild(this.contentHost);

      // --- Resize handles (bottom, right, bottom-right corner) ---
      this._addResizeHandle('right');
      this._addResizeHandle('bottom');
      this._addResizeHandle('corner');

      c.appendChild(this.el);
    }

    _addResizeHandle(type) {
      const h = document.createElement('div');
      h.dataset.resizeType = type;
      const shared = { position: 'absolute', zIndex: '5' };
      if (type === 'right') {
        Object.assign(h.style, shared, {
          top: TITLEBAR_H + 'px', right: '-2px', width: BORDER_W + 'px',
          bottom: '0', cursor: 'ew-resize',
        });
      } else if (type === 'bottom') {
        Object.assign(h.style, shared, {
          bottom: '-2px', left: '0', right: '0', height: BORDER_W + 'px',
          cursor: 'ns-resize',
        });
      } else {
        Object.assign(h.style, shared, {
          bottom: '-2px', right: '-2px', width: '14px', height: '14px',
          cursor: 'nwse-resize',
        });
      }
      this.el.appendChild(h);
    }

    /* ── Spawn the WebContentsView ── */
    _spawnView() {
      if (!window.BucksTabView) {
        console.warn('[Canvas] BucksTabView not available');
        return;
      }
      this.tabView = new window.BucksTabView();
      // The .webview-host placeholder is placed INSIDE contentHost so the
      // native view's bounds match only the content area (not the titlebar).
      this.tabView.el.style.width = '100%';
      this.tabView.el.style.height = '100%';
      this.contentHost.appendChild(this.tabView.el);
      this.tabView.setAttribute('src', this.url);
      this.tabView.classList.add('active');

      // Update title when page loads
      this.tabView.addEventListener('page-title-updated', (e) => {
        if (e.title) this.titleText.textContent = e.title;
      });
    }

    /* ── Drag logic ── */
    _attachDrag() {
      let dragging = false, sx, sy, ox, oy;

      this.titleBar.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        ox = this.el.offsetLeft; oy = this.el.offsetTop;
        this.titleBar.style.cursor = 'grabbing';
        this.el.style.zIndex = zCounter++;
        // Temporarily hide native view during drag so it doesn't steal events
        if (this.tabView) this.tabView.classList.remove('active');
        e.preventDefault();
      });

      const onMove = (e) => {
        if (!dragging) return;
        this.el.style.left = (ox + e.clientX - sx) + 'px';
        this.el.style.top  = (oy + e.clientY - sy) + 'px';
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        this.titleBar.style.cursor = 'grab';
        // Re-show native view after drag
        if (this.tabView && !this._minimised) this.tabView.classList.add('active');
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    /* ── Resize logic ── */
    _attachResize() {
      let resizing = false, rtype, sx, sy, ow, oh;

      this.el.addEventListener('mousedown', (e) => {
        const rt = e.target.dataset?.resizeType;
        if (!rt) return;
        resizing = true; rtype = rt;
        sx = e.clientX; sy = e.clientY;
        ow = this.el.offsetWidth; oh = this.el.offsetHeight;
        this.el.style.zIndex = zCounter++;
        // Hide native view during resize
        if (this.tabView) this.tabView.classList.remove('active');
        e.preventDefault(); e.stopPropagation();
      });

      const onMove = (e) => {
        if (!resizing) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (rtype === 'right' || rtype === 'corner') {
          this.el.style.width = Math.max(MIN_W, ow + dx) + 'px';
        }
        if (rtype === 'bottom' || rtype === 'corner') {
          this.el.style.height = Math.max(MIN_H, oh + dy) + 'px';
        }
      };

      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        if (this.tabView && !this._minimised) this.tabView.classList.add('active');
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    /* ── Window controls ── */
    close() {
      if (this.tabView) this.tabView.remove();
      this.el.remove();
      miniWindows.delete(this.id);
    }

    toggleMinimise() {
      this._minimised = !this._minimised;
      if (this._minimised) {
        this._savedSize = { w: this.el.style.width, h: this.el.style.height };
        this.contentHost.style.display = 'none';
        this.el.style.height = TITLEBAR_H + 'px';
        if (this.tabView) this.tabView.classList.remove('active');
      } else {
        this.contentHost.style.display = '';
        if (this._savedSize) {
          this.el.style.width = this._savedSize.w;
          this.el.style.height = this._savedSize.h;
        }
        if (this.tabView) this.tabView.classList.add('active');
      }
    }

    toggleMaximise() {
      const c = canvas();
      if (!c) return;
      const cr = c.getBoundingClientRect();
      this.el.style.left = '0'; this.el.style.top = '0';
      this.el.style.width = cr.width + 'px';
      this.el.style.height = cr.height + 'px';
      this._minimised = false;
      this.contentHost.style.display = '';
      if (this.tabView) this.tabView.classList.add('active');
    }

    setVisible(v) {
      this.el.style.display = v ? 'flex' : 'none';
      if (this.tabView) {
        if (v && !this._minimised) this.tabView.classList.add('active');
        else this.tabView.classList.remove('active');
      }
    }
  }

  /* ── Public API ── */
  const canvasManager = {
    spawnMiniWindow(url, parentTabId) {
      const pid = parentTabId || activeTabId;
      if (!pid) return null;
      const mw = new MiniWindow(url, pid);
      miniWindows.set(mw.id, mw);
      return mw.id;
    },

    closeMiniWindow(id) {
      const mw = miniWindows.get(id);
      if (mw) mw.close();
    },

    onTabChanged(tabId, isWebMode) {
      activeTabId = tabId;
      for (const mw of miniWindows.values()) {
        mw.setVisible(mw.parentTabId === tabId);
      }
    },

    getMiniWindowCount(tabId) {
      let n = 0;
      for (const mw of miniWindows.values()) {
        if (mw.parentTabId === (tabId || activeTabId)) n++;
      }
      return n;
    },

    init() {
      const searchBar = document.getElementById('composer-bar');
      const searchInput = document.getElementById('agentic-input');
      const crudBtn = document.getElementById('agentic-crud-btn');

      if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
              console.log('[Canvas] Agentic Query:', query);
              if (query.startsWith('http') || query.includes('.')) {
                this.spawnMiniWindow(query.startsWith('http') ? query : 'https://' + query);
              } else if (window.sendChat) {
                window.sendChat(query);
              }
              searchInput.value = '';
            }
          }
        });
      }

      if (crudBtn) {
        crudBtn.addEventListener('click', () => {
          console.log('[Canvas] CRUD Action requested for tab:', activeTabId);
        });
      }
    }
  };

  window.canvasManager = canvasManager;
  // Use DOMContentLoaded or direct call depending on load order
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => canvasManager.init());
  } else {
    canvasManager.init();
  }
})();

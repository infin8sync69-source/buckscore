/* ═══════════════════════════════════════════════════════════
   BUCKS APP STORE — UI Controller
   Populates #view-appstore with the full App Store experience:
   - Category filter pills
   - App card grid (3-col)
   - Detail drawer (slides from right)
   - Launch (web-tab) + local install tracking
   ═══════════════════════════════════════════════════════════ */

(function initBucksAppStore() {
  'use strict';

  /* ─── Constants ─── */
  const LS_KEY = 'bucks-installed-apps';
  const CATEGORIES = ['All', 'Built-In', 'Creative', 'Productivity', 'Knowledge', 'Finance'];

  /* ─── State ─── */
  let activeCategory = 'All';
  let activeDrawerAppId = null;
  let drawerOpen = false;
  let installingApps = new Set(); // appIds currently being installed

  /* ─── LocalStorage helpers ─── */
  function getInstalled() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) { return {}; }
  }

  function setInstalled(id, data) {
    const store = getInstalled();
    if (data === null) { delete store[id]; } else { store[id] = data; }
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (_) {}
  }

  function isInstalled(id) {
    return !!getInstalled()[id];
  }

  /* ─── Launch via browser tab ─── */
  function launchApp(app) {
    const url = isInstalled(app.id) && getInstalled()[app.id].localUrl
      ? getInstalled()[app.id].localUrl
      : app.runUrl;

    // Use the Bucks browser tab system
    if (typeof window.createTab === 'function') {
      window.createTab(url);
    } else if (window.bucksBrowser && window.bucksBrowser.createTab) {
      window.bucksBrowser.createTab(url);
    } else if (typeof window.navigateTab === 'function' && window.activeTabId) {
      window.navigateTab(window.activeTabId, url);
    } else if (window.bucksAPI && window.bucksAPI.appStoreLaunchWeb) {
      window.bucksAPI.appStoreLaunchWeb(app.id).catch(() => {});
    }

    // Close the store overlay/view so the new tab is visible
    const overlay = document.getElementById('store-overlay');
    if (overlay) overlay.classList.add('hidden');
    const viewAppStore = document.getElementById('view-appstore');
    if (viewAppStore && !viewAppStore.classList.contains('hidden') && typeof window.showDashboardView === 'function') {
      window.showDashboardView('newtab');
    }
  }

  /* ─── Install via IPC ─── */
  async function installApp(app, cardEl) {
    if (installingApps.has(app.id)) return;
    if (!window.bucksAPI || !window.bucksAPI.appStoreInstall) {
      // Fallback: mark as "installed" (web mode) and update UI
      setInstalled(app.id, { mode: 'web', installedAt: Date.now() });
      rerenderCard(app.id);
      return;
    }

    installingApps.add(app.id);
    showInstallProgress(app.id, 'Cloning repository…');

    try {
      const result = await window.bucksAPI.appStoreInstall(app.id);
      if (result && result.ok) {
        setInstalled(app.id, { mode: 'local', localUrl: `http://localhost:${app.localRun.port}`, installedAt: Date.now() });
        showInstallProgress(app.id, null);
      } else {
        // Fallback to web mode
        setInstalled(app.id, { mode: 'web', installedAt: Date.now() });
        showInstallProgress(app.id, null);
      }
    } catch (_) {
      setInstalled(app.id, { mode: 'web', installedAt: Date.now() });
      showInstallProgress(app.id, null);
    } finally {
      installingApps.delete(app.id);
      rerenderCard(app.id);
      if (drawerOpen && activeDrawerAppId === app.id) openDrawer(app.id);
    }
  }

  async function uninstallApp(app) {
    setInstalled(app.id, null);
    if (window.bucksAPI && window.bucksAPI.appStoreUninstall) {
      window.bucksAPI.appStoreUninstall(app.id).catch(() => {});
    }
    rerenderCard(app.id);
    if (drawerOpen && activeDrawerAppId === app.id) openDrawer(app.id);
  }

  function showInstallProgress(appId, message) {
    const progressEl = document.querySelector(`[data-app-progress="${appId}"]`);
    const msgEl = document.querySelector(`[data-app-progress-msg="${appId}"]`);
    if (!progressEl) return;
    if (message) {
      progressEl.style.display = 'block';
      if (msgEl) msgEl.textContent = message;
    } else {
      progressEl.style.display = 'none';
    }
  }

  /* ─── Build category filter pills ─── */
  function buildFilters() {
    const containers = document.querySelectorAll('#bucks-store-filters');
    if (!containers.length) return;
    const html = CATEGORIES.map(cat => `
      <button
        class="bucks-store-filter-pill ${cat === activeCategory ? 'active' : ''}"
        data-cat="${cat}"
      >${cat}</button>
    `).join('');

    containers.forEach(el => {
      el.innerHTML = html;
      el.querySelectorAll('.bucks-store-filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          activeCategory = btn.dataset.cat;
          buildFilters();
          buildGrid();
        });
      });
    });
  }

  /* ─── Build individual card HTML (Minimal & Compact) ─── */
  function buildCardHTML(app) {
    const installed = isInstalled(app.id);
    const installing = installingApps.has(app.id);

    return `
      <div class="bucks-store-card" data-app-id="${app.id}" data-category="${app.category}" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: var(--radius-bar); background: var(--card-bg); border: 1px solid var(--border-subtle); cursor: pointer; transition: all 0.2s ease;">
        
        <!-- Left: Icon and Name -->
        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; flex: 1;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, ${app.color || '#4f46e5'}, ${app.colorDark || '#3730a3'}); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; box-shadow: var(--shadow-sm);">
            ${app.icon || '📱'}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${app.name}
          </div>
        </div>

        <!-- Right: Actions -->
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          ${!installed ? `
            <button data-action="download-source" data-app-id="${app.id}" title="Download Source Zip" style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border-subtle); background: var(--input-bg); color: var(--text-secondary); cursor: pointer; transition: all 0.15s ease;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          ` : `
            <div title="Installed" style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(46, 213, 115, 0.1); color: #2ed573;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          `}
          <button data-action="preview" data-app-id="${app.id}" title="Launch Preview in New Tab" style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 10px; height: 28px; border-radius: 8px; background: var(--text-primary); color: var(--bg-body); font-size: 11px; font-weight: 700; border: none; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; transition: opacity 0.15s ease;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Preview
          </button>
        </div>
      </div>
    `;
  }

  /* ─── Build the grid ─── */
  function buildGrid() {
    const grids = document.querySelectorAll('#bucks-store-grid');
    if (!grids.length) return;

    const apps = (window.BUCKS_APPS || (typeof BUCKS_APPS !== 'undefined' ? BUCKS_APPS : [])).filter(a =>
      activeCategory === 'All' || a.category === activeCategory
    );

    const html = apps.length === 0 ? `
      <div class="bucks-store-empty" style="grid-column:1/-1;">
        <div style="font-size:32px; margin-bottom:12px;">🔍</div>
        <div style="font-size:15px; font-weight:600; color:var(--text-secondary);">No apps in this category yet</div>
      </div>
    ` : apps.map(buildCardHTML).join('');

    grids.forEach(grid => {
      grid.innerHTML = html;
      wireGridEvents(grid);
    });
  }

  /* ─── Wire card events ─── */
  function wireGridEvents(grid) {
    grid.querySelectorAll('.bucks-store-card').forEach(card => {
      const appId = card.dataset.appId;
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        openDrawer(appId);
      });
    });

    grid.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const appId = btn.dataset.appId;
        const action = btn.dataset.action;
        const app = (window.BUCKS_APPS || []).find(a => a.id === appId);
        if (!app) return;

        if (action === 'preview' || action === 'launch') {
          launchApp(app);
        } else if (action === 'download-source') {
          // Download source zip / open repository in Bucks Application New Tab
          const sourceZip = `${app.repoUrl}/archive/refs/heads/main.zip`;
          if (window.bucksBrowser && window.bucksBrowser.createTab) {
            window.bucksBrowser.createTab(sourceZip);
          } else if (window.createTab) {
            window.createTab(sourceZip);
          }
        } else if (action === 'install') {
          installApp(app, btn.closest('.bucks-store-card'));
        }
      });
    });
  }

  /* ─── Re-render a single card in-place ─── */
  function rerenderCard(appId) {
    const existing = document.querySelector(`.bucks-store-card[data-app-id="${appId}"]`);
    if (!existing) return;
    const app = (window.BUCKS_APPS || []).find(a => a.id === appId);
    if (!app) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = buildCardHTML(app);
    const newCard = tmp.firstElementChild;
    existing.parentNode.replaceChild(newCard, existing);
    wireGridEvents(newCard.closest('#bucks-store-grid') || document);
  }

  /* ─── Detail drawer ─── */
  function openDrawer(appId) {
    const app = (window.BUCKS_APPS || []).find(a => a.id === appId);
    if (!app) return;
    activeDrawerAppId = appId;
    drawerOpen = true;

    const drawer = document.getElementById('bucks-store-drawer');
    if (!drawer) return;

    const installed = isInstalled(appId);
    const curatorColor = app.curator === 'NIM' ? 'var(--accent)' : '#52b6ff';
    const tagHtml = app.tags.map(t => `<span class="bucks-store-tag">${t}</span>`).join('');

    drawer.innerHTML = `
      <div class="bucks-store-drawer-inner">
        <!-- Drawer header -->
        <div class="bucks-store-drawer-header">
          <button class="bucks-store-drawer-close" id="btn-drawer-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- App hero -->
        <div class="bucks-store-drawer-hero" style="background:linear-gradient(145deg, ${app.color}, ${app.colorDark});">
          <span class="bucks-store-drawer-icon">${app.icon}</span>
        </div>

        <!-- App info -->
        <div class="bucks-store-drawer-content">
          <div class="bucks-store-drawer-name">${app.name}</div>
          <div class="bucks-store-drawer-curator" style="color:${curatorColor};">Selected by ${app.curator}</div>
          <div class="bucks-store-drawer-desc">${app.description}</div>

          <!-- Curator note -->
          <div class="bucks-store-drawer-note">
            <div class="bucks-store-drawer-note-label" style="color:${curatorColor};">
              ${app.curator}'s take
            </div>
            <div class="bucks-store-drawer-note-text">"${app.curatorNote}"</div>
          </div>

          <!-- Tags -->
          <div class="bucks-store-drawer-tags">${tagHtml}</div>

          <!-- Meta -->
          <div class="bucks-store-drawer-meta">
            <div class="bucks-store-drawer-meta-row">
              <span class="bucks-store-drawer-meta-label">Category</span>
              <span class="bucks-store-drawer-meta-value">${app.category}</span>
            </div>
            <div class="bucks-store-drawer-meta-row">
              <span class="bucks-store-drawer-meta-label">License</span>
              <span class="bucks-store-drawer-meta-value">${app.license}</span>
            </div>
            <div class="bucks-store-drawer-meta-row">
              <span class="bucks-store-drawer-meta-label">Status</span>
              <span class="bucks-store-drawer-meta-value" style="color:${installed ? '#2ed573' : 'rgba(255,255,255,0.5)'};">
                ${installed ? '● Installed' : 'Available'}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="bucks-store-drawer-actions">
            <button class="bucks-store-drawer-btn primary" id="btn-drawer-launch" style="background:${app.color};">
              ${installed ? '🚀 Launch' : '✦ Open Web App'}
            </button>
            <button class="bucks-store-drawer-btn secondary" id="btn-drawer-preview">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Preview
            </button>
            ${installed
              ? `<button class="bucks-store-drawer-btn danger" id="btn-drawer-uninstall">Uninstall</button>`
              : `<button class="bucks-store-drawer-btn secondary" id="btn-drawer-install">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Install Locally
                </button>`
            }
          </div>

          <!-- GitHub link -->
          <a class="bucks-store-drawer-github" href="${app.repoUrl}" target="_blank">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.54-1.37-1.33-1.74-1.33-1.74-1.08-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.48 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
            View source on GitHub
          </a>
        </div>
      </div>
    `;

    // Show drawer
    drawer.classList.add('open');
    document.getElementById('bucks-store-drawer-overlay')?.classList.add('open');

    // Wire drawer buttons
    document.getElementById('btn-drawer-close')?.addEventListener('click', closeDrawer);
    document.getElementById('bucks-store-drawer-overlay')?.addEventListener('click', closeDrawer);

    document.getElementById('btn-drawer-launch')?.addEventListener('click', () => {
      launchApp(app);
      closeDrawer();
    });

    document.getElementById('btn-drawer-preview')?.addEventListener('click', () => {
      if (window.bucksBrowser && window.bucksBrowser.createTab) {
        window.bucksBrowser.createTab(app.runUrl);
      }
      closeDrawer();
    });

    document.getElementById('btn-drawer-install')?.addEventListener('click', () => {
      installApp(app);
      closeDrawer();
    });

    document.getElementById('btn-drawer-uninstall')?.addEventListener('click', () => {
      uninstallApp(app);
    });

    // GitHub link: open in new tab, don't navigate shell
    drawer.querySelectorAll('a[href]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.getAttribute('href');
        if (url && window.bucksBrowser && window.bucksBrowser.createTab) {
          window.bucksBrowser.createTab(url);
        }
        closeDrawer();
      });
    });
  }

  function closeDrawer() {
    drawerOpen = false;
    activeDrawerAppId = null;
    const drawer = document.getElementById('bucks-store-drawer');
    const overlay = document.getElementById('bucks-store-drawer-overlay');
    drawer?.classList.remove('open');
    overlay?.classList.remove('open');
  }

  /* ─── Inject CSS ─── */
  function injectStyles() {
    if (document.getElementById('bucks-store-styles')) return;
    const style = document.createElement('style');
    style.id = 'bucks-store-styles';
    style.textContent = `
      /* ═══════ VIEW LAYOUT ═══════ */
      #view-appstore {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        padding: 0;
        box-sizing: border-box;
        border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.08);
        background: linear-gradient(155deg, rgba(30,30,38,0.9), rgba(18,18,24,0.95));
        backdrop-filter: blur(40px);
        -webkit-backdrop-filter: blur(40px);
        position: relative;
      }

      /* ═══════ STORE HEADER ═══════ */
      .bucks-store-header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 22px 28px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        flex-shrink: 0;
      }
      .bucks-store-header-icon {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: linear-gradient(145deg, var(--accent-ring), rgba(82,182,255,0.6));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      }
      .bucks-store-header-title {
        font-family: 'Sora', sans-serif;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #fff;
      }
      .bucks-store-header-subtitle {
        font-size: 12px;
        color: rgba(255,255,255,0.4);
        margin-top: 2px;
      }
      .bucks-store-header-search {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: 12px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.5);
        font-size: 13px;
        min-width: 180px;
        cursor: text;
      }
      .bucks-store-search-input {
        background: transparent;
        border: none;
        outline: none;
        color: #fff;
        font-family: inherit;
        font-size: 13px;
        width: 100%;
      }
      .bucks-store-search-input::placeholder { color: rgba(255,255,255,0.35); }

      /* ═══════ CATEGORY FILTERS ═══════ */
      #bucks-store-filters {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 28px;
        flex-shrink: 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .bucks-store-filter-pill {
        padding: 6px 16px;
        border-radius: 99px;
        border: 1px solid rgba(255,255,255,0.12);
        background: transparent;
        color: rgba(255,255,255,0.55);
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .bucks-store-filter-pill:hover {
        background: rgba(255,255,255,0.08);
        color: #fff;
      }
      .bucks-store-filter-pill.active {
        background: rgba(255,255,255,0.14);
        color: #fff;
        border-color: rgba(255,255,255,0.25);
      }

      /* ═══════ APP GRID ═══════ */
      .bucks-store-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 20px 28px 32px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.12) transparent;
      }
      .bucks-store-scroll::-webkit-scrollbar { width: 5px; }
      .bucks-store-scroll::-webkit-scrollbar-track { background: transparent; }
      .bucks-store-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }

      #bucks-store-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 14px;
      }

      /* ═══════ MINIMAL APP CARD ═══════ */
      .bucks-store-card.minimal {
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.035);
        backdrop-filter: blur(24px);
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        position: relative;
      }
      .bucks-store-card.minimal:hover {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(255, 255, 255, 0.22);
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      }
      .bucks-store-icon-wrapper {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 12px rgba(0,0,0,0.3);
      }
      .bucks-store-small-icon {
        font-size: 22px;
        line-height: 1;
      }
      .bucks-store-meta-minimal {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .bucks-store-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .bucks-store-name {
        font-family: 'Sora', sans-serif;
        font-size: 14px;
        font-weight: 700;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bucks-store-badge-curator {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 1px 6px;
        border-radius: 99px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.12);
      }
      .bucks-store-tagline {
        font-size: 11.5px;
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bucks-store-actions-minimal {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .bucks-store-icon-btn {
        width: 32px;
        height: 32px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .bucks-store-icon-btn:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.3);
      }
      .bucks-store-preview-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        backdrop-filter: blur(12px);
      }
      .bucks-store-preview-btn:hover {
        background: rgba(255, 255, 255, 0.22);
        border-color: rgba(255, 255, 255, 0.35);
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      }
      .bucks-store-installed-tag {
        font-size: 11px;
        font-weight: 700;
        color: #4ade80;
        background: rgba(74, 222, 128, 0.12);
        border: 1px solid rgba(74, 222, 128, 0.25);
        padding: 4px 8px;
        border-radius: 8px;
      }
        opacity: 0.75;
      }

      /* Empty state */
      .bucks-store-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px 20px;
        text-align: center;
        color: rgba(255,255,255,0.5);
      }

      /* ═══════ DETAIL DRAWER ═══════ */
      #bucks-store-drawer-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.4);
        z-index: 10;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
        border-radius: 20px;
      }
      #bucks-store-drawer-overlay.open {
        opacity: 1;
        pointer-events: auto;
      }

      #bucks-store-drawer {
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        width: 400px;
        max-width: 90%;
        background: linear-gradient(165deg, rgba(36,36,44,0.98), rgba(22,22,30,0.99));
        backdrop-filter: blur(50px);
        -webkit-backdrop-filter: blur(50px);
        border-left: 1px solid rgba(255,255,255,0.1);
        z-index: 11;
        transform: translateX(100%);
        transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        border-radius: 0 20px 20px 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #bucks-store-drawer.open {
        transform: translateX(0);
      }
      .bucks-store-drawer-inner {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.1) transparent;
      }
      .bucks-store-drawer-header {
        display: flex;
        justify-content: flex-end;
        padding: 12px 14px;
        position: sticky;
        top: 0;
        background: rgba(22,22,30,0.6);
        backdrop-filter: blur(10px);
        z-index: 1;
      }
      .bucks-store-drawer-close {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.07);
        color: rgba(255,255,255,0.7);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .bucks-store-drawer-close:hover { background: rgba(255,255,255,0.14); color: #fff; }

      .bucks-store-drawer-hero {
        height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 20px;
        border-radius: 16px;
      }
      .bucks-store-drawer-icon { font-size: 52px; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.4)); }

      .bucks-store-drawer-content {
        padding: 20px 24px 32px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .bucks-store-drawer-name {
        font-family: 'Sora', sans-serif;
        font-size: 22px;
        font-weight: 700;
        color: #fff;
        letter-spacing: -0.02em;
      }
      .bucks-store-drawer-curator {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-top: -8px;
      }
      .bucks-store-drawer-desc {
        font-size: 13.5px;
        color: rgba(255,255,255,0.7);
        line-height: 1.6;
      }

      .bucks-store-drawer-note {
        padding: 14px;
        border-radius: 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .bucks-store-drawer-note-label {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-bottom: 6px;
      }
      .bucks-store-drawer-note-text {
        font-size: 12.5px;
        color: rgba(255,255,255,0.6);
        line-height: 1.55;
        font-style: italic;
      }

      .bucks-store-drawer-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .bucks-store-tag {
        padding: 4px 10px;
        border-radius: 99px;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.1);
        font-size: 11px;
        color: rgba(255,255,255,0.55);
        font-weight: 500;
      }

      .bucks-store-drawer-meta {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .bucks-store-drawer-meta-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .bucks-store-drawer-meta-label {
        font-size: 11.5px;
        color: rgba(255,255,255,0.4);
        font-weight: 600;
      }
      .bucks-store-drawer-meta-value {
        font-size: 12px;
        color: rgba(255,255,255,0.7);
        font-weight: 500;
      }

      .bucks-store-drawer-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .bucks-store-drawer-btn {
        padding: 11px 16px;
        border-radius: 12px;
        border: none;
        cursor: pointer;
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 13.5px;
        font-weight: 700;
        transition: opacity 0.15s, transform 0.1s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        width: 100%;
      }
      .bucks-store-drawer-btn:hover { opacity: 0.85; }
      .bucks-store-drawer-btn:active { transform: scale(0.98); }
      .bucks-store-drawer-btn.primary {
        color: #fff;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      }
      .bucks-store-drawer-btn.secondary {
        background: rgba(255,255,255,0.09);
        color: rgba(255,255,255,0.8);
        border: 1px solid rgba(255,255,255,0.12);
      }
      .bucks-store-drawer-btn.danger {
        background: rgba(239,68,68,0.15);
        color: #ef4444;
        border: 1px solid rgba(239,68,68,0.25);
      }

      .bucks-store-drawer-github {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: rgba(255,255,255,0.45);
        text-decoration: none;
        padding: 8px 0;
        border-top: 1px solid rgba(255,255,255,0.07);
        cursor: pointer;
        transition: color 0.15s;
      }
      .bucks-store-drawer-github:hover { color: rgba(255,255,255,0.8); }

      /* ═══════ SECTION LABEL ═══════ */
      .bucks-store-section-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255,255,255,0.35);
        margin-bottom: 14px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
    `;
    document.head.appendChild(style);
  }

  /* ─── Build + mount the view ─── */
  function buildView() {
    const viewAppStore = document.getElementById('view-appstore');
    const storeOverlay = document.getElementById('store-overlay');

    const appStoreHTML = `
      <div style="width:100%; height:100%; border-radius:24px; padding:24px 28px; background:linear-gradient(155deg,rgba(26,26,34,0.92),rgba(14,14,20,0.96)); backdrop-filter:blur(50px); border:1px solid rgba(255,255,255,0.14); box-shadow:0 30px 90px rgba(0,0,0,0.6); display:flex; flex-direction:column; box-sizing:border-box;">
        <!-- Header -->
        <div class="bucks-store-header">
          <div class="bucks-store-header-icon">⊞</div>
          <div style="flex: 1;">
            <div class="bucks-store-header-title">Bucks App Store</div>
            <div class="bucks-store-header-subtitle">Curated open-source web apps · Small icons, local downloads &amp; tab previews</div>
          </div>
          <div class="bucks-store-header-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
            <input type="text" class="bucks-store-search-input" id="bucks-store-search-input" placeholder="Search apps…" />
          </div>
        </div>

        <!-- Category filters -->
        <div id="bucks-store-filters"></div>

        <!-- Scrollable grid area -->
        <div class="bucks-store-scroll" style="flex: 1; overflow-y: auto;">
          <div class="bucks-store-section-label">Curated Minimal Applications</div>
          <div id="bucks-store-grid"></div>
        </div>
      </div>

      <!-- Drawer backdrop + drawer -->
      <div id="bucks-store-drawer-overlay"></div>
      <div id="bucks-store-drawer"></div>
    `;

    if (viewAppStore) {
      viewAppStore.innerHTML = appStoreHTML;
    }
    if (storeOverlay) {
      storeOverlay.innerHTML = appStoreHTML;
    }

    // Wire search
    const searchInput = document.getElementById('bucks-store-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        document.querySelectorAll('.bucks-store-card').forEach(card => {
          const appId = card.dataset.appId;
          const app = (window.BUCKS_APPS || []).find(a => a.id === appId);
          if (!app) return;
          const match = !q ||
            app.name.toLowerCase().includes(q) ||
            app.tagline.toLowerCase().includes(q) ||
            app.tags.some(t => t.includes(q));
          card.style.display = match ? '' : 'none';
        });
      });
    }

    const closeBtn = document.getElementById('btn-close-store');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        view.classList.add('hidden');
      });
    }

    buildFilters();
    buildGrid();
  }

  /* ─── Initialize ─── */
  function init() {
    const apps = window.BUCKS_APPS || (typeof BUCKS_APPS !== 'undefined' ? BUCKS_APPS : null);
    if (!apps || !apps.length) {
      setTimeout(init, 100);
      return;
    }
    if (typeof window !== 'undefined') window.BUCKS_APPS = apps;
    injectStyles();
    buildView();
  }

  // Auto-initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for renderer.js to call when view is shown
  window.appStore = window.bucksAppStore = { init, buildGrid, closeDrawer, buildView };

})();

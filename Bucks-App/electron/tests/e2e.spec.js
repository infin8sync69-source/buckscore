const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Bucks E2E & Visual Regression Suite', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    // Launch Electron and await the shell window. In dev the app also opens
    // a DevTools window, so firstWindow() is racy — select by URL instead.
    electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, BUCKS_TESTING: '1' }
    });
    const deadline = Date.now() + 20000;
    for (;;) {
      page = electronApp.windows().find(w => w.url().includes('index.html'));
      if (page) break;
      if (Date.now() > deadline) throw new Error('Shell window (index.html) never appeared');
      await new Promise(r => setTimeout(r, 250));
    }
    page.on('console', msg => console.log(`[E2E CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[E2E PAGE ERROR]: ${err.message}`));
    await page.waitForLoadState('domcontentloaded');
    // Deterministic boot: drop any restored session from earlier runs/usage,
    // then reload so the suite always starts from a single fresh tab.
    await page.evaluate(() => localStorage.removeItem('bucks-session-v2'));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('Smoke Test: App boot and persistent elements', async () => {
    expect(await page.title()).toBe('Bucks Browser');

    // Verify address bar is present and functional
    const addressBar = page.locator('#address-bar');
    await expect(addressBar).toBeVisible();

    // The agent chat panel is on-demand: it must exist in the DOM but stay
    // hidden until the user opens it from the omnibar / new-tab zone.
    const agentPanel = page.locator('#nav-chat-panel');
    await expect(agentPanel).toBeAttached();
    await expect(agentPanel).toBeHidden();
  });

  test('Visual Regression: omnibar chrome', async () => {
    // The chat panel is transient (docks in and out around chat turns), so
    // the persistent omnibar area is the stable regression target.
    const omnibar = page.locator('#url-search-wrap');
    await expect(omnibar).toBeVisible();
    await expect(omnibar).toHaveScreenshot('omnibar-chrome.png', {
      maxDiffPixelRatio: 0.05
    });
  });

  test('Spatial layout: page renders in the stage, clear of the agent dock', async () => {
    // Navigate via the global agent bar (URL input → tab navigation).
    await page.fill('#nt-search-input', 'https://example.com');
    await page.press('#nt-search-input', 'Enter');
    await page.waitForTimeout(3500);

    const shell = await page.evaluate(() => {
      const bar = document.getElementById('composer-bar');
      return {
        webMode: document.body.classList.contains('web-mode'),
        barTop: bar ? bar.getBoundingClientRect().top : null,
        inner: [innerWidth, innerHeight],
      };
    });
    expect(shell.webMode).toBe(true);
    expect(shell.barTop).not.toBeNull();

    // The native WebContentsView must stop above the agent dock band — the
    // dock is shell DOM and a native view would otherwise paint over it.
    const views = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      return win.contentView.children.map((v) => ({ bounds: v.getBounds(), visible: v.getVisible() }));
    });
    const active = views.find((v) => v.visible);
    expect(active).toBeTruthy();
    expect(active.bounds.y + active.bounds.height).toBeLessThanOrEqual(shell.barTop);
  });

  test('Spatial panes: split, geometry, agent tools, unsplit', async () => {
    // Runs after the spatial-layout test, so the active tab shows example.com.
    await page.click('#btn-split');
    await page.waitForTimeout(2500);

    // Shell DOM: a stage with two pane frames, each with a header.
    const shellState = await page.evaluate(() => ({
      stages: document.querySelectorAll('.pane-stage.active').length,
      frames: document.querySelectorAll('.pane-stage.active .pane-frame').length,
      headers: document.querySelectorAll('.pane-stage.active .pane-header').length,
      focused: document.querySelectorAll('.pane-frame.focused').length,
    }));
    expect(shellState.stages).toBe(1);
    expect(shellState.frames).toBe(2);
    expect(shellState.headers).toBe(2);
    expect(shellState.focused).toBe(1);

    // Native plane: two visible views, side by side, both clear of the dock
    // band and neither covering the other's pane header.
    const barTop = await page.evaluate(() =>
      document.getElementById('composer-bar').getBoundingClientRect().top);
    const views = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      return win.contentView.children.map((v) => ({ bounds: v.getBounds(), visible: v.getVisible() }));
    });
    const vis = views.filter((v) => v.visible);
    expect(vis.length).toBe(2);
    for (const v of vis) expect(v.bounds.y + v.bounds.height).toBeLessThanOrEqual(barTop);
    const [a, b] = vis.map((v) => v.bounds).sort((p, q) => p.x - q.x);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + 2); // no horizontal overlap

    // Agent surface: panes_list and workspace_sweep run end-to-end (same
    // dispatcher the soul engine's browser_action events hit).
    const paneList = await page.evaluate(() => window.__bucksBrowserControl.execute('panes_list', {}));
    expect(paneList).toContain('[p');
    expect(paneList).toContain('example.com');

    const sweep = await page.evaluate(() => window.__bucksBrowserControl.execute('workspace_sweep', {}));
    expect(sweep).toContain('Swept 2 pane(s)');
    expect(sweep.toLowerCase()).toContain('example domain');

    // Close one pane → workspace collapses back to a plain full-stage tab.
    const closed = await page.evaluate(() => {
      const pm = window.bucksPaneManager;
      const tabId = document.querySelector('.pane-stage.active').dataset.tabId;
      const panes = pm.listPanes(tabId);
      return pm.closePane(tabId, panes[1].id);
    });
    expect(closed).toBe(true);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
      stages: document.querySelectorAll('.pane-stage').length,
      hosts: document.querySelectorAll('#browser-content > .webview-host').length,
    }));
    expect(after.stages).toBe(0);
    expect(after.hosts).toBeGreaterThanOrEqual(1);
  });

  test('Performance Benchmarks: Memory Limits', async () => {
    // Pull main process memory usage statistics via the bucksAPI preload bridge
    const memory = await page.evaluate(async () => {
      if (window.bucksAPI && typeof window.bucksAPI.getMemoryUsage === 'function') {
        return await window.bucksAPI.getMemoryUsage();
      }
      return null;
    });

    if (memory) {
      const heapUsedMB = memory.heapUsed / (1024 * 1024);
      console.log(`[Performance Benchmark] Current JS Heap Used: ${heapUsedMB.toFixed(2)} MB`);

      // Verify process matches Idle State Budget (< 80MB)
      expect(heapUsedMB).toBeLessThan(80);
    } else {
      console.warn('[Performance Benchmark] process.memoryUsage was not retrieved.');
    }
  });
});

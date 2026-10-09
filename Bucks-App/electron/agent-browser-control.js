/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS AGENTIC BROWSER — RENDERER-SIDE ACTUATION LAYER      ║
   ║                                                            ║
   ║  Lets the agent loop operate the *live* <webview> the user ║
   ║  sees: read an indexed accessibility snapshot, screenshot, ║
   ║  click / type / scroll / navigate. This is the piece that  ║
   ║  turns Bucks from "reads a copy of the web" into an agent  ║
   ║  that drives the real tab.                                  ║
   ║                                                            ║
   ║  Bound by renderer.js via window.__bucksBrowserControl.bind║
   ║  (getActiveWebview). The Soul Engine proxies browser_*      ║
   ║  tool calls here over SSE; execute(name,args) runs them.    ║
   ╚══════════════════════════════════════════════════════════╝ */
(function () {
  'use strict';

  let getActiveWebview = () => null;
  // Pane surface (renderer.js glue over pane-manager.js): list/resolve/open/
  // close/focus/arrange/setReading/presets. Null on shells without panes.
  let paneApi = null;

  // Any browser_* tool takes an optional `pane` (id like "p3", 1-based index,
  // or "focused"); without it, the focused pane / single page is the target.
  function resolveWv(args) {
    if (args && args.pane != null && paneApi) {
      const wv = paneApi.resolve(args.pane);
      if (!wv) throw new Error(`No pane "${args.pane}" — call panes_list to see current panes.`);
      return wv;
    }
    return getActiveWebview();
  }

  // Injected into the page to produce a compact, indexed snapshot of the
  // interactive elements. Each element is tagged with data-bucks-ref so a
  // later click/type can locate it deterministically.
  const SNAPSHOT_SCRIPT = `(() => {
    const SEL = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=textbox], [onclick], [contenteditable=true]';
    const out = [];
    let ref = 0;
    const nodes = document.querySelectorAll(SEL);
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.right > 0 &&
        rect.top < (window.innerHeight || 0) + 600;
      if (!visible) continue;
      el.setAttribute('data-bucks-ref', String(ref));
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      let name = (el.getAttribute('aria-label') || el.placeholder || el.value ||
        el.innerText || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ');
      if (name.length > 80) name = name.slice(0, 80) + '…';
      out.push({ ref, role, tag, type: el.type || '', name });
      ref++;
      if (ref >= 150) break;
    }
    return {
      url: location.href,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.body ? document.body.scrollHeight : 0,
      elements: out,
    };
  })()`;

  function execInWebview(wv, code) {
    return new Promise((resolve, reject) => {
      if (!wv || typeof wv.executeJavaScript !== 'function') {
        return reject(new Error('No active web tab to act on.'));
      }
      try {
        // userGesture=true so clicks/focus behave like real input.
        wv.executeJavaScript(code, true).then(resolve).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function snapshot(wv) {
    const snap = await execInWebview(wv, SNAPSHOT_SCRIPT);
    return snap;
  }

  // Render the snapshot as a compact text block the model can reason over.
  function formatSnapshot(snap) {
    if (!snap) return 'No page loaded.';
    const lines = snap.elements.map(
      (e) => `[${e.ref}] ${e.role}${e.type ? '(' + e.type + ')' : ''}: ${e.name || '(no label)'}`
    );
    return [
      `URL: ${snap.url}`,
      `Title: ${snap.title}`,
      `Scroll: ${snap.scrollY}/${snap.scrollHeight}`,
      `Interactive elements:`,
      ...lines,
    ].join('\n');
  }

  async function clickRef(wv, ref) {
    const code = `(() => {
      const el = document.querySelector('[data-bucks-ref="' + ${JSON.stringify(String(ref))} + '"]');
      if (!el) return { ok: false, error: 'ref not found' };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true };
    })()`;
    return execInWebview(wv, code);
  }

  async function typeRef(wv, ref, text) {
    const code = `(() => {
      const el = document.querySelector('[data-bucks-ref="' + ${JSON.stringify(String(ref))} + '"]');
      if (!el) return { ok: false, error: 'ref not found' };
      el.focus();
      const v = ${JSON.stringify(String(text))};
      if ('value' in el) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.textContent = v;
      }
      return { ok: true };
    })()`;
    return execInWebview(wv, code);
  }

  async function scroll(wv, direction) {
    const dy = direction === 'up' ? -600 : 600;
    return execInWebview(wv, `(() => { window.scrollBy(0, ${dy}); return { ok: true, scrollY: window.scrollY }; })()`);
  }

  async function screenshot(wv) {
    // WebContentsView shim path (tab-view.js): capture happens in main.
    if (wv && typeof wv.capturePageBase64 === 'function') {
      return wv.capturePageBase64();
    }
    if (!wv || typeof wv.capturePage !== 'function') {
      throw new Error('Screenshot not available for this tab.');
    }
    const img = await wv.capturePage();
    return img.toPNG().toString('base64');
  }

  function navigate(wv, url) {
    if (!wv) throw new Error('No active web tab.');
    let target = String(url || '').trim();
    if (!/^[a-z]+:\/\//i.test(target) && !target.startsWith('bucks://')) {
      target = 'https://' + target;
    }
    wv.src = target;
    return { ok: true, url: target };
  }

  /* ── workspace (multi-pane) helpers ── */

  const EXTRACT_SCRIPT = `(() => ({
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 1500),
  }))()`;

  function formatPaneList(panes) {
    if (!panes.length) return 'No panes — the current tab has no page loaded.';
    return 'Panes in the current tab:\n' + panes.map((p) =>
      `[${p.id}] (${p.index}) ${p.focused ? '● focused ' : ''}${p.title || '(untitled)'} — ${p.url || 'about:blank'}${p.openedBy === 'agent' ? ' (opened by agent)' : ''}`
    ).join('\n');
  }

  function showWorkspaceCard() {
    if (!paneApi || !window.__bucksWorkspaceCard) return;
    const panes = paneApi.list();
    window.__bucksWorkspaceCard({
      component: 'workspace_overview',
      title: 'Workspace',
      data: { panes, presets: panes.length > 1 ? (paneApi.presets || []) : [] },
    });
  }

  async function workspaceSweep(wantScreenshots) {
    const panes = paneApi.list();
    if (!panes.length) return 'Nothing to sweep — no page is loaded in this tab.';
    const digests = [];
    const cards = [];
    for (const p of panes) {
      const wv = paneApi.resolve(p.id);
      if (!wv) continue;
      paneApi.setReading && paneApi.setReading(p.id, true);
      let info = { url: p.url, title: p.title, text: '' };
      try { info = await execInWebview(wv, EXTRACT_SCRIPT); } catch (_) {}
      let thumb = '';
      try {
        const b64 = await screenshot(wv);
        thumb = 'data:image/png;base64,' + b64;
      } catch (_) {}
      paneApi.setReading && paneApi.setReading(p.id, false);
      digests.push(`── Pane [${p.id}] ${info.title || ''} (${info.url || ''}) ──\n${info.text || '(no readable text)'}`);
      cards.push({
        id: p.id, title: info.title || p.title, url: info.url || p.url,
        summary: (info.text || '').slice(0, 220),
        thumb: wantScreenshots === false ? '' : thumb,
      });
    }
    if (window.__bucksWorkspaceCard) {
      window.__bucksWorkspaceCard({
        component: 'sweep_digest',
        title: `Swept ${cards.length} pane${cards.length === 1 ? '' : 's'}`,
        data: { items: cards },
      });
    }
    return `Swept ${digests.length} pane(s).\n\n` + digests.join('\n\n');
  }

  // Dispatcher. Names mirror the browser_control tool schemas in soul_engine.py.
  async function execute(name, args) {
    args = args || {};
    const wv = resolveWv(args);

    switch (name) {
      case 'browser_read_page': {
        const snap = await snapshot(wv);
        return formatSnapshot(snap);
      }
      case 'browser_navigate': {
        const r = navigate(wv, args.url);
        // Give the page a moment, then return a fresh snapshot.
        await new Promise((res) => setTimeout(res, 1200));
        return `Navigated to ${r.url}\n\n` + formatSnapshot(await snapshot(wv).catch(() => null));
      }
      case 'browser_click': {
        const r = await clickRef(wv, args.ref);
        if (!r.ok) return `Click failed: ${r.error}`;
        await new Promise((res) => setTimeout(res, 800));
        return `Clicked [${args.ref}].\n\n` + formatSnapshot(await snapshot(wv).catch(() => null));
      }
      case 'browser_type': {
        const r = await typeRef(wv, args.ref, args.text);
        if (!r.ok) return `Type failed: ${r.error}`;
        return `Typed into [${args.ref}].`;
      }
      case 'browser_scroll': {
        await scroll(wv, args.direction);
        return formatSnapshot(await snapshot(wv).catch(() => null));
      }
      case 'browser_screenshot': {
        const b64 = await screenshot(wv);
        return { text: 'Screenshot of the current tab.', screenshot_b64: b64, media_type: 'image/png' };
      }

      /* ── spatial workspace tools (multi-pane tabs, pane-manager.js) ── */
      case 'panes_list': {
        if (!paneApi) return 'Panes are not available in this window.';
        showWorkspaceCard();
        return formatPaneList(paneApi.list());
      }
      case 'pane_open': {
        if (!paneApi) return 'Panes are not available in this window.';
        const r = paneApi.open(args.url, { preset: args.layout });
        if (r && r.error) return r.error;
        await new Promise((res) => setTimeout(res, 1200));
        showWorkspaceCard();
        return `Opened pane [${r}] with ${args.url}.\n\n` + formatPaneList(paneApi.list());
      }
      case 'pane_close': {
        if (!paneApi) return 'Panes are not available in this window.';
        const ok = paneApi.close(args.pane);
        return ok ? `Closed pane [${args.pane}].\n\n` + formatPaneList(paneApi.list())
                  : `No pane "${args.pane}" to close.`;
      }
      case 'pane_focus': {
        if (!paneApi) return 'Panes are not available in this window.';
        return paneApi.focus(args.pane)
          ? `Focused pane [${args.pane}].`
          : `No pane "${args.pane}" — call panes_list first.`;
      }
      case 'pane_arrange': {
        if (!paneApi) return 'Panes are not available in this window.';
        return paneApi.arrange(args.preset)
          ? `Arranged panes with the "${args.preset}" layout.`
          : `Unknown layout "${args.preset}". Available: ${(paneApi.presets || []).join(', ')}.`;
      }
      case 'workspace_sweep': {
        if (!paneApi) return 'Panes are not available in this window.';
        return workspaceSweep(args.screenshots !== false);
      }

      /* ── document production (doc-factory.js, ~/Documents/Bucks) ── */
      case 'create_document': {
        if (!window.bucksDocs) return 'Document output is not available in this window.';
        if (!args.content) return 'create_document needs "content" (markdown).';
        const r = await window.bucksDocs.create(
          args.title || 'Document', args.content, args.format || 'md');
        return `Document saved to ${r.path} (revealed in Finder).`;
      }
      case 'create_pdf': {
        if (!window.bucksDocs) return 'Document output is not available in this window.';
        if (!args.content) return 'create_pdf needs "content" (markdown).';
        const r = await window.bucksDocs.createPdf(args.title || 'Report', args.content);
        return `PDF report saved to ${r.path} (revealed in Finder).`;
      }
      case 'page_to_pdf': {
        // Snapshot the LIVE page (current tab or addressed pane) into a PDF.
        if (!wv || !wv.tabViewId) return 'No web page is open to print — navigate somewhere first.';
        const r = await window.bucksTabs.printToPDF(wv.tabViewId, args.title);
        return `Page saved as PDF: ${r.path} (revealed in Finder).`;
      }

      default:
        return `Unknown browser tool: ${name}`;
    }
  }

  window.__bucksBrowserControl = {
    bind(fn) { getActiveWebview = fn; },
    bindPanes(api) { paneApi = api; },
    execute,
    snapshot: () => snapshot(getActiveWebview()),
  };
})();

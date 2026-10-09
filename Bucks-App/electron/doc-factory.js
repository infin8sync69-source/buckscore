/* ╔══════════════════════════════════════════════════════════╗
   ║  BUCKS DOC FACTORY — agent document/report/PDF output      ║
   ║                                                            ║
   ║  Main-process side of the create_document / create_pdf /   ║
   ║  page_to_pdf agent tools (agent-browser-control.js).       ║
   ║  Markdown the agent wrote is rendered here (escaped —      ║
   ║  model output is data, never markup), wrapped in a print   ║
   ║  stylesheet, and either saved as .md/.html/.txt or turned  ║
   ║  into a PDF via an offscreen window's printToPDF.          ║
   ║  Everything lands in ~/Documents/Bucks/ — never an         ║
   ║  arbitrary path (filenames are slugified, no traversal).   ║
   ╚══════════════════════════════════════════════════════════╝ */
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function outputDir() {
  const dir = path.join(app.getPath('documents'), 'Bucks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slug(title) {
  const s = String(title || 'document')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'document';
}

// Unique path inside ~/Documents/Bucks — never overwrites an existing file.
function targetPath(title, ext) {
  const dir = outputDir();
  const base = slug(title);
  let p = path.join(dir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base}-${i}.${ext}`);
  return p;
}

/* ── tiny markdown renderer ──
   Only generates tags itself; every piece of source text is entity-escaped
   first, so agent output can't inject markup or scripts into the document. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2">$1</a>');
  return out;
}

function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;   // 'ul' | 'ol'
  let inCode = false;
  let codeBuf = [];
  let table = null;  // { header: [], rows: [] }

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => {
    if (!table) return;
    const th = table.header.map((c) => `<th>${inline(c)}</th>`).join('');
    const trs = table.rows.map((r) =>
      `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
    out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
    table = null;
  };

  for (const raw of lines) {
    const line = raw;

    if (/^```/.test(line.trim())) {
      closeList(); closeTable();
      if (inCode) { out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const t = line.trim();

    // table rows: | a | b |
    if (/^\|(.+)\|$/.test(t)) {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    closeTable();

    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^(---|\*\*\*)\s*$/.test(t)) { closeList(); out.push('<hr>'); continue; }
    if (/^>\s?/.test(t)) { closeList(); out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`); continue; }

    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    const ul = t.match(/^[-*+]\s+(.*)$/);
    if (ol || ul) {
      const kind = ol ? 'ol' : 'ul';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ol || ul)[1])}</li>`);
      continue;
    }
    closeList();

    if (t === '') continue;
    out.push(`<p>${inline(t)}</p>`);
  }
  if (inCode && codeBuf.length) out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`);
  closeList(); closeTable();
  return out.join('\n');
}

function documentHtml(title, md) {
  const date = new Date().toLocaleDateString(undefined,
    { year: 'numeric', month: 'long', day: 'numeric' });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
         color: #1a1a1e; margin: 48px 56px; line-height: 1.55; font-size: 13.5px; }
  .doc-head { border-bottom: 2px solid #1a1a1e; padding-bottom: 14px; margin-bottom: 28px; }
  .doc-head h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.02em; }
  .doc-head .meta { color: #6b6b74; font-size: 11.5px; }
  h1, h2, h3, h4 { letter-spacing: -0.01em; margin: 1.4em 0 0.5em; }
  h2 { font-size: 19px; border-bottom: 1px solid #e2e2e8; padding-bottom: 4px; }
  h3 { font-size: 15.5px; }
  a { color: #5b2fd4; text-decoration: none; }
  code { background: #f2f2f6; border-radius: 4px; padding: 1px 5px;
         font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
  pre { background: #f6f6fa; border: 1px solid #e6e6ee; border-radius: 8px;
        padding: 12px 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #c9b8f5; margin: 0.8em 0; padding: 2px 14px;
               color: #55555e; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 12.5px; }
  th, td { border: 1px solid #dcdce4; padding: 6px 10px; text-align: left; }
  th { background: #f4f2fb; }
  hr { border: none; border-top: 1px solid #e2e2e8; margin: 1.6em 0; }
  .doc-foot { margin-top: 40px; padding-top: 10px; border-top: 1px solid #e2e2e8;
              color: #9a9aa4; font-size: 10.5px; }
</style></head><body>
<div class="doc-head"><h1>${esc(title)}</h1>
<div class="meta">${esc(date)} · generated by Bucks Agent</div></div>
${mdToHtml(md)}
<div class="doc-foot">Bucks Browser</div>
</body></html>`;
}

/* ── HTML → PDF via an offscreen window ── */
async function htmlToPdf(html, pdfPath) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const data = await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true,
      margins: { marginType: 'none' },
    });
    fs.writeFileSync(pdfPath, data);
  } finally {
    win.destroy();
  }
  return pdfPath;
}

function setupDocFactoryIPC() {
  // Save agent-authored content as a document (.md / .html / .txt).
  ipcMain.handle('docs:create', async (_e, { title, content, format }) => {
    const fmt = ['md', 'html', 'txt'].includes(format) ? format : 'md';
    const p = targetPath(title, fmt);
    const body = fmt === 'html' ? documentHtml(title, content) : String(content || '');
    fs.writeFileSync(p, body, 'utf8');
    try { shell.showItemInFolder(p); } catch (_) {}
    return { path: p };
  });

  // Render agent-authored markdown into a styled PDF.
  ipcMain.handle('docs:createPdf', async (_e, { title, content }) => {
    const p = targetPath(title, 'pdf');
    await htmlToPdf(documentHtml(title, content), p);
    try { shell.showItemInFolder(p); } catch (_) {}
    return { path: p };
  });
}

module.exports = { setupDocFactoryIPC, documentHtml, mdToHtml, targetPath };

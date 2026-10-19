/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  SHELL TRUST — which renderers count as "the Bucks shell"              ║
   ║                                                                        ║
   ║  Privileged IPC (driving tabs, reading the agent token, wallet and     ║
   ║  web-fetch helpers) must only answer the pages we ship. Trust is an    ║
   ║  exact match on the page's file path, never a substring test: the old  ║
   ║  check trusted any file:// URL containing "index.html" and anything on ║
   ║  localhost:3000 (C-02).                                                ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

const SHELL_PAGE = path.join(__dirname, 'index.html');
const EPHEMERAL_PAGE = path.join(__dirname, 'ephemeral.html');

/** True when `rawUrl` is a file:// URL for one of `pages` (hash/query ignored). */
function isShellPage(rawUrl, pages = [SHELL_PAGE]) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { return false; }
  if (u.protocol !== 'file:') return false;
  let file;
  try { file = path.normalize(fileURLToPath(u)); } catch (_) { return false; }
  return pages.includes(file);
}

/**
 * True when an IPC event comes from the top frame of one of `pages`.
 * Subframes are excluded: an iframe inside the shell is not the shell.
 */
function isShellSender(event, pages = [SHELL_PAGE]) {
  const frame = event && event.senderFrame;
  return !!frame && frame.parent === null && isShellPage(frame.url, pages);
}

module.exports = { SHELL_PAGE, EPHEMERAL_PAGE, isShellPage, isShellSender };

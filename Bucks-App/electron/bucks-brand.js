/* ─────────────────────────────────────────────────────────────────────────
   Bucks Brand — one minimal, typographic mark.

   Deliberately plain: a wordmark set in the type the app actually ships,
   with an optional context label. No gradient fills, no glow, no uppercase
   letterspaced "badge" treatment — the palette is neutral by design and the
   mark should read as a signature, not an ornament.

   Note on type: the app referenced 'Sora' in many places, but no @font-face
   ever loaded it, so those headings silently fell back to Helvetica. This
   component uses the bundled families only — Instrument Sans and IBM Plex
   Mono — so what is designed is what actually renders.

   Usage:
     BucksBrand.mark({ context: 'Search', size: 'sm' })  -> HTMLElement
     BucksBrand.html({ context: 'Search' })              -> string
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /**
   * @param {{context?: string, size?: 'sm'|'md'|'lg', mono?: boolean, icon?: boolean}} opts
   *   context — small label after the rule ("Search", "Research", "Agent")
   *   size    — sm (inline/section), md (panel header), lg (empty states)
   *   icon    — boolean (default true) to show the 3D minimal glass emblem
   */
  function html(opts) {
    const o = opts || {};
    const size = ['sm', 'md', 'lg'].includes(o.size) ? o.size : 'sm';
    const showIcon = o.icon !== false;
    const px = size === 'lg' ? 24 : size === 'md' ? 18 : 14;
    return `<span class="bucks-mark bucks-mark-${size}">
      ${showIcon ? `<img class="bucks-mark-glyph" src="brand/dist/icons/32x32.png" width="${px}" height="${px}" alt="" aria-hidden="true">` : ''}
      <span class="bucks-wordmark">bucks</span>
      ${o.context ? `<span class="bucks-rule" aria-hidden="true"></span>
      <span class="bucks-context">${esc(o.context)}</span>` : ''}
    </span>`;
  }

  function mark(opts) {
    const el = document.createElement('span');
    el.innerHTML = html(opts).trim();
    return el.firstElementChild;
  }

  window.BucksBrand = { mark, html };
})();

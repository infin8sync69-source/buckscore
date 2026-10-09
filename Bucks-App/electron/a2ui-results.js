/* ─────────────────────────────────────────────────────────────────────────
   A2UI Results — unified, thumbnail-first result surface.

   Web hits, images and videos all normalise into ONE item shape and render
   through ONE of several layouts, so a mixed result set reads as a single
   designed surface instead of three stacked widgets.

   Colour comes entirely from the tokens in styles.css. That file states the
   rule plainly — "emphasis is luminance, not hue" — so nothing here hardcodes
   a hue, and every surface works in both themes.

   Public API:
     A2UIResults.normalize(component, data) -> item[]
     A2UIResults.pickLayout(items)          -> layout id
     A2UIResults.render(items, opts)        -> HTMLElement
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const attr = (s) => esc(s).replace(/\n/g, ' ');

  const LAYOUTS = [
    { id: 'mosaic',   label: 'Mosaic',   hint: 'Pictures lead, words follow' },
    { id: 'magazine', label: 'Magazine', hint: 'One headliner, then the rest' },
    { id: 'list',     label: 'List',     hint: 'Words first, tightly packed' },
    { id: 'gallery',  label: 'Gallery',  hint: 'All eyes, no essays' },
  ];

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (_) { return ''; }
  }

  // Search titles arrive with the site name bolted on — "Real Title | Site
  // Name", "Real Title - Site". The domain is already shown on its own line,
  // so that tail is pure noise: it pushes the useful words past the clamp and
  // makes half the grid end in an ellipsis.
  function cleanTitle(raw, domain) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    const brand = (domain || '').split('.')[0].toLowerCase();
    // Separators must be space-padded: "state-of-the-art" is one word, but
    // "Title - Site" is a boilerplate tail.
    const parts = t.split(/\s+[|–—·-]\s+/);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '');
      // Only drop the tail when it really is the site's own name, and only
      // when something substantial remains.
      if (brand && last && (last.includes(brand) || brand.includes(last))) {
        const head = parts.slice(0, -1).join(' – ').trim();
        if (head.length >= 12) t = head;
      }
    }
    // An unclosed parenthetical left by upstream truncation reads as damage.
    t = t.replace(/\s*\([^)]*$/, '').trim();
    return t.replace(/[\s\-–—|·]+$/, '');
  }

  // DDG prefixes many snippets with a publication date ("Jun 12, 2024 · …").
  // Split it out so it can sit in the metadata line and the snippet keeps its
  // full width for actual content.
  const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)' +
                '(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?';
  const DATE_RE = new RegExp(
    '^(' +
      MONTH + '\\.?\\s+\\d{1,2},?\\s+\\d{4}' +          // April 28, 2025
      '|\\d{1,2}\\s+' + MONTH + '\\.?\\s+\\d{4}' +      // 28 April 2025
      '|\\d{4}-\\d{2}-\\d{2}' +                          // 2025-04-28
      '|\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago' +
      '|(?:yesterday|today)' +
    ')\\s*[·\\-–—]\\s*', 'i');

  function splitDate(raw) {
    const s = String(raw || '').trim();
    const m = s.match(DATE_RE);
    if (m) return { date: m[1], text: s.slice(m[0].length).trim() };
    return { date: '', text: s };
  }

  function faviconOf(url, given) {
    if (given) return given;
    const d = domainOf(url);
    return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : '';
  }

  // ─── Normalise every component shape into one item model ──────────────
  //  { title, snippet, url, domain, favicon, thumbnail, kind, meta }
  function normalize(component, data) {
    const d = data || {};
    const out = [];

    if (component === 'image_gallery') {
      (d.items || []).forEach((it) => {
        const thumb = it.thumbnail || it.image;
        if (!thumb) return;
        const url = it.url || it.image || '';
        out.push({
          title: it.title || it.source || domainOf(url),
          snippet: '', url, domain: it.source || domainOf(url),
          favicon: faviconOf(url, it.favicon), thumbnail: thumb,
          full: it.image || thumb, kind: 'image', meta: '',
        });
      });
      return out;
    }

    if (component === 'video') {
      (d.videos || []).forEach((v) => {
        if (!v.videoId) return;
        const url = `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
        out.push({
          title: v.title || 'Video',
          snippet: '', url, domain: 'youtube.com',
          favicon: faviconOf(url),
          thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          full: '', kind: 'video',
          meta: [v.channel, v.views].filter(Boolean).join(' · '),
          duration: v.duration || '',
        });
      });
      return out;
    }

    if (component === 'research') {
      // A dossier fans out into one result set: sources carry the analysis,
      // images and videos carry the media. Sources lead — they are the
      // substance — with media interleaved behind them.
      (d.sources || []).forEach((s) => {
        const url = s.url || '';
        if (!url) return;
        const dom = s.domain || domainOf(url);
        const sn = splitDate(s.snippet || '');
        out.push({
          title: cleanTitle(s.title || dom, dom), snippet: sn.text,
          url, domain: dom,
          favicon: faviconOf(url, s.favicon), thumbnail: s.thumbnail || '',
          full: '', kind: '', meta: '', date: sn.date,
        });
      });
      out.push(...normalize('video', { videos: d.videos || [] }));
      out.push(...normalize('image_gallery', { items: d.images || [] }));
      return out;
    }

    // 'list' / 'sources' — web results from genui.search_results_component
    (d.items || []).forEach((it) => {
      const url = it.url || it.href || '';
      if (!url) return;
      const dom = it.domain || domainOf(url);
      const sn = splitDate(it.subtitle || it.body || it.snippet || '');
      out.push({
        title: cleanTitle(it.title || dom || 'Result', dom),
        snippet: sn.text,
        url, domain: dom,
        favicon: faviconOf(url, it.favicon),
        thumbnail: it.thumbnail || '', full: '',
        kind: it.kind || '', meta: '', date: sn.date,
      });
    });
    return out;
  }

  function dedupe(items) {
    const seen = new Set();
    return items.filter((it) => {
      const k = (it.url || it.thumbnail || '').split('#')[0];
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ─── Layout auto-selection ────────────────────────────────────────────
  // Driven by how much usable media the set actually carries, so a
  // thumbnail-poor research set never renders as a grid of empty boxes.
  function pickLayout(items) {
    if (!items.length) return 'list';
    const withThumb = items.filter((i) => i.thumbnail).length;
    const density = withThumb / items.length;
    const pureMedia = items.every((i) => i.kind === 'image');

    // Mosaic is the house style: it gives one result real presence without
    // demoting the rest to a footnote, and it holds mixed media well. It wins
    // wherever there is enough imagery to build a grid from. Magazine and list
    // are for the thin-media cases mosaic would render as a field of blanks.
    if (pureMedia) return 'gallery';
    if (density >= 0.4) return 'mosaic';
    if (density >= 0.2) return 'magazine';
    return 'list';
  }

  // ─── Shared card pieces ───────────────────────────────────────────────
  const YT_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

  function videoId(url) {
    const m = YT_ID_RE.exec(url || '');
    return m ? m[1] : '';
  }

  // Image lightbox — click an image result to preview it, no page navigation.
  function openLightbox(imgUrl, sourceUrl, title) {
    const existing = document.getElementById('a2r-lightbox');
    if (existing) existing.remove();

    const lb = document.createElement('div');
    lb.id = 'a2r-lightbox';
    lb.innerHTML =
      `<div class="a2r-lb-backdrop"></div>
       <div class="a2r-lb-container">
         <button class="a2r-lb-close" title="Close" aria-label="Close">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
             <path d="M18 6L6 18M6 6l12 12"/></svg>
         </button>
         <img src="${attr(imgUrl)}" alt="${attr(title)}" class="a2r-lb-image" loading="lazy"/>
         <div class="a2r-lb-info">
           <p>${esc(title)}</p>
           <a href="${attr(sourceUrl)}" target="_blank" onclick="window.__a2uiOpenTab('${attr(sourceUrl)}');return false;" class="a2r-lb-link">View on source</a>
         </div>
       </div>`;
    document.body.appendChild(lb);

    const close = () => lb.remove();
    lb.querySelector('.a2r-lb-close').addEventListener('click', close);
    lb.querySelector('.a2r-lb-backdrop').addEventListener('click', close);
    lb.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // Small overflow control shown on every card: open this result in a real
  // browser tab without leaving the result set.
  function openInTabBtn() {
    return `<button class="a2r-open" title="Open in new tab" aria-label="Open in new tab">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <path d="M15 3h6v6M10 14L21 3"/>
      </svg>
    </button>`;
  }

  function mediaBox(it, ratio) {
    if (!it.thumbnail) {
      // Text-only result: a lettermark keeps the grid rhythm without
      // pretending there is an image. Skip generic subdomains so
      // "en.wikipedia.org" reads W, not E.
      const host = (it.domain || '').replace(
        /^(?:www|en|m|news|blog|docs|support|help|shop|store|go|open)\./i, '');
      const letter = esc((host || it.title || '?').charAt(0).toUpperCase());
      return `<div class="a2r-media a2r-media-empty" style="aspect-ratio:${ratio};">
                <span class="a2r-lettermark">${letter}</span>
                ${openInTabBtn()}
              </div>`;
    }
    const vid = it.kind === 'video' ? videoId(it.url) : '';
    const host = (it.domain || '').replace(
      /^(?:www|en|m|news|blog|docs|support|help|shop|store|go|open)\./i, '');
    const letter = esc((host || it.title || '?').charAt(0).toUpperCase());
    // The lettermark ships with every card, sitting behind the image. When a
    // thumbnail 404s the image removes itself and the mark is already there —
    // without it, a broken thumbnail left a blank grey rectangle.
    return `<div class="a2r-media" style="aspect-ratio:${ratio};"${vid ? ` data-vid="${attr(vid)}"` : ''}>
      <span class="a2r-lettermark">${letter}</span>
      <img src="${attr(it.thumbnail)}" alt="${attr(it.title)}" loading="lazy"
           referrerpolicy="no-referrer"
           onerror="this.closest('.a2r-media').classList.add('a2r-media-empty');this.remove();"/>
      ${vid ? `<button class="a2r-play" title="Play here" aria-label="Play video">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>` : ''}
      ${it.duration ? `<span class="a2r-dur">${esc(it.duration)}</span>` : ''}
      ${openInTabBtn()}
    </div>`;
  }

  function sourceLine(it) {
    return `<div class="a2r-src">
      ${it.favicon ? `<img class="a2r-fav" src="${attr(it.favicon)}" alt="" loading="lazy"
             onerror="this.style.visibility='hidden'"/>` : ''}
      <span class="a2r-domain">${esc(it.domain)}</span>
      ${it.meta ? `<span class="a2r-meta">${esc(it.meta)}</span>` : ''}
      ${it.date ? `<span class="a2r-date">${esc(it.date)}</span>` : ''}
    </div>`;
  }

  function card(it, variant, ratio) {
    return `<article class="a2r-card a2r-${variant}" data-url="${attr(it.url)}"
             data-kind="${attr(it.kind || '')}" data-full="${attr(it.full || '')}"
             tabindex="0" role="link" aria-label="${attr(it.title)}">
      ${mediaBox(it, ratio)}
      <div class="a2r-body">
        ${sourceLine(it)}
        <h3 class="a2r-title">${esc(it.title)}</h3>
        ${it.snippet ? `<p class="a2r-snippet">${esc(it.snippet)}</p>` : ''}
      </div>
    </article>`;
  }

  // ─── Layouts ──────────────────────────────────────────────────────────
  const renderers = {
    mosaic(items) {
      // Media leads. The first thumbnailed result earns a double-width tile.
      const sorted = [...items].sort((a, b) => (!!b.thumbnail) - (!!a.thumbnail));
      return `<div class="a2r-grid a2r-mosaic">
        ${sorted.map((it, i) =>
          `<div class="a2r-cell${i === 0 && it.thumbnail ? ' a2r-cell-hero' : ''}">
             ${card(it, i === 0 && it.thumbnail ? 'hero' : 'tile', i === 0 && it.thumbnail ? '16/9' : '4/3')}
           </div>`).join('')}
      </div>`;
    },

    magazine(items) {
      const [lead, ...rest] = [...items].sort((a, b) => (!!b.thumbnail) - (!!a.thumbnail));
      if (!lead) return '';
      return `<div class="a2r-magazine">
        <div class="a2r-lead">${card(lead, 'lead', '16/9')}</div>
        <div class="a2r-rundown">
          ${rest.map((it) => card(it, 'row', '1/1')).join('')}
        </div>
      </div>`;
    },

    list(items) {
      return `<div class="a2r-list">
        ${items.map((it) => card(it, 'row', '16/10')).join('')}
      </div>`;
    },

    gallery(items) {
      return `<div class="a2r-grid a2r-gallery">
        ${items.map((it) => card(it, 'plate', '1/1')).join('')}
      </div>`;
    },
  };

  // ─── Public render ────────────────────────────────────────────────────
  function render(rawItems, opts) {
    const o = opts || {};
    const items = dedupe(rawItems || []).filter((i) => i.url || i.thumbnail);
    const host = document.createElement('section');
    host.className = 'a2r-section';
    if (!items.length) return host;

    const initial = o.layout || pickLayout(items);
    const counts = {
      media: items.filter((i) => i.thumbnail).length,
      video: items.filter((i) => i.kind === 'video').length,
    };

    host.innerHTML = `
      <header class="a2r-head">
        <div class="a2r-head-left">
          ${window.BucksBrand
            ? window.BucksBrand.html({ context: o.title || 'Results', size: 'sm' })
            : `<span class="a2r-label">${esc(o.title || 'Results')}</span>`}
          <span class="a2r-count">${items.length}${counts.video ? ` · ${counts.video} video` : ''}</span>
        </div>
        <div class="a2r-head-right">
          <div class="a2r-switch" role="tablist" aria-label="Result layout">
            ${LAYOUTS.map((l) => `
              <button class="a2r-switch-btn${l.id === initial ? ' is-active' : ''}"
                      data-layout="${l.id}" role="tab" title="${attr(l.hint)}"
                      aria-selected="${l.id === initial}">${esc(l.label)}</button>`).join('')}
          </div>
          <button class="a2r-collapse" title="Hide results" aria-expanded="true"
                  aria-label="Hide results">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </header>
      <div class="a2r-stage" data-layout="${initial}">${renderers[initial](items)}</div>`;

    const stage = host.querySelector('.a2r-stage');

    host.querySelectorAll('.a2r-switch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.layout;
        host.querySelectorAll('.a2r-switch-btn').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        stage.dataset.layout = id;
        stage.innerHTML = renderers[id](items);
        if (typeof o.onLayout === 'function') o.onLayout(id);
      });
    });

    const open = (url) => {
      if (!url) return;
      if (typeof window.__a2uiOpenTab === 'function') window.__a2uiOpenTab(url);
      else window.open(url, '_blank', 'noopener');
    };

    // Swap a video thumbnail for an embedded player in place, so watching
    // never costs the user their result set. Only one plays at a time.
    function playInline(media) {
      const vid = media.dataset.vid;
      if (!vid || media.querySelector('iframe')) return;
      host.querySelectorAll('.a2r-media.is-playing').forEach((m) => {
        if (m !== media) collapseInline(m);
      });
      media.dataset.poster = media.innerHTML;
      media.classList.add('is-playing');
      media.innerHTML =
        `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}?autoplay=1&rel=0"
                 title="Video player" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture"
                 allowfullscreen></iframe>
         <button class="a2r-close" title="Close player" aria-label="Close player">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
             <path d="M18 6L6 18M6 6l12 12"/></svg>
         </button>`;
    }

    function collapseInline(media) {
      if (!media.classList.contains('is-playing')) return;
      media.innerHTML = media.dataset.poster || '';
      media.classList.remove('is-playing');
    }

    host.addEventListener('click', (e) => {
      // Explicit "open in tab" beats every other affordance on the card.
      if (e.target.closest('.a2r-open')) {
        e.stopPropagation();
        const c = e.target.closest('.a2r-card');
        if (c) open(c.dataset.url);
        return;
      }
      if (e.target.closest('.a2r-close')) {
        e.stopPropagation();
        collapseInline(e.target.closest('.a2r-media'));
        return;
      }
      const media = e.target.closest('.a2r-media[data-vid]');
      if (media && !media.classList.contains('is-playing')) {
        e.stopPropagation();
        playInline(media);
        return;
      }
      if (media && media.classList.contains('is-playing')) return; // let the player have the click

      const c = e.target.closest('.a2r-card');
      if (!c) return;
      // An image result's destination is the picture itself — preview it here
      // rather than bouncing the user to whatever page happens to host it.
      if (c.dataset.kind === 'image' && c.dataset.full) {
        e.stopPropagation();
        openLightbox(c.dataset.full, c.dataset.url, c.querySelector('.a2r-title')?.textContent || '');
        return;
      }
      open(c.dataset.url);
    });

    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const playing = host.querySelector('.a2r-media.is-playing');
        if (playing) { collapseInline(playing); return; }
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const c = e.target.closest('.a2r-card');
      if (!c) return;
      e.preventDefault();
      const media = c.querySelector('.a2r-media[data-vid]');
      if (media) playInline(media);
      else open(c.dataset.url);
    });

    // Collapse the whole panel — useful once the answer is what matters.
    const toggle = host.querySelector('.a2r-collapse');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const hidden = host.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!hidden));
        toggle.title = hidden ? 'Show results' : 'Hide results';
        if (hidden) {
          const playing = host.querySelector('.a2r-media.is-playing');
          if (playing) collapseInline(playing);
        }
      });
    }

    return host;
  }

  window.A2UIResults = { normalize, pickLayout, render, dedupe, LAYOUTS };
})();

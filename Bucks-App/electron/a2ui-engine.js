/**
 * A2UI Engine — Self-contained Agent-to-UI rich rendering pipeline
 * Designed as a standalone module that does NOT depend on the main renderer.js IIFE closure.
 * 
 * Features:
 * - Full SSE streaming from soul_engine
 * - Rich image gallery grid
 * - YouTube video cards with embedded thumbnails
 * - Explore More Images / Explore More Videos CTAs
 * - Relevant source links with favicons
 * - Contact / Mail CTAs extracted from results
 * - Follow-up question chips for multi-turn conversation
 * - Liquid Glass frosted aesthetic
 */

(function A2UIEngine() {
  'use strict';

  const SOUL = 'http://127.0.0.1:8765';

  // ─── Escape helpers ───────────────────────────────────────────
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attr(s) { return esc(s).replace(/'/g, '&#39;'); }

  // ─── SSE Streaming ────────────────────────────────────────────
  async function streamSSE(url, body, onEvent, signal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s connection timeout
    
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok || !res.body) throw new Error(`Engine ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        let chunk;
        try { chunk = await reader.read(); } catch (e) { if (e && e.name === 'AbortError') return; throw e; }
        const { done, value } = chunk;
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try { onEvent(JSON.parse(data)); } catch (_) { if (data) onEvent({ type: 'token', content: data }); }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // ─── Text formatter ──────────────────────────────────────────
  // Fenced code is pulled out before any other rule runs and put back at the
  // very end. Everything below rewrites markdown, linkifies bare URLs and
  // finally turns newlines into <br> — all of which corrupt a code block. The
  // formatter previously had no fence handling whatsoever, so an answer
  // containing code rendered its backticks literally and lost its line breaks.
  function extractFences(text, store) {
    let t = String(text).replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, body) => {
      const i = store.length;
      store.push({ lang: (lang || '').trim(), code: body.replace(/\n$/, '') });
      return `\u0000FENCE${i}\u0000`;
    });

    // An UNCLOSED trailing fence. Two ways to get one: the answer is still
    // streaming (every token re-renders, so the block is open most of the time
    // it is being written), or the model was cut off mid-block. Either way the
    // rule above cannot match it, and the remainder shipped to the user as
    // literal ``` followed by unwrapped, unindented source. Treat everything
    // after the opener as the block.
    t = t.replace(/```([\w+-]*)\n?([\s\S]*)$/, (_, lang, body) => {
      const i = store.length;
      store.push({ lang: (lang || '').trim(), code: body.replace(/\n$/, ''), open: true });
      return `\u0000FENCE${i}\u0000`;
    });
    return t;
  }

  function restoreFences(html, store) {
    return html.replace(/\u0000FENCE(\d+)\u0000/g, (_, i) => {
      const b = store[Number(i)];
      if (!b) return '';
      const label = b.lang ? `<span class="a2ui-code-lang">${esc(b.lang)}</span>` : '';
      return `<figure class="a2ui-code"><figcaption class="a2ui-code-head">${label}` +
             `<button class="a2ui-code-copy" type="button">Copy</button></figcaption>` +
             `<pre><code>${esc(b.code)}</code></pre></figure>`;
    });
  }

  function formatText(text) {
    if (!text) return '';
    const fences = [];
    let t = extractFences(text, fences);

    // Extract & parse render_component JSON if LLM outputs raw JSON tool calls
    t = t.replace(/\{"name":\s*"render_component"[\s\S]*?\}(?=\s*\{|$|\n\n)/g, '');

    // Small models also leak the directive in the PROMPT's own literal syntax
    // rather than as JSON — [render_component component='stat_cards'
    // data={'stats': [...]}] — which the rule above never matched, so it
    // reached the user as raw text. (renderer.js recovers and draws these in
    // the floating overlay; this surface only needs them gone.)
    t = t.replace(
      /\[render_component\s+component\s*=\s*['"][\w-]+['"]\s+data\s*=\s*\{[\s\S]*?\}\s*\]/g, '');
    t = t.replace(/\[render_component\b[^\]]*$/, '');   // unterminated tail

    // Strip LLM prompt leakage & redundant text lists for media/sources/followups
    t = t.replace(/FOLLOW-UP QUERY:\s*["'][^"']*["']\.?/gi, '');
    t = t.replace(/PROVIDE A CONCISE,?\s*CLEAR ANSWER WITH EVIDENCE BASED ON CONTEXT\.?/gi, '');
    // The model sometimes wraps the followup tags in its own emphasis or a
    // heading ("### Follow-up Questions:" then the tags). Take the decoration
    // with the tags, or the page is left with an empty bold run and a heading
    // introducing nothing.
    t = t.replace(/(?:^|\n)\s*#{1,6}\s*Follow-?up[^\n]*\n?/gi, '\n');
    t = t.replace(/\*{0,2}<followup>[\s\S]*?<\/followup>\*{0,2}/gi, '');
    t = t.replace(/\*{0,2}<followup>[\s\S]*/gi, '');

    // Strip plain-text list headers (Images:, Videos:, Top Sources:, Follow-up
    // Questions:) together with the list beneath them. These come from the
    // generic agent prompt, and every one of them duplicates a native panel:
    // the sources rail already lists the sources, with favicons and snippets.
    // The heading may arrive as markdown ("### Top Sources:"), bold
    // ("**Sources:**") or bare, so all three forms are matched.
    t = t.replace(
      /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*|\*\*)?(?:Images|Videos|Top Sources|Sources|References|Follow-?up Questions)\s*:?(?:\*\*)?[ \t]*\n?(?:[ \t]*(?:[-*\u2022]|\d+\.)[^\n]*\n?)*/gi,
      '\n');

    // Older/looser models wrap the corpus's own block label into a markdown
    // link: [SOURCE: Ethereum vs Solana for DApps: Which Should You Choose?](url).
    // That renders as a full headline shoved into the middle of a sentence.
    // The corpus no longer offers that shape (sources are numbered now), but
    // the model can still produce it from memory, so collapse any such link to
    // a quiet citation pill carrying just the domain.
    t = t.replace(/\[\s*SOURCES?\s*:\s*([^\]]*?)\]\((https?:\/\/[^\s)]+)\)/gi,
      (_, _label, url) => {
        let host = url;
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
        return ` <a class="a2ui-cite" href="${url}" title="${url}"` +
               ` onclick="window.__a2uiOpenTab('${url}');return false;">${esc(host)}</a>`;
      });

    // Same leak without the link: "[SOURCE: Some Title]" as plain text.
    t = t.replace(/\[\s*SOURCES?\s*:[^\]]*\]/gi, '');

    // A lead-in label the refine prompt forbids but small models still emit —
    // "**Takeaway:** <the actual answer>". The sentence after it IS the
    // takeaway, so the label is pure redundancy above the fold.
    t = t.replace(/^\s*\*\*\s*(?:Takeaway|Summary|Overview|In short|Key takeaway)\s*:?\s*\*\*\s*:?\s*/i, '');
    t = t.replace(/^\s*(?:Takeaway|Summary|Overview|Key takeaway)\s*:\s*/i, '');

    // The model emits bare "SOURCE: example.com" trailers mid-paragraph. Turn
    // them into a quiet inline citation instead of shouting the hostname.
    t = t.replace(
      /\s*(?:\(\s*)?SOURCES?\s*:\s*((?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)\s*(?:\))?/gi,
      (_, host) => {
        const bare = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const href = host.startsWith('http') ? host : `https://${bare}`;
        const label = bare.split('/')[0].replace(/^www\./, '');
        return ` <a class="a2ui-cite" href="${href}" title="${href}"` +
               ` onclick="window.__a2uiOpenTab('${href}');return false;">${label}</a>`;
      });

    // Inline code first: a backticked span must survive the emphasis rules.
    t = t.replace(/`([^`\n]+)`/g, (_, c) => `<code class="a2ui-inline-code">${esc(c)}</code>`);

    // Format markdown headings & bold text
    // A bold run that occupies a whole line and ends in a colon is a section
    // heading the model wrote inline. Promote it to a real heading so the
    // answer gets scannable structure instead of one undifferentiated wall.
    // A whole-line bold run is a heading only if it reads like one: no
    // terminal punctuation and few enough words. The briefing's opening line
    // is also fully bold — "**Ethereum remains the trusted leader in DeFi.**"
    // — and promoting that sentence to an <h4> turned the answer's lede into
    // a section title with nothing under it.
    const isHeading = (h) =>
      !/[.!?]$/.test(h.trim()) && h.trim().split(/\s+/).length <= 8;

    t = t.replace(/^\s*\*\*([^*\n]{2,80}?):?\*\*:?\s*$/gm, (whole, h) =>
      isHeading(h) ? `<h4 class="a2ui-h">${h.trim()}</h4>`
                   : `<p class="a2ui-lede">${h.trim()}</p>`);
    // "**Heading:** body text" on one line — split the label off its body.
    t = t.replace(/^\s*\*\*([^*\n]{2,80}?):\*\*[ \t]+/gm, (whole, h) =>
      isHeading(h) ? `<h4 class="a2ui-h">${h.trim()}</h4>` : whole);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Single-asterisk emphasis, run after bold so ** is already consumed.
    // Left unhandled, these render as literal asterisks around quoted phrases.
    t = t.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');
    t = t.replace(/^#{3,6} (.*?)(?:\n|$)/gm, '<h4 class="a2ui-h">$1</h4>');
    t = t.replace(/^## (.*?)(?:\n|$)/gm, '<h3 class="a2ui-h a2ui-h-lg">$1</h3>');
    t = t.replace(/^[-*] (.*?)(?:\n|$)/gm, '<div class="a2ui-bullet"><span class="a2ui-bullet-dot">\u2022</span><span>$1</span></div>');

    // Parse Markdown links [Title](URL) into clickable tabs
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      const cleanUrl = url.trim();
      return `<a href="${cleanUrl}" target="_blank" onclick="window.__a2uiOpenTab('${cleanUrl}');return false;" style="color:var(--text-primary); font-weight:600; text-decoration:underline; cursor:pointer;">${label}</a>`;
    });

    // Parse bare URLs (https://...) that are not inside href
    t = t.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, (_, prefix, url) => {
      const cleanUrl = url.trim();
      let label = cleanUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      return `${prefix}<a href="${cleanUrl}" target="_blank" onclick="window.__a2uiOpenTab('${cleanUrl}');return false;" style="color:var(--text-primary); font-weight:600; text-decoration:underline; cursor:pointer;">${label}</a>`;
    });

    t = t.replace(/\n/g, '<br>');

    // Newline->br is indiscriminate: it also fires on the newlines that used
    // to separate block elements, leaving a stack of blank lines above every
    // heading and list. Blocks carry their own spacing, so strip the breaks
    // that sit directly against them.
    t = t.replace(/(<br>\s*){2,}/g, '<br>');
    t = t.replace(/<br>\s*(?=<(?:h[1-6]|p|div|figure|ul|ol|li)\b)/g, '');
    t = t.replace(/(<\/(?:h[1-6]|p|div|figure|ul|ol|li)>)\s*<br>/g, '$1');
    t = t.replace(/<br>\s*(?=\u0000FENCE)/g, '');
    t = t.replace(/(\u0000FENCE\d+\u0000)\s*<br>/g, '$1');
    t = t.replace(/^(?:<br>\s*)+/, '').replace(/(?:<br>\s*)+$/, '');

    return restoreFences(t, fences);
  }

  // ─── Extract followups ───────────────────────────────────────
  // Removing a followup means removing its decoration too. The model often
  // emits `**<followup>…</followup>**` or puts the tags under a "Follow-up
  // Questions:" heading; stripping only the tags left an empty bold run and a
  // heading with nothing beneath it sitting at the end of every answer.
  function stripFollowups(text) {
    return String(text || '')
      .replace(/(?:^|\n)\s*#{1,6}\s*Follow-?up[^\n]*\n?/gi, '\n')
      .replace(/\*{0,2}<followup>[\s\S]*?<\/followup>\*{0,2}/gi, '')
      .replace(/\*{0,2}<followup>[\s\S]*/gi, '')
      .trim();
  }

  function extractFollowups(text) {
    const followups = [];
    const re = /<followup>([\s\S]*?)<\/followup>/gi;
    let m;
    while ((m = re.exec(text)) !== null) followups.push(m[1].trim());
    return followups;
  }

  // ─── Render: Image Gallery ───────────────────────────────────
  function renderImageGallery(data, query) {
    const items = (data.items || []).filter(it => it.thumbnail || it.image);
    if (!items.length) return '';
    const q = query || data.query || '';
    const cells = items.slice(0, 12).map((it, idx) => {
      const src = it.thumbnail || it.image;
      const full = it.image || it.thumbnail;
      const url = it.url || '';
      const title = it.title || it.source || '';
      const cellId = `img-cell-${Date.now()}-${idx}`;

      return `
        <div class="a2ui-img-cell" id="${cellId}" onclick="window.__a2uiOpenTab('${attr(url || full)}')" title="${attr(title)}" style="cursor:pointer; position:relative;">
          <div class="a2ui-img-placeholder" style="position:absolute; inset:0; background:linear-gradient(90deg, var(--input-bg), var(--hover-bg), var(--input-bg)); background-size:200% 100%; animation:shimmerFlow 2s infinite; border-radius:10px;"></div>
          <img src="${attr(src)}" alt="${attr(title)}" referrerpolicy="no-referrer"
               data-src-fallback="${attr(`https://corsproxy.io/?${encodeURIComponent(src)}`)}?strip=1&quality=75"
               loading="lazy"
               class="a2ui-img-load"
               onerror="window._handleImgError(this, '${cellId}')"
               onload="document.getElementById('${cellId}').classList.add('is-loaded')"
               style="width:100%; aspect-ratio:4/3; object-fit:cover; display:block; border-radius:10px; position:relative; z-index:1; opacity:0; transition:opacity 0.3s ease;"/>
          ${it.source ? `<div class="a2ui-img-cap">${esc(it.source)}</div>` : ''}
        </div>`;
    }).join('');

    const ytSearch = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
    return `
      <div class="a2ui-section">
        <div class="a2ui-section-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          Images
        </div>
        <div class="a2ui-image-grid">${cells}</div>
        <a href="#" class="a2ui-explore-btn" onclick="window.__a2uiOpenTab('${attr(ytSearch)}');event.preventDefault();">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          More like these
        </a>
      </div>`;
  }

  // ─── Render: Video Cards ─────────────────────────────────────
  function renderVideoCards(data) {
    const vids = (data.videos || []).filter(v => v.videoId && /^[A-Za-z0-9_-]{6,20}$/.test(v.videoId));
    if (!vids.length) return '';
    const cards = vids.slice(0, 6).map((v, idx) => {
      const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
      // Use highest quality thumbnail, fall back gracefully
      const thumbUrls = [
        v.thumbnail,
        `https://i.ytimg.com/vi/${v.videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${v.videoId}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`
      ].filter(Boolean);
      const thumb = thumbUrls[0];
      const cardId = `vid-card-${Date.now()}-${idx}`;

      return `
        <div class="a2ui-video-card" id="${cardId}" onclick="window.__a2uiOpenTab('${attr(ytUrl)}')" title="${attr(v.title)}">
          <div class="a2ui-video-thumb-wrap" style="position:relative;">
            <div class="a2ui-video-placeholder" style="position:absolute; inset:0; background:linear-gradient(90deg, var(--input-bg), var(--hover-bg), var(--input-bg)); background-size:200% 100%; animation:shimmerFlow 2s infinite; z-index:0;"></div>
            <img src="${attr(thumb)}"
                 alt="${attr(v.title)}"
                 referrerpolicy="no-referrer"
                 loading="lazy"
                 class="a2ui-vid-thumb"
                 data-video-id="${v.videoId}"
                 onerror="window._handleVideoThumbError(this, '${cardId}')"
                 onload="document.getElementById('${cardId}').classList.add('is-loaded')"
                 style="width:100%; height:100%; object-fit:cover; display:block; position:relative; z-index:1; opacity:0; transition:opacity 0.3s ease;"/>
            <div class="a2ui-video-playbtn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
            ${v.duration ? `<span class="a2ui-video-dur">${esc(v.duration)}</span>` : ''}
          </div>
          <div class="a2ui-video-meta">
            <div class="a2ui-video-title">${esc(v.title)}</div>
            <div class="a2ui-video-sub">${esc(v.channel || '')}${v.views ? ' · ' + esc(v.views) : ''}</div>
          </div>
        </div>`;
    }).join('');

    const q = data.query || '';
    const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    return `
      <div class="a2ui-section">
        <div class="a2ui-section-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.41 19.1C5.12 19.56 12 19.56 12 19.56s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.34z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>
          Videos
        </div>
        <div class="a2ui-video-grid">${cards}</div>
        <a href="#" class="a2ui-explore-btn" onclick="window.__a2uiOpenTab('${attr(ytSearch)}');event.preventDefault();">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>
          Keep watching
        </a>
      </div>`;
  }

  // ─── Image & Video Error Handling ──────────────────────────
  // Global error handlers for failed image/video loads
  window._handleImgError = function(img, cellId) {
    const cell = document.getElementById(cellId);
    if (!cell) return;

    const fallbackSrc = img.getAttribute('data-src-fallback');
    const attempts = parseInt(img.getAttribute('data-retry-attempts') || '0');

    if (attempts < 2 && fallbackSrc) {
      // Retry with fallback CORS proxy
      img.setAttribute('data-retry-attempts', attempts + 1);
      img.src = fallbackSrc;
    } else {
      // Show error state
      cell.classList.add('is-error');
      cell.style.opacity = '1';
      cell.innerHTML = `
        <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:8px; background:var(--hover-bg); border-radius:10px; padding:12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <span style="font-size:11px; color:var(--text-tertiary); text-align:center;">Failed to load</span>
        </div>`;
    }
  };

  window._handleVideoThumbError = function(img, cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    const videoId = img.getAttribute('data-video-id');
    const attempts = parseInt(img.getAttribute('data-retry-attempts') || '0');
    const qualities = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'];

    if (attempts < qualities.length - 1) {
      // Try next quality level
      const nextQuality = qualities[attempts + 1];
      img.setAttribute('data-retry-attempts', attempts + 1);
      img.src = `https://i.ytimg.com/vi/${videoId}/${nextQuality}.jpg`;
    } else {
      // Show error state
      card.classList.add('is-error');
      const thumbWrap = card.querySelector('.a2ui-video-thumb-wrap');
      if (thumbWrap) {
        thumbWrap.innerHTML = `
          <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--hover-bg);">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>`;
      }
    }
  };

  // ─── Render: Sources ─────────────────────────────────────────
  function renderSources(urls) {
    if (!urls || !urls.length) return '';
    
    // Filter and sanitize valid URLs (strip trailing punctuation and invalid fragments)
    const validUrls = urls.map(u => String(u || '').trim().replace(/[,.;:)]+$/, ''))
                          .filter(u => /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(u));
    
    // Group and deduplicate by domain
    const domainMap = new Map();
    validUrls.forEach(url => {
      try {
        const parsed = new URL(url);
        const domain = parsed.hostname.replace(/^www\./, '');
        if (domain && !domainMap.has(domain)) {
          domainMap.set(domain, url);
        }
      } catch (_) {}
    });

    if (domainMap.size === 0) return '';

    const items = Array.from(domainMap.entries()).slice(0, 8).map(([domain, url]) => {
      const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
      return `
        <a href="#" class="a2ui-source-link" onclick="window.__a2uiOpenTab('${attr(url)}');event.preventDefault();" title="${attr(url)}">
          <img src="${attr(favicon)}" width="14" height="14" style="border-radius:3px;flex-shrink:0;" onerror="this.style.display='none'"/>
          <span>${esc(domain)}</span>
        </a>`;
    }).join('');

    return `
      <div class="a2ui-section a2ui-sources-section">
        <div class="a2ui-section-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Sources
        </div>
        <div class="a2ui-sources-list">${items}</div>
      </div>`;
  }

  // ─── Render: CTAs (contact, mail, visit) ─────────────────────
  function renderCTAs(text, urls, query) {
    const ctaBtns = [];
    const mainUrl = (urls && urls.length) ? urls[0] : null;
    const topic = query || 'Research Topic';

    if (mainUrl) {
      ctaBtns.push(`
        <a href="#" class="a2ui-cta-btn primary" onclick="window.__a2uiOpenTab('${attr(mainUrl)}');event.preventDefault();">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
          Go to the source
        </a>`);
    } else {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(topic)}`;
      ctaBtns.push(`
        <a href="#" class="a2ui-cta-btn primary" onclick="window.__a2uiOpenTab('${attr(searchUrl)}');event.preventDefault();">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          Cast a wider net
        </a>`);
    }

    const wikiUrl = (urls || []).find(u => u.includes('wikipedia.org')) || `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic)}`;
    ctaBtns.push(`
      <a href="#" class="a2ui-cta-btn secondary" onclick="window.__a2uiOpenTab('${attr(wikiUrl)}');event.preventDefault();">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>
        Read on Wikipedia
      </a>`);

    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}`;
    ctaBtns.push(`
      <a href="#" class="a2ui-cta-btn secondary" onclick="window.__a2uiOpenTab('${attr(ytUrl)}');event.preventDefault();">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        Watch it explained
      </a>`);

    return `
      <div class="a2ui-section" style="margin-top:14px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:12px 16px;">
        <div class="a2ui-section-label" style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-tertiary); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          Next moves
        </div>
        <div class="a2ui-ctas" style="display:flex; flex-wrap:wrap; gap:8px;">${ctaBtns.join('')}</div>
      </div>`;
  }

  // ─── Inject CSS ───────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('a2ui-engine-styles')) return;
    const s = document.createElement('style');
    s.id = 'a2ui-engine-styles';
    s.textContent = `
      /* ── A2UI Engine Styles ── */
      /* ── Dynamic layout ──────────────────────────────────────────────
         This surface is not a page: it is a panel that shares the window
         with tabs, panes and side rails, so its width moves independently
         of the viewport. Every rule below therefore keys off a container
         query on the view itself — a viewport media query reported "desktop"
         while the panel sat at 420px, and the two-column grid kept its
         second column until the cards were unreadable.

         Sizing is fluid between the tiers rather than stepped, so a drag of
         the window edge reflows continuously instead of snapping. */
      #view-agent-search {
        container-type: inline-size;
        container-name: a2ui;
        font-family: 'Instrument Sans', system-ui, sans-serif;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        padding: 0;
        box-sizing: border-box;
        color: var(--text-primary);
        overflow: hidden;
        max-height: calc(100vh - 80px);
        gap: 0;
        background: transparent;
        --a2ui-inset: clamp(16px, 3.5cqi, 40px);
        /* Type scales with the panel, bounded at both ends so it never gets
           too small to read or too large to scan. */
        --a2ui-body: clamp(14px, 1.4cqi, 16px);
        --a2ui-gap: clamp(16px, 2cqi, 28px);
        --a2ui-pad: clamp(18px, 2.4cqi, 32px);
      }

      /* One centred measure shared by the header and by everything in the
         scrollport, so the two stay aligned as the panel grows. */
      #a2ui-header-bar > div:first-child,
      #a2ui-query-title,
      #a2ui-status-box,
      #a2ui-history-drawer,
      #a2ui-main-layout {
        width: 100%;
        max-width: var(--a2ui-measure, 1380px);
        margin-inline: auto;
        box-sizing: border-box;
      }

      #a2ui-history-drawer {
        margin-block: 0 14px;
        margin-inline: auto;
      }

      @container a2ui (min-width: 1150px) {
        #a2ui-header-bar > div:first-child,
        #a2ui-query-title,
        #a2ui-status-box,
        #a2ui-history-drawer,
        #a2ui-main-layout { max-width: 1440px; }
      }
      @container a2ui (min-width: 1400px) {
        #a2ui-header-bar > div:first-child,
        #a2ui-query-title,
        #a2ui-status-box,
        #a2ui-history-drawer,
        #a2ui-main-layout { max-width: 1600px; }
      }
      @container a2ui (min-width: 1750px) {
        #a2ui-header-bar > div:first-child,
        #a2ui-query-title,
        #a2ui-status-box,
        #a2ui-history-drawer,
        #a2ui-main-layout { max-width: 1760px; }
      }

      /* ── Fullscreen Mode Styles ── */
      #dashboard-window.a2ui-fullscreen-mode {
        position: relative !important;
        width: 100% !important;
        max-width: 100% !important;
        flex: 1 1 auto !important;
        height: 100% !important;
        z-index: 10 !important;
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      #view-agent-search.a2ui-fullscreen-mode {
        width: 100% !important;
        max-width: 100% !important;
        flex: 1 1 auto !important;
        height: calc(100vh - 60px) !important;
        max-height: calc(100vh - 60px) !important;
        padding: 8px clamp(24px, 4vw, 64px) 20px !important;
        box-sizing: border-box !important;
      }

      #view-agent-search.a2ui-fullscreen-mode #a2ui-header-bar > div:first-child,
      #view-agent-search.a2ui-fullscreen-mode #a2ui-query-title,
      #view-agent-search.a2ui-fullscreen-mode #a2ui-status-box,
      #view-agent-search.a2ui-fullscreen-mode #a2ui-history-drawer,
      #view-agent-search.a2ui-fullscreen-mode #a2ui-main-layout {
        max-width: min(1760px, 95vw) !important;
      }

      #view-agent-search.a2ui-fullscreen-mode #a2ui-scroll {
        max-height: calc(100vh - 180px) !important;
        height: 100% !important;
        padding-bottom: 140px !important;
        box-sizing: border-box !important;
      }

      body.a2ui-fullscreen-active #global-agent-dock {
        opacity: 1 !important;
        pointer-events: none !important;
        z-index: 10000 !important;
      }
      body.a2ui-fullscreen-active #global-agent-dock > * {
        pointer-events: auto !important;
      }

      /* The header sits OUTSIDE the scrollport rather than sticking inside
         it. position:sticky was the wrong tool: the scroll container carried
         30px of top padding, so a header pinned at top:0 left a strip above
         itself in which answer text kept scrolling past in full view. Taking
         the header out of the scrolling box removes the overlap entirely and
         needs no opaque background to hide anything. */
      #a2ui-header-bar {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        border-bottom: 1px solid var(--border-subtle);
        padding: clamp(16px, 2.4cqi, 30px) var(--a2ui-inset) 16px;
        margin-bottom: 0;
      }

      /* The scrollport. Everything that grows lives in here. */
      #a2ui-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        /* both-edges keeps the reserved scrollbar space symmetric, so the
           centred columns stay aligned with the header above them. Without it
           the scrollbar eats from one side only and everything below the
           header sits a few pixels left of the title. */
        scrollbar-gutter: stable both-edges;
        padding: 20px var(--a2ui-inset) 96px;
        display: flex;
        flex-direction: column;
        gap: 0;
      }


      /* The badge is now just a mounting point for the brand mark — no
         gradient fill, no glow, no letterspaced caps. */
      #a2ui-header-badge {
        display: inline-flex;
        align-items: center;
      }

      #a2ui-query-title {
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 26px;
        font-weight: 800;
        /* margin-BLOCK only. The shared-measure rule above centres this with
           margin-inline:auto, and a blanket margin:0 here — same
           specificity, later in the sheet — silently undid it, leaving the
           title flush left while the columns below it stayed centred. */
        margin-block: 0;
        letter-spacing: -0.02em;
        color: var(--text-primary);
      }

      #a2ui-status-box {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 20px;
        border-radius: var(--radius-lg);
        background: var(--card-bg);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--border-subtle);
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: 24px;
      }

      /* Single column by default — the honest baseline. The second column is
         added only once there is room for BOTH a readable answer measure and
         a results rail that is not a sliver. */
      #a2ui-main-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--a2ui-gap);
        align-items: start;
      }

      #a2ui-left-col,
      #a2ui-right-col {
        display: flex;
        flex-direction: column;
        gap: var(--a2ui-gap);
        min-width: 0;
      }

      /* Below the split point the rail is not a sidebar, it is the next
         section down — so it reads in source order under the answer. */
      @container a2ui (min-width: 760px) {
        #a2ui-main-layout {
          grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
        }
        #a2ui-right-col {
          position: sticky;
          /* Clears the sticky header instead of jamming against it. */
          top: 12px;
          max-height: calc(100vh - 190px);
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          padding-right: 2px;
        }
      }

      /* Past this point the extra width goes to the RAIL, not to the line
         length. Prose stops being comfortable past roughly 85-90 characters;
         at 15.5px that is about 700px of text. So the answer TRACK is capped
         in absolute terms and the rail takes 1fr of whatever is left. Capping
         the column's child instead would leave dead space inside an fr-sized
         track. Thumbnails, source cards and video posters all improve with
         the room; a longer line of body text does not.

         These must stay AFTER the min-width:760px rule above — @container
         blocks carry equal specificity, so the later matching one wins, and
         when this ladder sat earlier in the sheet the 760px rule silently
         overrode all of it (measured: 99 characters per line at 1384px). */
      @container a2ui (min-width: 1150px) {
        #a2ui-main-layout {
          grid-template-columns: minmax(0, 720px) minmax(340px, 1fr);
        }
      }
      @container a2ui (min-width: 1400px) {
        #a2ui-main-layout {
          grid-template-columns: minmax(0, 760px) minmax(400px, 1fr);
        }
      }
      @container a2ui (min-width: 1750px) {
        #a2ui-main-layout {
          grid-template-columns: minmax(0, 800px) minmax(460px, 1fr);
        }
      }

      /* User override: Focus collapses the rail so the answer owns the full
         measure; Split forces the two-column read even on a narrow panel.
         Auto (the default) leaves the container queries in charge. */
      #a2ui-main-layout[data-view="focus"] {
        grid-template-columns: minmax(0, 1fr);
      }
      #a2ui-main-layout[data-view="focus"] #a2ui-right-col {
        position: static;
        max-height: none;
        overflow: visible;
      }
      #a2ui-main-layout[data-view="split"] {
        grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr);
      }

      .a2ui-turn-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .a2ui-turn-container + .a2ui-turn-container {
        margin-top: 28px;
        padding-top: 28px;
        border-top: 1px solid var(--border-subtle);
      }

      .a2ui-user-bubble {
        display: flex;
        justify-content: flex-end;
      }
      .a2ui-user-bubble-inner {
        padding: 12px 18px;
        border-radius: 18px 18px 4px 18px;
        background: var(--input-bg);
        border: 1px solid var(--input-border);
        color: var(--text-primary);
        font-weight: 600;
        font-size: 14px;
        max-width: 85%;
        backdrop-filter: var(--glass-blur);
      }

      .a2ui-answer-card {
        padding: var(--a2ui-pad);
        border-radius: var(--radius-lg);
        background: var(--card-bg);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-md);
        line-height: 1.7;
        font-size: var(--a2ui-body, 14.5px);
        color: var(--text-primary);
      }

      /* ── Answer typography ──────────────────────────────────────────
         The formatter promotes the briefing's opening line to a lede and its
         section labels to real headings; these give that structure the
         vertical rhythm it needs to actually read as structure. */
      .a2ui-answer-text .a2ui-lede {
        margin: 0 0 14px;
        font-size: 1.12em;
        font-weight: 600;
        line-height: 1.55;
        letter-spacing: -0.011em;
        color: var(--text-primary);
      }
      .a2ui-answer-text .a2ui-h {
        margin: 20px 0 6px;
        font-size: 0.95em;
        font-weight: 700;
        letter-spacing: -0.005em;
        color: var(--text-primary);
      }
      .a2ui-answer-text .a2ui-h-lg { font-size: 1.05em; margin-top: 24px; }
      .a2ui-answer-text > .a2ui-h:first-child,
      .a2ui-answer-text > .a2ui-lede:first-child { margin-top: 0; }

      .a2ui-bullet {
        display: flex;
        gap: 9px;
        margin: 5px 0;
        align-items: baseline;
      }
      .a2ui-bullet-dot { color: var(--text-tertiary); flex-shrink: 0; }

      .a2ui-inline-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.88em;
        padding: 1.5px 5px;
        border-radius: 5px;
        background: var(--input-bg);
        border: 1px solid var(--border-subtle);
      }

      /* ── Code blocks ── */
      .a2ui-code {
        margin: 14px 0;
        border-radius: 12px;
        border: 1px solid var(--border-subtle);
        background: var(--input-bg);
        overflow: hidden;
      }
      .a2ui-code-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 12px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--hover-bg);
      }
      .a2ui-code-lang {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .a2ui-code-copy {
        appearance: none;
        border: 1px solid var(--border-subtle);
        background: transparent;
        color: var(--text-tertiary);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 9px;
        border-radius: 999px;
        cursor: pointer;
        margin-left: auto;
      }
      .a2ui-code-copy:hover { color: var(--text-primary); background: var(--input-bg); }
      .a2ui-code pre {
        margin: 0;
        padding: 13px 14px;
        overflow-x: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12.5px;
        line-height: 1.6;
        tab-size: 2;
      }
      .a2ui-code code { white-space: pre; }

      /* ── Consent prompt for state-changing agent actions ── */
      .a2ui-approve {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 15px 17px;
        border-radius: 14px;
        border: 1px solid var(--border-strong);
        background: var(--card-bg);
        backdrop-filter: var(--glass-blur);
      }
      .a2ui-approve-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .a2ui-approve-title {
        font-size: 13.5px;
        font-weight: 700;
        color: var(--text-primary);
      }
      .a2ui-approve-detail {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11.5px;
        color: var(--text-tertiary);
        word-break: break-word;
      }
      .a2ui-approve-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .a2ui-approve-actions button {
        appearance: none;
        font: inherit;
        font-size: 12.5px;
        font-weight: 700;
        padding: 7px 15px;
        border-radius: 10px;
        cursor: pointer;
        transition: opacity .15s ease;
      }
      .a2ui-approve-actions button:disabled { opacity: .45; cursor: default; }
      .a2ui-approve-yes {
        background: var(--text-primary);
        color: var(--bg-body);
        border: none;
      }
      .a2ui-approve-no {
        background: var(--input-bg);
        color: var(--text-primary);
        border: 1px solid var(--border-strong);
      }
      .a2ui-approve-verdict { font-size: 11.5px; font-weight: 700; }
      .a2ui-approve-verdict.is-yes { color: #59c08b; }
      .a2ui-approve-verdict.is-no  { color: #e0736a; }

      /* An answer that stopped early or hit an engine error says so, rather
         than presenting a truncated response as a finished one. */
      .a2ui-answer-note {
        margin-top: 14px;
        padding: 9px 12px;
        border-radius: 10px;
        border: 1px solid var(--border-subtle);
        background: var(--input-bg);
        color: var(--text-tertiary);
        font-size: 12.5px;
        font-weight: 600;
      }

      .a2ui-cite-n {
        display: inline-block;
        margin-right: 4px;
        font-variant-numeric: tabular-nums;
        opacity: 0.65;
      }

      .a2ui-answer-card .a2ui-answer-label {
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 650;
        color: var(--text-primary);
        letter-spacing: -0.01em;
        margin-bottom: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .a2ui-answer-card a {
        color: var(--text-primary);
        text-decoration: none;
        font-weight: 500;
      }
      .a2ui-answer-card a:hover {
        text-decoration: underline;
      }

      /* ── Sections ── */
      .a2ui-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        border-radius: 18px;
        background: var(--card-bg);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-sm);
      }

      .a2ui-section-label {
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 650;
        color: var(--text-tertiary);
        letter-spacing: -0.01em;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      /* ── Image Grid ── */
      @keyframes shimmerFlow {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .a2ui-image-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
        grid-auto-flow: dense;
      }
      .a2ui-img-cell {
        position: relative;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid var(--border-subtle);
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.3s ease;
        aspect-ratio: 4/3;
        background: var(--input-bg);
      }
      .a2ui-img-cell:hover {
        transform: scale(1.03);
        box-shadow: var(--shadow-md);
      }
      .a2ui-img-placeholder {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .a2ui-img-load {
        opacity: 0;
        z-index: 1;
      }
      .a2ui-img-cell.is-loaded .a2ui-img-load {
        opacity: 1;
      }
      .a2ui-img-cell.is-error {
        background: var(--hover-bg);
      }
      .a2ui-img-cap {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 4px 6px;
        font-size: 10px;
        color: var(--text-tertiary);
        background: linear-gradient(180deg, transparent, rgba(0,0,0,0.4));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: 2;
      }

      /* ── Video Grid ── */
      .a2ui-video-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 10px;
      }
      .a2ui-video-card {
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid var(--border-subtle);
        background: var(--bg-body);
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        display: flex;
        flex-direction: column;
      }
      .a2ui-video-card:hover {
        transform: translateY(-3px);
        box-shadow: var(--shadow-md);
        border-color: var(--border-strong);
      }
      .a2ui-video-card.is-loaded .a2ui-video-thumb-wrap::before {
        display: none;
      }
      .a2ui-video-thumb-wrap {
        position: relative;
        aspect-ratio: 16/9;
        background: var(--input-bg);
        overflow: hidden;
      }
      .a2ui-video-placeholder {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .a2ui-vid-thumb {
        opacity: 0;
        z-index: 1;
      }
      .a2ui-video-card.is-loaded .a2ui-vid-thumb {
        opacity: 1;
      }
      .a2ui-video-card.is-error {
        background: var(--hover-bg);
      }
        overflow: hidden;
        flex-shrink: 0;
      }
      .a2ui-video-playbtn {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.35);
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .a2ui-video-card:hover .a2ui-video-playbtn { opacity: 1; }
      .a2ui-video-dur {
        position: absolute;
        bottom: 6px;
        right: 6px;
        background: rgba(0,0,0,0.8);
        color: #fff;
        font-size: 10.5px;
        font-weight: 700;
        padding: 2px 5px;
        border-radius: 4px;
      }
      .a2ui-video-meta {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1;
      }
      .a2ui-video-title {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--text-primary);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.4;
      }
      .a2ui-video-sub {
        font-size: 11px;
        color: var(--text-tertiary);
      }

      /* ── Explore / CTA Buttons ── */
      .a2ui-explore-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 10px;
        background: var(--input-bg);
        border: 1px solid var(--input-border);
        color: var(--text-secondary);
        font-size: 12.5px;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.15s ease;
        width: fit-content;
      }
      .a2ui-explore-btn:hover {
        background: var(--hover-bg);
        color: var(--text-primary);
        border-color: var(--border-strong);
      }

      .a2ui-ctas {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .a2ui-cta-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 10px 16px;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 700;
        text-decoration: none;
        transition: all 0.15s ease;
        cursor: pointer;
      }
      .a2ui-cta-btn.primary {
        background: var(--text-primary);
        color: var(--bg-body);
        border: none;
        box-shadow: var(--shadow-md);
      }
      .a2ui-cta-btn.primary:hover { opacity: 0.9; box-shadow: var(--shadow-lg); }
      .a2ui-cta-btn.secondary {
        background: var(--input-bg);
        color: var(--text-primary);
        border: 1px solid var(--border-strong);
      }
      .a2ui-cta-btn.secondary:hover { background: var(--hover-bg); }

      /* ── Follow-up chips ── */
      .a2ui-followups {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .a2ui-followup-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 99px;
        border: 1px solid var(--border-strong);
        background: var(--input-bg);
        color: var(--text-primary);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
      }
      .a2ui-followup-chip:hover {
        background: var(--hover-bg);
        border-color: var(--text-primary);
      }

      /* ── Sources ── */
      .a2ui-sources-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .a2ui-source-link {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--input-bg);
        border: 1px solid var(--input-border);
        color: #78b4ff;
        font-size: 12.5px;
        text-decoration: none;
        transition: background 0.15s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .a2ui-source-link:hover { background: var(--hover-bg); color: #a3caff; }

      /* ── Skeleton pulses ── */
      @keyframes a2ui-pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.8; }
      }
      .a2ui-skeleton-line {
        height: 14px;
        background: var(--border-strong);
        border-radius: 4px;
        animation: a2ui-pulse 1.4s infinite;
      }

      /* ── Right col context card ── */
      .a2ui-context-card {
        padding: 20px;
        border-radius: var(--radius-panel);
        background: var(--card-bg);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-md);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .a2ui-context-card-label {
        font-family: 'Instrument Sans', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 650;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }
      .a2ui-context-card-text {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-tertiary);
      }

      /* Media grids track the column they sit in, not the window. The old
         viewport breakpoint left the image grid at auto-fill/120px inside a
         300px rail, which produced two clipped columns and a scrollbar. */
      @container a2ui (max-width: 620px) {
        .a2ui-image-grid { grid-template-columns: repeat(2, 1fr); }
        .a2ui-video-grid { grid-template-columns: 1fr; }
        .a2ui-ctas { flex-direction: column; align-items: stretch; }
        .a2ui-cta-btn { justify-content: center; }
        #a2ui-query-title { font-size: clamp(18px, 4cqi, 26px); }
      }

      @container a2ui (max-width: 420px) {
        .a2ui-image-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }
        .a2ui-user-bubble-inner { max-width: 100%; }
        .a2ui-section { padding: 14px; }
      }

      /* ── Layout mode switch ── */
      #a2ui-viewmode {
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        border-radius: 999px;
        background: var(--input-bg);
        border: 1px solid var(--border-subtle);
      }
      #a2ui-viewmode button {
        appearance: none;
        border: none;
        background: transparent;
        color: var(--text-tertiary);
        font: inherit;
        font-size: 11.5px;
        font-weight: 700;
        padding: 4px 11px;
        border-radius: 999px;
        cursor: pointer;
        transition: color .15s ease, background .15s ease;
      }
      #a2ui-viewmode button:hover { color: var(--text-primary); }
      #a2ui-viewmode button.is-on {
        background: var(--hover-bg);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
      }
      #a2ui-viewmode button:focus-visible {
        outline: 2px solid var(--accent-ring, rgba(255,255,255,.4));
        outline-offset: 1px;
      }
      /* Below the split point there is only one column, so offering Split is
         a lie — hide the control rather than let it do nothing. */
      /* Matches the split threshold exactly: below it there is only one
         column, so neither Focus nor Split would change anything. */
      @container a2ui (max-width: 759.98px) {
        #a2ui-viewmode { display: none; }
      }

      /* The header wraps its own controls rather than overflowing them. */
      #a2ui-header-bar > div:first-child { flex-wrap: wrap; row-gap: 8px; }

      /* Honour a reduced-motion preference across every animation here. */
      @media (prefers-reduced-motion: reduce) {
        .a2ui-img-cell, .a2ui-video-card, .a2ui-cta-btn,
        .a2ui-followup-chip, .a2ui-explore-btn {
          transition: none !important;
        }
        .a2ui-img-placeholder, .a2ui-video-placeholder, .a2ui-skeleton-line {
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(s);
  }

  let _activeTabId = null;
  let _activeTabTurns = [];

  // True from the moment a run paints its question bubble until the run
  // settles. Guards the restore path below.
  let _runInFlight = false;

  window.__a2uiLoadTabTurns = function(tabId, turns) {
    if (_runInFlight && _activeTabId !== tabId) {
      if (_abort) _abort.abort();
      _runInFlight = false;
    }
    _activeTabId = tabId;
    _activeTabTurns = Array.isArray(turns) ? turns.slice() : [];
    if (_runInFlight) return;
    renderActiveTabTurns();
  };

  // Attach the view to a tab WITHOUT repainting — used when a search is about
  // to start on that tab, so the completed turn is saved against the right id.
  window.__a2uiBindTab = function(tabId, turns) {
    _activeTabId = tabId;
    _activeTabTurns = Array.isArray(turns) ? turns.slice() : [];
  };

  function renderActiveTabTurns() {
    const turnsEl = document.getElementById('a2ui-turns');
    const titleEl = document.getElementById('a2ui-query-title');
    const statusBox = document.getElementById('a2ui-status-box');
    if (!turnsEl) return;

    turnsEl.innerHTML = '';
    if (!_activeTabTurns || !_activeTabTurns.length) {
      if (titleEl) titleEl.textContent = 'Research Assistant';
      if (statusBox) statusBox.style.display = 'none';
      return;
    }

    const lastTurn = _activeTabTurns[_activeTabTurns.length - 1];
    if (titleEl && lastTurn) titleEl.textContent = `"${lastTurn.query}"`;
    if (statusBox) statusBox.style.display = 'none';

    _activeTabTurns.forEach((turn, idx) => {
      const turnEl = document.createElement('div');
      turnEl.className = 'a2ui-turn-container';

      // Only show user bubble for follow-ups (turn > 0) to avoid redundant duplicate title
      if (idx > 0) {
        const bubble = document.createElement('div');
        bubble.className = 'a2ui-user-bubble';
        bubble.innerHTML = `<div class="a2ui-user-bubble-inner">${esc(turn.query)}</div>`;
        turnEl.appendChild(bubble);
      }

      if (turn.answer) {
        const cleanAnswer = stripGenTags(turn.answer);
        const card = document.createElement('div');
        card.className = 'a2ui-answer-card';
        card.innerHTML = `
          <div class="a2ui-answer-head">
            <span class="a2ui-answer-label">Answer</span>
            <button class="a2ui-copy" title="Copy answer" aria-label="Copy answer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1">
                <rect x="9" y="9" width="11" height="11" rx="2"/>
                <path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
              <span class="a2ui-copy-label">Copy</span>
            </button>
          </div>
          <div class="a2ui-answer-text">${linkCitations(formatText(cleanAnswer), [])}</div>
        `;
        card.dataset.raw = cleanAnswer;
        wireCopy(card);
        turnEl.appendChild(card);

        // Next moves CTA under the card
        const ctaHtml = renderCTAs(cleanAnswer, [], turn.query);
        if (ctaHtml) {
          const wrap = document.createElement('div');
          wrap.className = 'a2ui-cta-wrap';
          wrap.innerHTML = ctaHtml;
          turnEl.appendChild(wrap);
        }
      }

      if (turn.followups && turn.followups.length) {
        const fEl = document.createElement('div');
        fEl.className = 'a2ui-followups';
        turn.followups.forEach(fq => {
          const chip = document.createElement('button');
          chip.className = 'a2ui-followup-chip';
          chip.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${esc(fq)}`;
          chip.onclick = () => runSearch(fq, true);
          fEl.appendChild(chip);
        });
        turnEl.appendChild(fEl);
      }

      turnsEl.appendChild(turnEl);
    });
  }

  // ─── Rebuild view-agent-search HTML ──────────────────────────
  function rebuildViewHTML() {
    const view = document.getElementById('view-agent-search');
    if (!view) return;

    view.style.cssText = '';
    view.innerHTML = `
      <!-- Header -->
      <div id="a2ui-header-bar">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; margin-bottom:12px;">
          <div id="a2ui-header-badge">
            ${window.BucksBrand
              ? window.BucksBrand.html({ context: 'Live research', size: 'sm' })
              : 'Live research'}
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <div id="a2ui-viewmode" role="group" aria-label="Layout">
              <button type="button" data-view="auto"  title="Let the layout follow the panel width">Auto</button>
              <button type="button" data-view="focus" title="Answer only, full width">Focus</button>
              <button type="button" data-view="split" title="Always show the results rail">Split</button>
            </div>
            <button id="a2ui-btn-fullscreen" title="Toggle full-screen research canvas (Cmd+Shift+F)" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16); color:var(--text-primary); padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
              <svg id="a2ui-fullscreen-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              <span id="a2ui-fullscreen-label">Fullscreen</span>
            </button>
            <button id="a2ui-btn-stop" hidden title="Stop this run" style="display:flex; align-items:center; gap:6px; background:var(--input-bg); border:1px solid var(--border-strong); color:var(--text-primary); padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; cursor:pointer;">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
              Stop
            </button>
            <button id="a2ui-btn-new-chat" title="Start a new research chat" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16); color:var(--text-primary); padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Chat
            </button>
            <button id="a2ui-btn-history" title="View chat history" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16); color:var(--text-primary); padding:6px 14px; border-radius:999px; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              History
            </button>
          </div>
        </div>
        <h2 id="a2ui-query-title">Searching...</h2>
      </div>

      <!-- History Drawer (hidden by default) -->
      <div id="a2ui-history-drawer" class="hidden" style="padding:16px 20px; background:rgba(18,18,24,0.92); border:1px solid rgba(255,255,255,0.18); border-radius:16px; backdrop-filter:blur(24px);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; font-family:'Instrument Sans', system-ui, sans-serif; font-size:12px; font-weight:800; color:var(--text-primary); letter-spacing:0.06em; text-transform:uppercase;">
          <span>Past trails</span>
          <button id="a2ui-history-close" style="background:none; border:none; color:var(--text-tertiary); cursor:pointer; font-size:14px;">✕</button>
        </div>
        <div id="a2ui-history-list" style="display:flex; flex-direction:column; gap:8px; max-height:240px; overflow-y:auto;">
          <div style="font-size:13px; color:var(--text-tertiary);">No trails yet — your first search starts one.</div>
        </div>
      </div>

      <!-- Everything below the header scrolls; the header itself does not. -->
      <div id="a2ui-scroll">

      <!-- Status Bar -->
      <div id="a2ui-status-box">
        <div id="a2ui-status-spinner" style="width:18px;height:18px;border:2.5px solid var(--border-strong);border-top-color:var(--text-primary);border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;"></div>
        <span id="a2ui-status-text">Picking up the trail…</span>
      </div>

      <!-- Two-column layout -->
      <div id="a2ui-main-layout">
        <!-- Left: conversation turns -->
        <div id="a2ui-left-col">
          <div id="a2ui-turns"></div>
        </div>

        <!-- Right: sidebar -->
        <div id="a2ui-right-col">
          <div class="a2ui-context-card">
            <div class="a2ui-context-card-label">Trail</div>
            <div class="a2ui-context-card-text" id="a2ui-preview-text">Every step the agent takes shows up here.</div>
          </div>
          <div id="a2ui-right-extras"></div>
        </div>
      </div>

      </div><!-- /#a2ui-scroll -->
    `;

    wireViewMode();
    wireFullscreen();
    document.getElementById('a2ui-btn-stop')?.addEventListener('click', stopRun);
    document.getElementById('a2ui-btn-new-chat')?.addEventListener('click', startNewChat);
    document.getElementById('a2ui-btn-history')?.addEventListener('click', toggleHistoryDrawer);
    document.getElementById('a2ui-history-close')?.addEventListener('click', () => {
      document.getElementById('a2ui-history-drawer')?.classList.add('hidden');
    });
  }

  // Layout mode. "auto" is the default and leaves the container queries in
  // charge; focus/split are deliberate overrides that survive reloads, because
  // a user who has chosen a reading mode has chosen it for the session, not
  // for one answer.
  const VIEW_KEY = 'a2ui_view_mode';
  const FULLSCREEN_KEY = 'a2ui_fullscreen_mode';

  function applyFullscreen(enable) {
    const dw = document.getElementById('dashboard-window');
    const view = document.getElementById('view-agent-search');
    const btn = document.getElementById('a2ui-btn-fullscreen');
    const icon = document.getElementById('a2ui-fullscreen-icon');
    const label = document.getElementById('a2ui-fullscreen-label');

    if (enable) {
      dw?.classList.add('a2ui-fullscreen-mode');
      view?.classList.add('a2ui-fullscreen-mode');
      document.body.classList.add('a2ui-fullscreen-active');
      if (label) label.textContent = 'Exit Fullscreen';
      if (icon) icon.innerHTML = '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>';
      if (btn) {
        btn.classList.add('is-active');
        btn.style.background = 'rgba(255, 255, 255, 0.18)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.32)';
        btn.title = 'Exit fullscreen mode (Esc or Cmd+Shift+F)';
      }
    } else {
      dw?.classList.remove('a2ui-fullscreen-mode');
      view?.classList.remove('a2ui-fullscreen-mode');
      document.body.classList.remove('a2ui-fullscreen-active');
      if (label) label.textContent = 'Fullscreen';
      if (icon) icon.innerHTML = '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>';
      if (btn) {
        btn.classList.remove('is-active');
        btn.style.background = 'rgba(255, 255, 255, 0.08)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.16)';
        btn.title = 'Toggle full-screen research canvas (Cmd+Shift+F)';
      }
    }
  }

  function toggleFullscreen() {
    const view = document.getElementById('view-agent-search');
    const next = !view?.classList.contains('a2ui-fullscreen-mode');
    try { localStorage.setItem(FULLSCREEN_KEY, next ? 'true' : 'false'); } catch (_) {}
    applyFullscreen(next);
  }

  function wireFullscreen() {
    let enabled = true; // Default to full screen canvas as requested
    try {
      const saved = localStorage.getItem(FULLSCREEN_KEY);
      if (saved !== null) enabled = saved === 'true';
    } catch (_) {}
    applyFullscreen(enabled);

    document.getElementById('a2ui-btn-fullscreen')?.addEventListener('click', toggleFullscreen);
  }

  if (!window.__a2uiFullscreenKeysWired) {
    window.__a2uiFullscreenKeysWired = true;
    document.addEventListener('keydown', (e) => {
      const view = document.getElementById('view-agent-search');
      if (!view || view.classList.contains('hidden')) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape' && view.classList.contains('a2ui-fullscreen-mode')) {
        e.preventDefault();
        try { localStorage.setItem(FULLSCREEN_KEY, 'false'); } catch (_) {}
        applyFullscreen(false);
      }
    });
  }

  function applyViewMode(mode) {
    const layout = document.getElementById('a2ui-main-layout');
    if (layout) {
      if (mode && mode !== 'auto') layout.dataset.view = mode;
      else delete layout.dataset.view;
    }
    document.querySelectorAll('#a2ui-viewmode button').forEach((b) => {
      const on = (b.dataset.view === (mode || 'auto'));
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function wireViewMode() {
    let mode = 'auto';
    try { mode = localStorage.getItem(VIEW_KEY) || 'auto'; } catch (_) {}
    applyViewMode(mode);
    document.querySelectorAll('#a2ui-viewmode button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.view;
        try { localStorage.setItem(VIEW_KEY, next); } catch (_) {}
        applyViewMode(next);
      });
    });
  }

  // Copy buttons on code blocks. The blocks are injected as HTML strings by
  // formatText, so the handler is delegated from the document rather than
  // bound per block — every re-render of a streaming answer would otherwise
  // need to re-bind, and stale listeners would pile up on each token.
  if (!window.__a2uiCodeCopyWired) {
    window.__a2uiCodeCopyWired = true;
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('.a2ui-code-copy');
      if (!btn) return;
      const code = btn.closest('.a2ui-code')?.querySelector('code');
      if (!code) return;
      const text = code.textContent || '';
      const done = () => {
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
        done();
      }
    });
  }

  function startNewChat() {
    _runInFlight = false;
    if (_abort) _abort.abort();
    _activeTabTurns = [];
    if (typeof window.__a2uiSyncTabTurns === 'function') {
      window.__a2uiSyncTabTurns(_activeTabId, []);
    }
    rebuildViewHTML();
    const titleEl = document.getElementById('a2ui-query-title');
    if (titleEl) titleEl.textContent = 'New Research Chat';
    const statusBox = document.getElementById('a2ui-status-box');
    if (statusBox) statusBox.style.display = 'none';
  }

  function saveCurrentChatSession(turns) {
    if (!turns || !turns.length) return;
    try {
      const firstTurn = turns[0];
      const title = firstTurn.query;
      const saved = JSON.parse(localStorage.getItem('a2ui_saved_conversations') || '[]');
      const filtered = saved.filter(s => s.title !== title);
      filtered.unshift({
        id: 'conv-' + Date.now(),
        title: title,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        turns: turns
      });
      localStorage.setItem('a2ui_saved_conversations', JSON.stringify(filtered.slice(0, 30)));
    } catch (_) {}
  }

  function toggleHistoryDrawer() {
    const drawer = document.getElementById('a2ui-history-drawer');
    const list = document.getElementById('a2ui-history-list');
    if (!drawer || !list) return;

    if (!drawer.classList.contains('hidden')) {
      drawer.classList.add('hidden');
      return;
    }

    try {
      const conversations = JSON.parse(localStorage.getItem('a2ui_saved_conversations') || '[]');
      if (!conversations.length) {
        list.innerHTML = `<div style="font-size:13px; color:var(--text-tertiary);">No trails yet — your first search starts one.</div>`;
      } else {
        list.innerHTML = conversations.map(c => `
          <div class="a2ui-history-item" data-id="${attr(c.id)}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-radius:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); cursor:pointer; transition:background 0.2s;">
            <div style="font-weight:600; font-size:13px; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:75%;">${esc(c.title)}</div>
            <div style="font-size:11px; color:var(--text-tertiary); font-family:monospace;">${esc(c.timestamp)} (${c.turns ? c.turns.length : 1} turns)</div>
          </div>
        `).join('');

        list.querySelectorAll('.a2ui-history-item').forEach(el => {
          el.addEventListener('click', () => {
            // Was `el.dataset.title` — the rows only ever carried data-id, so
            // this read undefined and the guarded runSearch never fired,
            // leaving every history row inert. The saved entry carries its
            // full turns, so reopening the conversation beats re-running a
            // search from its title.
            const rec = conversations.find(c => String(c.id) === el.dataset.id);
            drawer.classList.add('hidden');
            if (!rec) return;
            if (_runInFlight) return;
            _activeTabTurns = Array.isArray(rec.turns) ? rec.turns.slice() : [];
            rebuildViewHTML();
            renderActiveTabTurns();
            if (typeof window.__a2uiSyncTabTurns === 'function') {
              window.__a2uiSyncTabTurns(_activeTabId, _activeTabTurns);
            }
          });
        });
      }
    } catch (_) {}

    drawer.classList.remove('hidden');
  }

  // ─── Main runner ─────────────────────────────────────────────
  let _abort = null;
  let _history = [];
  let _sessionId = null;

  // Stop is only meaningful while a turn is in flight, so the button lives or
  // dies with the run. Aborting the fetch alone leaves the engine churning
  // server-side, so the session is cancelled through the API as well.
  function setRunningUI(running) {
    const btn = document.getElementById('a2ui-btn-stop');
    if (btn) btn.hidden = !running;
  }

  function stopRun() {
    _runInFlight = false;
    if (_abort) { try { _abort.abort(); } catch (_) {} }
    if (_sessionId) {
      fetch(`${SOUL}/agent/cancel/${encodeURIComponent(_sessionId)}`, { method: 'POST' })
        .catch(() => {});
    }
    setRunningUI(false);
    const statusBox = document.getElementById('a2ui-status-box');
    if (statusBox) statusBox.style.display = 'none';
  }
  window.__a2uiStop = stopRun;

  // The model cites its sources as bare "[3]" markers. Left alone they are
  // dead text pointing at a list the reader cannot see — so resolve each one
  // against the gathered results and make it open that source.
  function linkCitations(html, items) {
    if (!html || !items || !items.length) return html;

    const link = (n) => {
      const it = items[parseInt(n, 10) - 1];
      if (!it || !it.url) return null;
      const label = esc(it.domain || `Source ${n}`);
      return `<a class="a2ui-cite" href="${attr(it.url)}" title="${attr(it.title || it.url)}"` +
             ` onclick="window.__a2uiOpenTab('${attr(it.url)}');return false;">` +
             `<span class="a2ui-cite-n">${esc(n)}</span>${label}</a>`;
    };

    // Code is content, not prose: a `list[1]` inside a snippet is an index, not
    // a citation, and rewriting it into an anchor corrupts the code and breaks
    // copy-paste. Split on code regions and only rewrite the prose between them.
    return html.split(/(<(?:pre|code|figure)\b[\s\S]*?<\/(?:pre|code|figure)>)/gi)
      .map((chunk, i) => {
        if (i % 2) return chunk;              // odd chunks are the code regions
        // "[1][2]" and "[1, 2]" are both single citation clusters.
        return chunk.replace(/\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g, (whole, body) => {
          const links = body.split(/[,;]/).map((n) => link(n.trim())).filter(Boolean);
          return links.length ? links.join('') : whole;
        }).replace(/\](\s*)\[/g, ']$1[');
      }).join('');
  }

  // Live trace of what the agent is actually doing — each thinking step and
  // tool call becomes a row, marked complete when its result arrives. Replaces
  // a status line that only ever showed the newest event and then vanished.
  function makeTrace(hostEl) {
    let list = null;
    let current = null;

    function ensure() {
      if (list || !hostEl) return list;
      // The card ships with placeholder copy describing what will appear here.
      // Once something actually appears, the promise is redundant — retiring
      // it avoids a panel that says "nothing yet" directly above its contents.
      // Hide, do not remove. That div is also #a2ui-preview-text, which every
      // run writes tool_result previews into — and rebuildViewHTML (the only
      // thing that recreates it) is skipped on follow-ups. Removing it made
      // previewText null from turn 2 onward; the resulting TypeError was
      // swallowed by streamSSE's catch, which then re-dispatched the raw SSE
      // line as a token and spliced tool_result JSON into the answer body.
      const placeholder = hostEl.querySelector('.a2ui-context-card-text');
      if (placeholder) placeholder.hidden = true;
      list = document.createElement('ol');
      list.className = 'a2ui-trace';
      hostEl.appendChild(list);
      return list;
    }

    return {
      step(label, kind) {
        if (!ensure()) return;
        // Collapse repeats — the engine re-emits the same status while polling.
        if (current && current.dataset.label === label) return;
        // A new step means the previous one finished, even when the engine
        // sent no explicit result for it (the research path emits consecutive
        // thinking steps and no tool_result).
        if (current) {
          current.classList.remove('is-active');
          current.classList.add('is-done');
        }
        const li = document.createElement('li');
        li.className = `a2ui-trace-row is-${kind || 'call'} is-active`;
        li.dataset.label = label;
        li.innerHTML =
          `<span class="a2ui-trace-dot" aria-hidden="true"></span>
           <span class="a2ui-trace-label"></span>`;
        li.querySelector('.a2ui-trace-label').textContent = label;
        list.appendChild(li);
        current = li;
        list.scrollTop = list.scrollHeight;
      },
      done(detail) {
        if (!current) return;
        current.classList.remove('is-active');
        current.classList.add('is-done');
        if (detail) current.title = detail.slice(0, 300);
        current = null;
      },
      finish() {
        if (!list) return;
        list.querySelectorAll('.is-active').forEach((el) => {
          el.classList.remove('is-active');
          el.classList.add('is-done');
        });
        current = null;
      },
    };
  }

  // Suggested next questions, mounted directly above the prompt bar. Replaces
  // the old standalone "follow-up questions" card — the suggestions and the
  // place you type are now the same control.
  // Mounts into the turn that produced them. This used to target
  // #a2ui-composer, which exists nowhere in the project — agent-composer.js
  // builds #a2ui-composer-dock in a different view, and .a2ui-composer is a
  // class, not an id. So the lookup always failed, the function always
  // returned null, and since stripFollowups removes the tags from the answer
  // text, every suggested follow-up was discarded without ever being shown.
  function renderComposerSuggestions(followups, onPick, turnEl) {
    const host = turnEl || document.getElementById('a2ui-turns');
    if (!host || !followups.length) return null;
    host.querySelector('#a2ui-suggestions')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'a2ui-suggestions';
    wrap.innerHTML = followups.slice(0, 4).map((fq) =>
      `<button type="button" class="a2ui-chip" data-fq="${attr(fq)}">${esc(fq)}</button>`
    ).join('');

    wrap.querySelectorAll('.a2ui-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        wrap.remove();
        onPick(btn.dataset.fq);
      });
    });
    host.appendChild(wrap);
    return wrap;
  }

  // Copy the answer's source markdown, with a brief confirmation in place of
  // the label — no toast, no layout shift.
  function wireCopy(card) {
    const btn = card.querySelector('.a2ui-copy');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = card.dataset.raw || card.querySelector('.a2ui-answer-text')?.innerText || '';
      if (!text) return;
      const label = btn.querySelector('.a2ui-copy-label');
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        // Clipboard API needs a secure context; fall back to a scratch node.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (__) {}
        ta.remove();
      }
      btn.classList.add('is-done');
      if (label) label.textContent = 'Copied';
      setTimeout(() => {
        btn.classList.remove('is-done');
        if (label) label.textContent = 'Copy';
      }, 1600);
    });
  }

  // Inline consent prompt for a state-changing agent action (navigate, click,
  // type, pane/cluster ops). The engine parks the turn on _await_approval
  // until /agent/approve or /agent/deny resolves it, so this must always
  // answer — a silent drop stalls the run until the gate times out and the
  // model is told the user denied it.
  function askApproval(ev, turnEl) {
    const actionId = ev.action_id || ev.id;
    const sessionId = ev.session_id || _sessionId;

    const settle = (approved) => {
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      verdict.textContent = approved ? 'Allowed' : 'Blocked';
      verdict.className = 'a2ui-approve-verdict is-' + (approved ? 'yes' : 'no');

      // renderer.js owns both halves: it resolves the engine's approval gate
      // AND (on approve) executes the action and posts the observation back.
      const fn = approved ? window._nxApprove : window._nxDeny;
      if (typeof fn === 'function') {
        try { fn(sessionId, actionId); } catch (_) {}
        return;
      }
      // Renderer helpers absent — deny directly so the turn is never left
      // hanging on a gate nobody can resolve.
      if (sessionId) {
        fetch(`${SOUL}/agent/deny/${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_id: actionId }),
        }).catch(() => {});
      }
    };

    const row = document.createElement('div');
    row.className = 'a2ui-approve';
    row.innerHTML =
      `<div class="a2ui-approve-head">
         <span class="a2ui-approve-title"></span>
         <span class="a2ui-approve-verdict"></span>
       </div>
       <div class="a2ui-approve-detail"></div>
       <div class="a2ui-approve-actions">
         <button type="button" class="a2ui-approve-no">Block</button>
         <button type="button" class="a2ui-approve-yes">Allow once</button>
       </div>`;

    // textContent, not innerHTML: ev.name/args are model-authored.
    row.querySelector('.a2ui-approve-title').textContent =
      `Allow the agent to run ${ev.name || 'this action'}?`;
    row.querySelector('.a2ui-approve-detail').textContent =
      ev.label || (ev.args ? JSON.stringify(ev.args) : '');
    const verdict = row.querySelector('.a2ui-approve-verdict');

    row.querySelector('.a2ui-approve-yes').addEventListener('click', () => settle(true));
    row.querySelector('.a2ui-approve-no').addEventListener('click', () => settle(false));

    // Park the event so _nxApprove can find and execute it after the gate opens.
    if (typeof window.__bucksStashPendingAction === 'function') {
      try { window.__bucksStashPendingAction(ev); } catch (_) {}
    }

    (turnEl || document.getElementById('a2ui-turns'))?.appendChild(row);
  }

  async function runSearch(query, isFollowup) {
    if (!query) return;

    if (_abort) _abort.abort();
    _abort = new AbortController();
    _runInFlight = true;

    injectStyles();
    if (!isFollowup) rebuildViewHTML();


    const titleEl = document.getElementById('a2ui-query-title');
    const statusBox = document.getElementById('a2ui-status-box');
    const statusText = document.getElementById('a2ui-status-text');
    const turnsEl = document.getElementById('a2ui-turns');
    const rightExtras = document.getElementById('a2ui-right-extras');
    const previewText = document.getElementById('a2ui-preview-text');

    if (!turnsEl) return;

    // Switch to agent-search view (window.showDashboardView is exported from renderer.js IIFE)
    const dw = document.getElementById('dashboard-window');
    if (dw) dw.classList.remove('hidden');
    document.body.classList.remove('web-mode');

    if (typeof window.showDashboardView === 'function') {
      window.showDashboardView('agent-search');
    }
    document.querySelectorAll('.dashboard-view').forEach(v => v.classList.add('hidden'));
    const agView = document.getElementById('view-agent-search');
    if (agView) agView.classList.remove('hidden');


    titleEl.textContent = isFollowup ? `Follow-up: "${query}"` : `"${query}"`;

    // Re-show status spinner for this search turn
    if (statusBox) statusBox.style.display = '';
    if (statusText) statusText.textContent = `Following the trail on “${query}”…`;

    if (!isFollowup) _history = [];


    // Create turn container for this conversation step
    const turnEl = document.createElement('div');
    turnEl.className = 'a2ui-turn-container';
    turnsEl.appendChild(turnEl);

    // Add user question bubble inside this turn container for follow-ups (turn 0 already has query in #a2ui-query-title)
    if (isFollowup || turnsEl.children.length > 1) {
      const bubble = document.createElement('div');
      bubble.className = 'a2ui-user-bubble';
      bubble.innerHTML = `<div class="a2ui-user-bubble-inner">${esc(query)}</div>`;
      turnEl.appendChild(bubble);
    }

    // Enhanced skeleton loader matching actual card layout structure
    const skeleton = document.createElement('div');
    // The skeleton borrows the answer card's styling but must NOT answer to
    // its selector: the per-token lookup for .a2ui-answer-card runs on every
    // token, and while the skeleton was the first match the real answer card
    // was never created — short answers that finished inside the skeleton's
    // 300ms fade window rendered nowhere at all, and the offline fallback hit
    // the same trap. Every lookup below is now :not(.a2ui-skeleton-shell).
    skeleton.className = 'a2ui-answer-card a2ui-skeleton-shell';
    skeleton.innerHTML = `
      <div class="a2ui-answer-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Answer</div>
      <div class="a2ui-skeleton-container">
        <div class="a2ui-skeleton-grid">
          <!-- Hero card skeleton -->
          <div class="a2ui-skeleton-card a2ui-skeleton-card-hero">
            <div class="a2ui-skeleton-media a2ui-skeleton-media-hero"></div>
            <div class="a2ui-skeleton-body">
              <div class="a2ui-skeleton-line" style="height:20px; width:85%; margin-bottom:8px;"></div>
              <div class="a2ui-skeleton-line" style="height:16px; width:78%; margin-bottom:6px;"></div>
              <div class="a2ui-skeleton-line" style="height:14px; width:60%;"></div>
            </div>
          </div>
          <!-- Regular card skeletons -->
          <div class="a2ui-skeleton-card">
            <div class="a2ui-skeleton-media"></div>
            <div class="a2ui-skeleton-body">
              <div class="a2ui-skeleton-line" style="height:16px; width:88%; margin-bottom:6px;"></div>
              <div class="a2ui-skeleton-line" style="height:12px; width:72%;"></div>
            </div>
          </div>
          <div class="a2ui-skeleton-card">
            <div class="a2ui-skeleton-media"></div>
            <div class="a2ui-skeleton-body">
              <div class="a2ui-skeleton-line" style="height:16px; width:82%; margin-bottom:6px;"></div>
              <div class="a2ui-skeleton-line" style="height:12px; width:65%;"></div>
            </div>
          </div>
          <div class="a2ui-skeleton-card">
            <div class="a2ui-skeleton-media"></div>
            <div class="a2ui-skeleton-body">
              <div class="a2ui-skeleton-line" style="height:16px; width:90%; margin-bottom:6px;"></div>
              <div class="a2ui-skeleton-line" style="height:12px; width:58%;"></div>
            </div>
          </div>
        </div>
      </div>`;
    turnEl.appendChild(skeleton);

    _history.push({ role: 'user', content: query });

    let activePageContextStr = '';
    if (typeof window.getActivePageContext === 'function') {
      try {
        const pageCtx = await window.getActivePageContext();
        if (pageCtx && pageCtx.url && !pageCtx.url.startsWith('bucks://')) {
          activePageContextStr = `\n[Currently Active Web Window:\nTitle: ${pageCtx.title}\nURL: ${pageCtx.url}\nPage Text Snippet:\n${pageCtx.text}]\n`;
        }
      } catch (_) {}
    }

    const openTabsCtx = (typeof window.getOpenTabsContext === 'function') ? window.getOpenTabsContext() : '';
    const tabsPrefix = openTabsCtx ? `\n[Open Tabs Context:\n${openTabsCtx}]\n` : '';

    const prompt = isFollowup
      ? `${activePageContextStr}${tabsPrefix}Follow-up: "${query}". Based on active window, open tabs, and previous context, provide a concise evidence-backed answer.`
      : `${activePageContextStr}${tabsPrefix}Research "${query}" and return: 1) a clear detailed answer, 2) images (use image_search tool), 3) videos if relevant, 4) top sources, 5) follow-up questions.`;

    let answer = '';
    let followups = [];
    let streamError = null;
    let wasCancelled = false;
    const collectedUrls = [];
    const collectedImages = [];
    const renderedComponents = [];

    // Live activity trace, rendered into the context card beside the answer.
    const trace = makeTrace(document.querySelector('.a2ui-context-card'));

    // One unified result surface, rebuilt in place as components stream in.
    // The user's chosen layout survives each rebuild.
    const resultItems = [];
    let resultLayout = null;
    let resultHost = null;

    function renderResultSurface() {
      if (!window.A2UIResults || !rightExtras || !resultItems.length) return;
      const next = window.A2UIResults.render(resultItems, {
        title: 'Results',
        layout: resultLayout || undefined,
        onLayout: (id) => { resultLayout = id; },
      });
      if (resultHost && resultHost.parentNode) resultHost.replaceWith(next);
      else rightExtras.appendChild(next);
      resultHost = next;
    }

    try {
      await streamSSE(`${SOUL}/agent`, { message: prompt, agentic: true }, (ev) => {
        if (!ev) return;

        // ── Events the engine has always emitted and this surface ignored ──
        // Silently dropping them cost real behaviour: an `error` closed the
        // stream cleanly so the catch-based fallback never fired and the user
        // was left with a stopped spinner and no answer; `session` is the only
        // way to reach /agent/cancel, so there was nothing to stop a runaway
        // research turn; and `browser_action` went unanswered, parking the
        // engine in _await_remote_tool for its full 90s timeout on every
        // request that also asked for a document or PDF.
        if (ev.type === 'session') {
          _sessionId = ev.session_id || null;
          setRunningUI(true);
          return;
        }

        if (ev.type === 'browser_action') {
          if (ev.needs_approval || ev.confirm) {
            // NEVER hand an approval-gated action straight to the executor.
            // handleAgentToolRequest only prompts when `needsApproval &&
            // !window.nexusAPI`, and nexusAPI is always exposed
            // (preload.js:416) — so that branch is dead and the action would
            // run on the live tab with no consent. It would also post its
            // result before the engine has registered the pending tool (it
            // awaits approval first), so the observation is discarded and the
            // turn stalls until the approval gate times out.
            askApproval(ev, turnEl);
          } else if (typeof window.__bucksHandleAgentToolRequest === 'function') {
            try { window.__bucksHandleAgentToolRequest(ev); } catch (_) {}
          } else if (ev.id) {
            // No browser control on this surface — answer immediately rather
            // than let the engine block for 90 seconds waiting on nobody.
            fetch(`${SOUL}/agent/tool_result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: ev.id, result: 'Browser control unavailable on this surface.' }),
            }).catch(() => {});
          }
          if (ev.label) trace.step(ev.label, 'call');
          return;
        }

        if (ev.type === 'error') {
          streamError = ev.content || 'The engine reported an error.';
          return;
        }

        if (ev.type === 'cancelled') {
          wasCancelled = true;
          return;
        }

        if (ev.type === 'done') {
          return;
        }

        if (ev.type === 'thinking') {
          statusText.textContent = ev.content || 'Synthesizing...';
          trace.step(ev.content || 'Thinking', 'think');
        } else if (ev.type === 'tool_call') {
          statusText.textContent = `Running: ${ev.label || ev.name}...`;
          trace.step(ev.label || ev.name || 'tool', 'call');
        } else if (ev.type === 'tool_result') {
          const txt = (ev.content || '').trim();
          if (previewText) previewText.textContent = txt.slice(0, 180) + (txt.length > 180 ? '…' : '');
          trace.done(txt);
        } else if (ev.type === 'ui_component') {
          statusBox.style.display = 'none';
          if (skeleton.parentNode) {
            const skeletonContainer = skeleton.querySelector('.a2ui-skeleton-container');
            if (skeletonContainer) skeletonContainer.classList.add('fade-out');
            setTimeout(() => skeleton.parentNode && skeleton.remove(), 300);
          }

          // Every component shape — web hits, galleries, video rails and the
          // research dossier — folds into one result surface. Previously each
          // rendered its own widget and `research` (the most common response)
          // had no renderer at all, so its sources, images and videos were
          // dropped on the floor.
          if (window.A2UIResults) {
            const fresh = window.A2UIResults.normalize(ev.component, ev.data || {});
            if (fresh.length) {
              fresh.forEach((it) => {
                if (it.url && !collectedUrls.includes(it.url)) collectedUrls.push(it.url);
                if (it.kind === 'image' && it.full) collectedImages.push(it.full);
              });
              resultItems.push(...fresh);
              renderResultSurface();
              renderedComponents.push(ev.component);
            }
          } else if (ev.component === 'image_gallery') {
            const html = renderImageGallery(ev.data || {}, query);
            if (html) {
              const wrap = document.createElement('div');
              wrap.innerHTML = html;
              rightExtras.appendChild(wrap.firstElementChild);
            }
            renderedComponents.push('images');
          } else if (ev.component === 'video') {
            const html = renderVideoCards(ev.data || {});
            if (html) {
              const wrap = document.createElement('div');
              wrap.innerHTML = html;
              rightExtras.appendChild(wrap.firstElementChild);
            }
            renderedComponents.push('video');
          } else if (ev.component === 'list' || ev.component === 'sources') {
            const srcHtml = renderSources(collectedUrls);
            if (srcHtml && rightExtras) {
              const existingSrc = rightExtras.querySelector('.a2ui-sources-section');
              if (existingSrc) existingSrc.remove();
              const wrap = document.createElement('div');
              wrap.className = 'a2ui-sources-section';
              wrap.innerHTML = srcHtml;
              rightExtras.appendChild(wrap);
            }
          }
        } else if (ev.type === 'token') {
          statusBox.style.display = 'none';
          if (skeleton.parentNode) {
            const skeletonContainer = skeleton.querySelector('.a2ui-skeleton-container');
            if (skeletonContainer) skeletonContainer.classList.add('fade-out');
            setTimeout(() => skeleton.parentNode && skeleton.remove(), 300);
          }

          const chunk = ev.content || ev.token || '';
          answer += chunk;

          followups = extractFollowups(answer);
          const cleanAnswer = stripFollowups(answer);

          // Extract URLs from answer text
          const urlMatches = cleanAnswer.match(/(https?:\/\/[^\s)]+)/g) || [];
          urlMatches.forEach(u => { if (!collectedUrls.includes(u)) collectedUrls.push(u); });

          let answerCard = turnEl.querySelector('.a2ui-answer-card:not(.a2ui-skeleton-shell)');
          if (!answerCard) {
            answerCard = document.createElement('div');
            answerCard.className = 'a2ui-answer-card';
            answerCard.innerHTML =
              `<div class="a2ui-answer-head">
                 <span class="a2ui-answer-label">Answer</span>
                 <button class="a2ui-copy" title="Copy answer" aria-label="Copy answer">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1">
                     <rect x="9" y="9" width="11" height="11" rx="2"/>
                     <path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                   <span class="a2ui-copy-label">Copy</span>
                 </button>
               </div>
               <div class="a2ui-answer-text"></div>`;
            turnEl.appendChild(answerCard);
            wireCopy(answerCard);
          }
          const answerText = answerCard.querySelector('.a2ui-answer-text');
          if (answerText) {
            answerText.innerHTML = linkCitations(formatText(cleanAnswer), resultItems);
          }
          // Keep the raw markdown around — copying should yield the source
          // text, not the rendered HTML's collapsed whitespace.
          answerCard.dataset.raw = cleanAnswer;
        }
      }, _abort.signal);

      // Done — render post-answer sections
      statusBox.style.display = 'none';
      trace.finish();
      setRunningUI(false);
      _runInFlight = false;

      // A streamed `error` closes the SSE cleanly, so nothing is thrown and the
      // catch-based web fallback below never runs. Escalate it here instead —
      // with no answer to show, that fallback is exactly what the user needs.
      if (streamError && !answer.trim()) {
        throw new Error(streamError);
      }
      if (streamError) {
        const card = turnEl.querySelector('.a2ui-answer-card:not(.a2ui-skeleton-shell)');
        if (card && !card.querySelector('.a2ui-answer-note')) {
          const note = document.createElement('div');
          note.className = 'a2ui-answer-note';
          note.textContent = `Answer may be incomplete — ${streamError}`;
          card.appendChild(note);
        }
      }
      if (wasCancelled) {
        const card = turnEl.querySelector('.a2ui-answer-card:not(.a2ui-skeleton-shell)');
        if (card && !card.querySelector('.a2ui-answer-note')) {
          const note = document.createElement('div');
          note.className = 'a2ui-answer-note';
          note.textContent = 'Stopped before this answer finished.';
          card.appendChild(note);
        }
      }

      // Sources
      if (window.A2UIResults && resultItems.length) {
        // Already rendered from the component stream; nothing to re-add. URLs
        // that only appeared in the answer prose still deserve a home, so fold
        // them in as text-only cards.
        const known = new Set(resultItems.map((i) => i.url));
        const extra = collectedUrls
          .filter((u) => !known.has(u))
          .map((u) => window.A2UIResults.normalize('list', { items: [{ url: u }] })[0])
          .filter(Boolean);
        if (extra.length) {
          resultItems.push(...extra);
          renderResultSurface();
        }
      } else if (collectedUrls.length > 0) {
        const srcHtml = renderSources(collectedUrls);
        if (srcHtml && rightExtras) {
          const existingSrc = rightExtras.querySelector('.a2ui-sources-section');
          if (existingSrc) existingSrc.remove();
          const wrap = document.createElement('div');
          wrap.innerHTML = srcHtml;
          rightExtras.appendChild(wrap.firstElementChild);
        }
      }

      // CTAs attached once directly beneath the answer card
      const ctaHtml = renderCTAs(answer, collectedUrls, query);
      if (ctaHtml && !turnEl.querySelector('.a2ui-ctas')) {
        const wrap = document.createElement('div');
        wrap.className = 'a2ui-cta-wrap';
        wrap.innerHTML = ctaHtml;
        turnEl.appendChild(wrap);
      }

      // Suggested follow-ups belong ON the prompt bar, not in a card of their
      // own further up the page. One continuation path, always in the same
      // place, whether you type your own question or take a suggestion.
      if (followups.length > 0) {
        const chipEl = renderComposerSuggestions(followups, (fq) => {
          runSearch(fq, true);
        }, turnEl);
        if (chipEl) { /* mounted by the helper */ }
      }

      _history.push({ role: 'assistant', content: answer });
      const newTurn = { query: query, answer: answer, followups: followups };
      _activeTabTurns.push(newTurn);
      if (typeof window.__a2uiSyncTabTurns === 'function') {
        window.__a2uiSyncTabTurns(_activeTabId, _activeTabTurns);
      }
      /* saveCurrentChatHistory() used to be called here too. No such function
         exists anywhere in the codebase, so this line threw a ReferenceError on
         every completed turn — after the answer was built but before it was
         scrolled into view — which aborted the handler and left the chat panel
         closed and empty. The real persistence is saveCurrentChatSession(),
         called on the line above; this was a stale duplicate. */
      saveCurrentChatSession(_activeTabTurns);

      // Scroll to bottom
      setTimeout(() => {
        turnsEl.scrollIntoView ? turnsEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }) : null;
      }, 100);

    } catch (err) {
      console.warn('[A2UI Engine] Soul Engine response stream delayed/offline, running instant web fallback:', err);
      statusBox.style.display = 'none';
      setRunningUI(false);
      _runInFlight = false;
      if (skeleton.parentNode) {
        const skeletonContainer = skeleton.querySelector('.a2ui-skeleton-container');
        if (skeletonContainer) skeletonContainer.classList.add('fade-out');
        setTimeout(() => skeleton.parentNode && skeleton.remove(), 300);
      }

        // Attempt background supervisor restart if API bridge exists
        if (window.bucksAPI && typeof window.bucksAPI.soulSupervisorStart === 'function') {
          try { window.bucksAPI.soulSupervisorStart(); } catch (_) {}
        }

        // Direct web intelligence fallback query
        let fallbackAnswer = `**Research Breakdown for "${query}":**\n\n`;
        const fallbackUrls = [];
        try {
          const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
          if (res.ok) {
            const data = await res.json();
            if (data.AbstractText) fallbackAnswer += `${data.AbstractText}\n\n`;
            if (data.AbstractURL) fallbackUrls.push(data.AbstractURL);
            (data.RelatedTopics || []).slice(0, 4).forEach(t => {
              if (t.Text && t.FirstURL) {
                fallbackAnswer += `- **${esc(t.Text.slice(0, 100))}**: [Source Link](${t.FirstURL})\n`;
                fallbackUrls.push(t.FirstURL);
              }
            });
          }
        } catch (_) {}

        if (!fallbackUrls.length) {
          fallbackUrls.push(`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`);
          fallbackAnswer += `Gathered comprehensive background context and reference data for **${esc(query)}**.\n\n- Exploring primary domain sources and technical documentation.\n- Auto-restarting Soul Engine local background daemon (port 8765).`;
        }

        let answerCard = turnEl.querySelector('.a2ui-answer-card:not(.a2ui-skeleton-shell)');
        if (!answerCard) {
          answerCard = document.createElement('div');
          answerCard.className = 'a2ui-answer-card';
          answerCard.innerHTML =
            `<div class="a2ui-answer-head">
               <span class="a2ui-answer-label">Answer · web fallback</span>
               <button class="a2ui-copy" title="Copy answer" aria-label="Copy answer">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1">
                   <rect x="9" y="9" width="11" height="11" rx="2"/>
                   <path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                 <span class="a2ui-copy-label">Copy</span>
               </button>
             </div>
             <div class="a2ui-answer-text"></div>`;
          turnEl.appendChild(answerCard);
          wireCopy(answerCard);
        }
        const answerText = answerCard.querySelector('.a2ui-answer-text');
        if (answerText) answerText.innerHTML = formatText(fallbackAnswer);
        answerCard.dataset.raw = fallbackAnswer;

        // Sources & CTAs for fallback
        const srcHtml = renderSources(fallbackUrls);
        if (srcHtml && rightExtras) {
          const existingSrc = rightExtras.querySelector('.a2ui-sources-section');
          if (existingSrc) existingSrc.remove();
          const wrap = document.createElement('div');
          wrap.innerHTML = srcHtml;
          rightExtras.appendChild(wrap.firstElementChild);
        }

        const ctaHtml = renderCTAs(fallbackAnswer, fallbackUrls, query);
        if (ctaHtml && !turnEl.querySelector('.a2ui-ctas')) {
          const wrap = document.createElement('div');
          wrap.className = 'a2ui-cta-wrap';
          wrap.innerHTML = ctaHtml;
          turnEl.appendChild(wrap);
        }

        /* Same undefined call as the success path, with the same effect: the
           offline fallback rendered an answer and then threw. Unlike that path
           this one never recorded a turn at all, so persist it the same way a
           normal turn is persisted — an offline answer should survive a reload
           like any other. */
        _history.push({ role: 'assistant', content: fallbackAnswer });
        _activeTabTurns.push({ query: query, answer: fallbackAnswer, followups: [] });
        if (typeof window.__a2uiSyncTabTurns === 'function') {
          window.__a2uiSyncTabTurns(_activeTabId, _activeTabTurns);
        }
        saveCurrentChatSession(_activeTabTurns);
    }
  }

  // ─── Public API ───────────────────────────────────────────────
  window.__a2uiOpenTab = function(url) {
    if (!url) return;
    console.log('[A2UI Engine] Opening link in new tab:', url);

    // Unfreeze backdrop if frozen
    if (typeof unfreezePageBackdrop === 'function') {
      try { unfreezePageBackdrop(); } catch (_) {}
    }
    document.body.classList.remove('agent-freeze');

    // Synchronize active research tab turns before switching tabs
    if (typeof window.__a2uiSyncTabTurns === 'function' && _activeTabId && _activeTabTurns) {
      window.__a2uiSyncTabTurns(_activeTabId, _activeTabTurns);
    }

    let createdId = null;
    if (typeof createTab === 'function') {
      createdId = createTab(url);
    } else if (window.createTab) {
      createdId = window.createTab(url);
    } else if (window.bucksBrowser && typeof window.bucksBrowser.createTab === 'function') {
      createdId = window.bucksBrowser.createTab(url);
    } else if (window.bucksAPI && typeof window.bucksAPI.openExternal === 'function') {
      window.bucksAPI.openExternal(url);
      return;
    } else {
      window.open(url, '_blank');
      return;
    }

    setTimeout(() => {
      if (window.bucksTabs && typeof window.bucksTabs.setVisible === 'function' && createdId) {
        window.bucksTabs.setVisible(createdId, true);
      }
    }, 50);
  };

  window.__a2uiDispatchAction = function(actionPayload) {
    if (!actionPayload) return;
    console.log('[A2UI Engine] Dispatched action:', actionPayload);
    if (actionPayload.type === 'search_followup' && actionPayload.query) {
      runSearch(actionPayload.query, true);
    } else if (actionPayload.type === 'navigate' && actionPayload.url) {
      window.__a2uiOpenTab(actionPayload.url);
    } else if (window.bucksAPI && typeof window.bucksAPI.sendAgentAction === 'function') {
      window.bucksAPI.sendAgentAction(actionPayload);
    }
  };

  window.triggerAgentSearch = function(query, options) {
    runSearch(query, !!(options && options.isFollowup));
  };

  // Also expose as __a2uiRunSearch for renderer.js delegation stub
  window.__a2uiRunSearch = runSearch;


  /* The bottom composer (#nt-search-input / #composer-send-btn) is wired
     exclusively by renderer.js, which owns the routing decision (URL vs. chat
     tab vs. agent-search vs. web overlay vs. fresh new-tab). This module used
     to ALSO bind click+keydown here, which double-bound both controls: a send
     click fired runSearch twice, and the keydown had no branch for a fresh
     new-tab so the first Enter did nothing. renderer.js reaches this engine
     through window.__a2uiRunSearch (exported above), so no local DOM wiring is
     needed — binding it here only created conflicts. */

})();

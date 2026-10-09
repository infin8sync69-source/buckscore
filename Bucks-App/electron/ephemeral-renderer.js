/* ephemeral-renderer.js — Universal Desktop Companion HUD
 * Supports multi-turn conversations, rich markdown (tables, code copy, headings),
 * window pinning (always-on-top across apps), layout modes (Card / Dock),
 * and continuing into the main browser window.
 */

(function () {
  const SOUL_ENGINE = 'http://127.0.0.1:8765';

  const input          = document.getElementById('hud-input');
  const btnSend        = document.getElementById('btn-send');
  const messagesEl     = document.getElementById('hud-messages');
  const chipsContainer = document.getElementById('chips-container');
  const btnPin         = document.getElementById('btn-pin');
  const pinLabel       = document.getElementById('pin-label');
  const btnModeCard    = document.getElementById('btn-mode-card');
  const btnModeDock    = document.getElementById('btn-mode-dock');
  const btnNewChat     = document.getElementById('btn-new-chat');
  const btnOpenBrowser = document.getElementById('btn-open-browser');
  const btnMinimize    = document.getElementById('btn-minimize');

  let isPinned = false;
  let currentMode = 'card';
  let conversationHistory = [];
  let streaming = false;
  let abortCtrl = null;

  // ── Code Block Copy Handler ──
  window.copyAgentCode = function (btn) {
    if (!btn) return;
    const block = btn.closest('.nx-code-block');
    const code = block?.querySelector('code')?.innerText || '';
    navigator.clipboard.writeText(code).then(() => {
      const orig = btn.innerText;
      btn.innerText = '✓ Copied';
      btn.style.color = '#2ed573';
      setTimeout(() => {
        btn.innerText = orig;
        btn.style.color = '';
      }, 2000);
    }).catch(() => {});
  };

  // ── Escape HTML helper ──
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Markdown Parser ──
  function renderMarkdown(rawText) {
    if (!rawText) return { html: '', followups: [] };

    let text = rawText;
    let followups = [];

    // Extract <followup>...</followup>
    const followupRegex = /<followup>([\s\S]*?)<\/followup>/gi;
    let fm;
    while ((fm = followupRegex.exec(text)) !== null) {
      followups.push(fm[1].trim());
    }
    text = text.replace(followupRegex, '');

    // Protect code blocks
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || 'code', code });
      return `___CODE_BLOCK_${idx}___`;
    });

    // Protect inline code
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (match, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(code);
      return `___INLINE_CODE_${idx}___`;
    });

    let formatted = escapeHtml(text);

    // Strip unclosed tags
    formatted = formatted.replace(/&lt;followup&gt;[\s\S]*/gi, '');

    // Tables
    formatted = formatted.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableMatch) => {
      const lines = tableMatch.trim().split(/\r?\n/).filter(l => l.trim().startsWith('|'));
      if (lines.length < 2) return tableMatch;
      let headerLine = lines[0];
      let delimiterLine = lines[1];
      if (!delimiterLine.includes('---') && !delimiterLine.includes('--')) return tableMatch;

      const parseCells = (line) => line.split('|').map(c => c.trim()).filter((c, i, arr) => i > 0 && i < arr.length - 1);
      const headers = parseCells(headerLine);
      const rows = lines.slice(2).map(parseCells);

      let tableHtml = '<div class="nx-table-wrap"><table class="nx-table"><thead><tr>';
      headers.forEach(h => { tableHtml += `<th>${h}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      rows.forEach(r => {
        tableHtml += '<tr>';
        r.forEach(cell => { tableHtml += `<td>${cell}</td>`; });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table></div>';
      return tableHtml;
    });

    // Headings
    formatted = formatted.replace(/^### (.*$)/gim, '<div style="font-weight:700; font-size:14px; margin:8px 0 4px; color:#fff;">$1</div>');
    formatted = formatted.replace(/^## (.*$)/gim, '<div style="font-weight:700; font-size:15px; margin:10px 0 4px; color:#fff;">$1</div>');
    formatted = formatted.replace(/^# (.*$)/gim, '<div style="font-weight:800; font-size:16px; margin:12px 0 6px; color:#fff;">$1</div>');

    // Blockquotes
    formatted = formatted.replace(/^> (.*$)/gim, '<blockquote class="nx-blockquote">$1</blockquote>');

    // Bold & Italics
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Restore inline code
    inlineCodes.forEach((code, idx) => {
      formatted = formatted.replace(new RegExp(`___INLINE_CODE_${idx}___`, 'g'), `<code class="nx-inline-code">${escapeHtml(code)}</code>`);
    });

    // Restore code blocks
    codeBlocks.forEach((b, idx) => {
      const blockHtml = `
        <div class="nx-code-block">
          <div class="nx-code-header">
            <span>${escapeHtml(b.lang)}</span>
            <button class="nx-code-copy" onclick="window.copyAgentCode(this)">Copy</button>
          </div>
          <pre class="nx-code-pre"><code>${escapeHtml(b.code)}</code></pre>
        </div>`;
      formatted = formatted.replace(new RegExp(`___CODE_BLOCK_${idx}___`, 'g'), blockHtml);
    });

    return { html: formatted, followups };
  }

  // ── Send Message ──
  async function submitQuery(queryText) {
    const q = (queryText || input.value || '').trim();
    if (!q || streaming) return;

    input.value = '';
    input.focus();

    // Ensure window is expanded to show answers
    if (window.ephemeralAPI?.resize) {
      window.ephemeralAPI.resize(760, 580);
    }

    // Append User Bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'msg-user';
    userBubble.textContent = q;
    messagesEl.appendChild(userBubble);

    conversationHistory.push({ role: 'user', content: q });

    // Append Agent Bubble
    const agentBubble = document.createElement('div');
    agentBubble.className = 'msg-agent';
    agentBubble.innerHTML = '<span class="streaming-text">Thinking…</span>';
    messagesEl.appendChild(agentBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    chipsContainer.style.display = 'none';
    chipsContainer.innerHTML = '';

    streaming = true;
    abortCtrl = new AbortController();
    let accumulated = '';

    try {
      const res = await fetch(`${SOUL_ENGINE}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          query: q,
          history: conversationHistory,
          stream: true,
          mode: 'ephemeral'
        }),
        signal: abortCtrl.signal
      });

      if (!res.ok) throw new Error(`Status ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') continue;

          let ev;
          try { ev = JSON.parse(raw); } catch (_) { continue; }

          const token = ev.token ?? ev.delta?.content ?? ev.choices?.[0]?.delta?.content ?? null;
          if (token) {
            accumulated += token;
            const parsed = renderMarkdown(accumulated);
            agentBubble.innerHTML = parsed.html + '<span class="streaming-text"></span>';
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      }

      // Finished stream
      streaming = false;
      abortCtrl = null;
      conversationHistory.push({ role: 'assistant', content: accumulated });

      const finalParsed = renderMarkdown(accumulated);
      agentBubble.innerHTML = finalParsed.html;

      // Render follow-ups if available
      if (finalParsed.followups.length > 0) {
        chipsContainer.innerHTML = '';
        finalParsed.followups.forEach(f => {
          const chip = document.createElement('button');
          chip.className = 'followup-chip';
          chip.textContent = f;
          chip.addEventListener('click', () => submitQuery(f));
          chipsContainer.appendChild(chip);
        });
        chipsContainer.style.display = 'flex';
      }

      messagesEl.scrollTop = messagesEl.scrollHeight;

    } catch (err) {
      if (err.name === 'AbortError') return;
      streaming = false;
      abortCtrl = null;

      agentBubble.innerHTML = `<span style="color:#ff6b6b;">Failed to connect to Soul Engine. Routing query to Bucks Main Browser…</span>`;
      setTimeout(() => {
        if (window.ephemeralAPI?.submitQuery) {
          window.ephemeralAPI.submitQuery(q);
        }
      }, 1000);
    }
  }

  // ── Event Bindings ──
  btnSend.addEventListener('click', () => submitQuery());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuery();
    }
  });

  // Pin Toggle (Always on top across apps)
  btnPin.addEventListener('click', () => {
    isPinned = !isPinned;
    btnPin.classList.toggle('active', isPinned);
    pinLabel.textContent = isPinned ? 'Pinned' : 'Pin';
    if (window.ephemeralAPI?.setPinned) {
      window.ephemeralAPI.setPinned(isPinned);
    }
  });

  // Mode Card (760x580)
  btnModeCard.addEventListener('click', () => {
    currentMode = 'card';
    btnModeCard.classList.add('active');
    btnModeDock.classList.remove('active');
    if (window.ephemeralAPI?.setMode) {
      window.ephemeralAPI.setMode('card');
    }
  });

  // Mode Dock (Side Snap)
  btnModeDock.addEventListener('click', () => {
    currentMode = 'dock';
    btnModeDock.classList.add('active');
    btnModeCard.classList.remove('active');
    if (window.ephemeralAPI?.setMode) {
      window.ephemeralAPI.setMode('dock');
    }
  });

  // New Chat (Cmd+N)
  function newChat() {
    conversationHistory = [];
    messagesEl.innerHTML = `
      <div class="msg-agent" style="color: rgba(255,255,255,0.7); font-size:12.5px;">
        ✦ <strong>New chat started.</strong> Ask any question, generate code, analyze data, or co-browse alongside any window.
      </div>
    `;
    chipsContainer.style.display = 'none';
    chipsContainer.innerHTML = '';
    input.value = '';
    input.focus();
  }
  btnNewChat.addEventListener('click', newChat);

  // Open in Main Browser
  btnOpenBrowser.addEventListener('click', () => {
    const last = conversationHistory[conversationHistory.length - 1];
    const q = last?.content || 'Open chat';
    if (window.ephemeralAPI?.submitQuery) {
      window.ephemeralAPI.submitQuery(q);
    }
  });

  // Minimize (Esc)
  btnMinimize.addEventListener('click', () => {
    if (window.ephemeralAPI?.hide) {
      window.ephemeralAPI.hide();
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (window.ephemeralAPI?.hide) window.ephemeralAPI.hide();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newChat();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      btnPin.click();
    }
  });

  // Focus input when invoked via Cmd+K
  if (window.ephemeralAPI?.onFocusInput) {
    window.ephemeralAPI.onFocusInput(() => {
      input.focus();
    });
  }

})();

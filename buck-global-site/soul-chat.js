/**
 * Soul Engine Chat Widget
 * Embed on any page with:
 *   <script src="/soul-chat.js" data-api="https://YOUR-BACKEND.fly.dev"></script>
 *
 * The `data-api` attribute sets the backend URL.
 * Falls back to window.SOUL_API_URL, then to a localhost default for dev.
 */
(function () {
  "use strict";

  /* ── Config ─────────────────────────────────────────────────────────────── */
  const currentScript =
    document.currentScript ||
    [...document.querySelectorAll("script")].find((s) =>
      s.src.includes("soul-chat")
    );

  const API_URL =
    (currentScript && currentScript.getAttribute("data-api")) ||
    window.SOUL_API_URL ||
    "http://localhost:8000";

  /* ── CSS ─────────────────────────────────────────────────────────────────── */
  const CSS = `
    :root {
      --sc-bg:        #08090c;
      --sc-surface:   #101218;
      --sc-surface2:  #161921;
      --sc-border:    #1f232c;
      --sc-text:      #eef0f4;
      --sc-dim:       #9aa1ad;
      --sc-accent:    #5eead4;
      --sc-accent-bg: #0e2f2b;
      --sc-user-bg:   #1a3b36;
      --sc-danger:    #f87171;
      --sc-radius:    16px;
      --sc-z:         9999;
      --sc-font:      -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    }

    #sc-bubble {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: var(--sc-z);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--sc-accent);
      box-shadow: 0 0 0 0 rgba(94,234,212,0.4);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      animation: sc-pulse 2.8s infinite;
    }
    #sc-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 8px 32px rgba(94,234,212,0.35);
    }
    #sc-bubble svg { display: block; }

    @keyframes sc-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(94,234,212,0.4); }
      50%       { box-shadow: 0 0 0 10px rgba(94,234,212,0); }
    }

    #sc-panel {
      position: fixed;
      bottom: 96px;
      right: 28px;
      z-index: var(--sc-z);
      width: 380px;
      max-width: calc(100vw - 40px);
      max-height: 600px;
      background: var(--sc-bg);
      border: 1px solid var(--sc-border);
      border-radius: var(--sc-radius);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 24px 80px rgba(0,0,0,0.6);
      font-family: var(--sc-font);
      transform: translateY(12px) scale(0.97);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.22s cubic-bezier(.4,0,.2,1),
                  opacity  0.22s cubic-bezier(.4,0,.2,1);
    }
    #sc-panel.sc-open {
      transform: translateY(0) scale(1);
      opacity: 1;
      pointer-events: all;
    }

    /* Header */
    #sc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px;
      border-bottom: 1px solid var(--sc-border);
      background: var(--sc-surface);
      flex-shrink: 0;
    }
    #sc-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sc-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--sc-accent);
      box-shadow: 0 0 8px rgba(94,234,212,0.7);
      flex-shrink: 0;
    }
    #sc-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--sc-text);
      letter-spacing: -0.01em;
    }
    #sc-subtitle {
      font-size: 11px;
      color: var(--sc-dim);
      margin-top: 1px;
    }
    #sc-close {
      background: none;
      border: none;
      color: var(--sc-dim);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s;
    }
    #sc-close:hover { color: var(--sc-text); background: var(--sc-border); }

    /* Messages */
    #sc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scrollbar-width: thin;
      scrollbar-color: var(--sc-border) transparent;
    }
    #sc-messages::-webkit-scrollbar { width: 4px; }
    #sc-messages::-webkit-scrollbar-thumb { background: var(--sc-border); border-radius: 4px; }

    /* Empty state */
    #sc-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 10px;
      color: var(--sc-dim);
      font-size: 13px;
      text-align: center;
      padding: 24px;
    }
    #sc-empty .sc-empty-icon {
      font-size: 32px;
      opacity: 0.5;
    }

    /* Message bubbles */
    .sc-msg {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .sc-msg.sc-user { flex-direction: row-reverse; }

    .sc-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .sc-msg.sc-bot .sc-avatar {
      background: var(--sc-accent-bg);
      border: 1px solid rgba(94,234,212,0.2);
      color: var(--sc-accent);
    }
    .sc-msg.sc-user .sc-avatar {
      background: var(--sc-user-bg);
      color: var(--sc-accent);
      font-size: 11px;
      font-weight: 700;
    }

    .sc-bubble-text {
      max-width: 78%;
      font-size: 13.5px;
      line-height: 1.55;
      padding: 10px 13px;
      border-radius: 12px;
    }
    .sc-msg.sc-bot .sc-bubble-text {
      background: var(--sc-surface);
      border: 1px solid var(--sc-border);
      color: var(--sc-text);
      border-top-left-radius: 4px;
    }
    .sc-msg.sc-user .sc-bubble-text {
      background: var(--sc-user-bg);
      border: 1px solid rgba(94,234,212,0.15);
      color: var(--sc-text);
      border-top-right-radius: 4px;
    }

    /* Citations */
    .sc-citations {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sc-citation-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--sc-accent);
      opacity: 0.7;
      margin-bottom: 2px;
    }
    .sc-citation {
      background: var(--sc-surface2);
      border: 1px solid var(--sc-border);
      border-left: 2px solid rgba(94,234,212,0.3);
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 11.5px;
      color: var(--sc-dim);
      line-height: 1.5;
    }
    .sc-citation-ref {
      font-size: 10px;
      color: var(--sc-accent);
      opacity: 0.6;
      margin-bottom: 3px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Quality indicator */
    .sc-meta {
      margin-top: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sc-quality-dots {
      display: flex;
      gap: 3px;
    }
    .sc-quality-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--sc-border);
    }
    .sc-quality-dot.lit { background: var(--sc-accent); }
    .sc-strategy {
      font-size: 10px;
      color: var(--sc-dim);
      opacity: 0.5;
    }

    /* Typing indicator */
    .sc-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 13px;
      background: var(--sc-surface);
      border: 1px solid var(--sc-border);
      border-radius: 12px;
      border-top-left-radius: 4px;
      width: fit-content;
    }
    .sc-typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--sc-dim);
      display: inline-block;
      animation: sc-bounce 1.2s infinite ease-in-out;
    }
    .sc-typing span:nth-child(2) { animation-delay: 0.2s; }
    .sc-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes sc-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40%            { transform: translateY(-5px); opacity: 1; }
    }

    /* Error bubble */
    .sc-error-text {
      color: var(--sc-danger);
      font-size: 12.5px;
    }

    /* Input area */
    #sc-input-area {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--sc-border);
      background: var(--sc-surface);
      flex-shrink: 0;
    }
    #sc-input {
      flex: 1;
      background: var(--sc-surface2);
      border: 1px solid var(--sc-border);
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 13.5px;
      font-family: var(--sc-font);
      color: var(--sc-text);
      outline: none;
      resize: none;
      line-height: 1.45;
      max-height: 100px;
      overflow-y: auto;
      transition: border-color 0.15s;
    }
    #sc-input::placeholder { color: var(--sc-dim); }
    #sc-input:focus { border-color: rgba(94,234,212,0.35); }

    #sc-send {
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      align-self: flex-end;
      border-radius: 10px;
      background: var(--sc-accent);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s, transform 0.1s;
    }
    #sc-send:hover { opacity: 0.88; }
    #sc-send:active { transform: scale(0.93); }
    #sc-send:disabled { opacity: 0.35; cursor: not-allowed; }
    #sc-send svg { display: block; }

    /* Footer note */
    #sc-footer {
      padding: 6px 16px 10px;
      text-align: center;
      font-size: 10.5px;
      color: var(--sc-dim);
      opacity: 0.45;
      background: var(--sc-surface);
      border-top: 1px solid var(--sc-border);
      flex-shrink: 0;
    }

    @media (max-width: 480px) {
      #sc-panel {
        bottom: 0;
        right: 0;
        left: 0;
        width: 100%;
        max-width: 100%;
        max-height: 85vh;
        border-radius: var(--sc-radius) var(--sc-radius) 0 0;
        border-left: none;
        border-right: none;
        border-bottom: none;
      }
      #sc-bubble {
        bottom: 20px;
        right: 20px;
      }
    }
  `;

  /* ── HTML ────────────────────────────────────────────────────────────────── */
  function buildHTML() {
    return `
      <style>${CSS}</style>

      <!-- Floating bubble -->
      <button id="sc-bubble" aria-label="Open Soul Engine chat" title="Soul Engine">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.03 2 11c0 2.63 1.2 5 3.18 6.68L4 22l4.46-1.49A10.16 10.16 0 0012 21c5.52 0 10-4.03 10-9S17.52 2 12 2z" fill="#08090c"/>
          <circle cx="8.5" cy="11" r="1.2" fill="#5eead4"/>
          <circle cx="12"  cy="11" r="1.2" fill="#5eead4"/>
          <circle cx="15.5" cy="11" r="1.2" fill="#5eead4"/>
        </svg>
      </button>

      <!-- Chat panel -->
      <div id="sc-panel" role="dialog" aria-label="Soul Engine" aria-modal="true">
        <div id="sc-header">
          <div id="sc-header-left">
            <div class="sc-dot"></div>
            <div>
              <div id="sc-title">Soul Engine</div>
              <div id="sc-subtitle">Ancient wisdom, intelligent answers</div>
            </div>
          </div>
          <button id="sc-close" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div id="sc-messages">
          <div id="sc-empty">
            <div class="sc-empty-icon">✦</div>
            <div>Ask anything — wisdom from an ancient corpus of human knowledge, answered intelligently.</div>
          </div>
        </div>

        <div id="sc-input-area">
          <textarea
            id="sc-input"
            rows="1"
            placeholder="Ask anything…"
            maxlength="500"
            aria-label="Your question"
          ></textarea>
          <button id="sc-send" aria-label="Send" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8h12M9 4l5 4-5 4" stroke="#08090c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div id="sc-footer">Proprietary neural architecture · Soul of the World corpus</div>
      </div>
    `;
  }

  /* ── State ───────────────────────────────────────────────────────────────── */
  let isOpen    = false;
  let isLoading = false;

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function qualityDots(score) {
    // Map 0–1 score to 1–5 lit dots
    const lit = Math.max(1, Math.round(score * 5));
    let html = "";
    for (let i = 1; i <= 5; i++) {
      html += `<span class="sc-quality-dot${i <= lit ? " lit" : ""}"></span>`;
    }
    return html;
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  }

  function scrollToBottom() {
    const msgs = document.getElementById("sc-messages");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  /* ── Render message ──────────────────────────────────────────────────────── */
  function appendMessage({ role, text, citations, quality, strategy, error }) {
    const msgs    = document.getElementById("sc-messages");
    const empty   = document.getElementById("sc-empty");
    if (empty) empty.remove();

    const wrap = document.createElement("div");
    wrap.className = `sc-msg sc-${role}`;

    // Avatar
    const av = document.createElement("div");
    av.className = "sc-avatar";
    av.textContent = role === "bot" ? "✦" : "Me";
    wrap.appendChild(av);

    // Bubble
    const bubble = document.createElement("div");
    bubble.className = "sc-bubble-text";

    if (error) {
      bubble.innerHTML = `<span class="sc-error-text">${escapeHTML(text)}</span>`;
    } else {
      // Main text — preserve newlines
      const p = document.createElement("div");
      p.style.whiteSpace = "pre-wrap";
      p.textContent = text;
      bubble.appendChild(p);

      // Citations (bot only)
      if (role === "bot" && citations && citations.length > 0) {
        const citWrap = document.createElement("div");
        citWrap.className = "sc-citations";

        const lbl = document.createElement("div");
        lbl.className = "sc-citation-label";
        lbl.textContent = "From the corpus:";
        citWrap.appendChild(lbl);

        citations.forEach((c) => {
          const cit = document.createElement("div");
          cit.className = "sc-citation";
          cit.innerHTML = `<div class="sc-citation-ref">${escapeHTML(c.label)}</div>${escapeHTML(c.excerpt)}`;
          citWrap.appendChild(cit);
        });
        bubble.appendChild(citWrap);
      }

      // Quality + strategy (bot only)
      if (role === "bot" && typeof quality === "number") {
        const meta = document.createElement("div");
        meta.className = "sc-meta";
        meta.innerHTML = `
          <div class="sc-quality-dots">${qualityDots(quality)}</div>
          <span class="sc-strategy">${escapeHTML(strategy || "")}</span>
        `;
        bubble.appendChild(meta);
      }
    }

    wrap.appendChild(bubble);
    msgs.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  /* ── Typing indicator ────────────────────────────────────────────────────── */
  function showTyping() {
    const msgs  = document.getElementById("sc-messages");
    const empty = document.getElementById("sc-empty");
    if (empty) empty.remove();

    const wrap = document.createElement("div");
    wrap.className = "sc-msg sc-bot";
    wrap.id = "sc-typing-msg";

    const av = document.createElement("div");
    av.className = "sc-avatar";
    av.textContent = "✦";
    wrap.appendChild(av);

    const t = document.createElement("div");
    t.className = "sc-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    wrap.appendChild(t);

    msgs.appendChild(wrap);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById("sc-typing-msg");
    if (el) el.remove();
  }

  /* ── Send ────────────────────────────────────────────────────────────────── */
  async function send() {
    if (isLoading) return;

    const input = document.getElementById("sc-input");
    const sendBtn = document.getElementById("sc-send");
    const query = (input.value || "").trim();
    if (!query) return;

    input.value = "";
    autoResize(input);
    sendBtn.disabled = true;
    isLoading = true;

    appendMessage({ role: "user", text: query });
    showTyping();

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      hideTyping();

      if (!res.ok) {
        let detail = `Error ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch (_) {}
        if (res.status === 429) detail = "Too many requests — please wait a moment.";
        appendMessage({ role: "bot", text: detail, error: true });
      } else {
        const data = await res.json();
        appendMessage({
          role:      "bot",
          text:      data.response,
          citations: data.citations,
          quality:   data.quality,
          strategy:  data.strategy,
        });
      }
    } catch (err) {
      hideTyping();
      appendMessage({
        role:  "bot",
        text:  "Could not reach the Soul Engine. Please try again shortly.",
        error: true,
      });
      console.error("[soul-chat]", err);
    }

    isLoading = false;
    sendBtn.disabled = input.value.trim().length === 0;
    input.focus();
  }

  /* ── Toggle panel ────────────────────────────────────────────────────────── */
  function openPanel() {
    const panel = document.getElementById("sc-panel");
    panel.classList.add("sc-open");
    isOpen = true;
    document.getElementById("sc-input").focus();
  }

  function closePanel() {
    const panel = document.getElementById("sc-panel");
    panel.classList.remove("sc-open");
    isOpen = false;
  }

  /* ── Init ────────────────────────────────────────────────────────────────── */
  function init() {
    // Inject HTML
    const host = document.createElement("div");
    host.id = "soul-chat-root";
    host.innerHTML = buildHTML();
    document.body.appendChild(host);

    // Wire events
    document.getElementById("sc-bubble").addEventListener("click", () => {
      isOpen ? closePanel() : openPanel();
    });

    document.getElementById("sc-close").addEventListener("click", closePanel);

    const input   = document.getElementById("sc-input");
    const sendBtn = document.getElementById("sc-send");

    input.addEventListener("input", () => {
      autoResize(input);
      sendBtn.disabled = input.value.trim().length === 0;
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) send();
      }
    });

    sendBtn.addEventListener("click", send);

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) closePanel();
    });
  }

  // Boot after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

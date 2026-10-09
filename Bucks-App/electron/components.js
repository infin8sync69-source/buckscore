/**
 * Core Components - Implementation of 10 reusable UI components
 * Includes ChatBubble, ChatInput, ResponseCard, StatusIndicator, PeerIndicator,
 * IntentBadge, LoadingSkeleton, NotificationToast, TypingIndicator, CodeBlock
 */

// ============== ChatBubble Component ==============
class ChatBubble {
  constructor(props = {}) {
    this.message = props.message || '';
    this.sender = props.sender || 'user';
    this.timestamp = props.timestamp || Date.now();
    this.status = props.status || 'sent';
    this.theme = props.theme || 'light';
    this.animated = props.animated !== false;
    this.element = null;
  }

  render() {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble-${this.sender} status-${this.status}`;
    bubble.innerHTML = `
      <div class="chat-bubble-content">
        <p class="chat-bubble-text">${this.escapeHtml(this.message)}</p>
        <div class="chat-bubble-footer">
          <span class="chat-bubble-time">${this.formatTime()}</span>
          <span class="chat-bubble-status">${this.getStatusIcon()}</span>
        </div>
      </div>
    `;

    if (this.animated) {
      bubble.classList.add('animate-slide-in');
    }

    this.element = bubble;
    return bubble;
  }

  updateStatus(newStatus) {
    this.status = newStatus;
    if (this.element) {
      this.element.className = `chat-bubble chat-bubble-${this.sender} status-${this.status}`;
    }
  }

  formatTime() {
    const date = new Date(this.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getStatusIcon() {
    const icons = {
      'pending': '⏱',
      'sent': '✓',
      'verified': '✓✓',
      'error': '✕'
    };
    return icons[this.status] || '✓';
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// ============== ChatInput Component ==============
class ChatInput {
  constructor(props = {}) {
    this.placeholder = props.placeholder || 'Type a message...';
    this.value = props.value || '';
    this.disabled = props.disabled || false;
    this.theme = props.theme || 'light';
    this.formatting = props.formatting !== false;
    this.element = null;
    this.input = null;
    this.onSubmit = props.onSubmit || null;
  }

  render() {
    const container = document.createElement('div');
    container.className = 'chat-input-container';
    container.innerHTML = `
      <div class="chat-input-wrapper">
        ${this.formatting ? `<div class="chat-formatting-toolbar">
          <button class="format-btn" data-format="bold" title="Bold">B</button>
          <button class="format-btn" data-format="italic" title="Italic">I</button>
          <button class="format-btn" data-format="code" title="Code">&lt;/&gt;</button>
          <button class="format-btn" data-format="link" title="Link">🔗</button>
        </div>` : ''}
        <textarea
          class="chat-input-field"
          placeholder="${this.placeholder}"
          ${this.disabled ? 'disabled' : ''}
        >${this.value}</textarea>
        <div class="chat-input-actions">
          <button class="chat-input-send" ${this.disabled ? 'disabled' : ''}>Send</button>
          <button class="chat-input-attach">📎</button>
        </div>
      </div>
    `;

    this.element = container;
    this.input = container.querySelector('.chat-input-field');
    this.setupEventListeners();

    return container;
  }

  setupEventListeners() {
    if (!this.element) return;

    const sendBtn = this.element.querySelector('.chat-input-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.submit());
    }

    if (this.input) {
      this.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.submit();
        }
      });
    }

    const formatBtns = this.element.querySelectorAll('.format-btn');
    formatBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const format = btn.dataset.format;
        this.applyFormatting(format);
      });
    });
  }

  submit() {
    const value = this.getValue();
    if (value.trim() && this.onSubmit) {
      this.onSubmit(value);
      this.clear();
    }
  }

  getValue() {
    return this.input ? this.input.value : this.value;
  }

  setValue(text) {
    this.value = text;
    if (this.input) {
      this.input.value = text;
    }
  }

  clear() {
    this.value = '';
    if (this.input) {
      this.input.value = '';
    }
  }

  focus() {
    if (this.input) {
      this.input.focus();
    }
  }

  applyFormatting(format) {
    if (!this.input) return;

    const start = this.input.selectionStart;
    const end = this.input.selectionEnd;
    const text = this.input.value;
    const selected = text.substring(start, end);

    let formatted = '';
    switch (format) {
      case 'bold':
        formatted = `**${selected}**`;
        break;
      case 'italic':
        formatted = `*${selected}*`;
        break;
      case 'code':
        formatted = `\`${selected}\``;
        break;
      case 'link':
        formatted = `[${selected}](url)`;
        break;
    }

    this.input.value = text.substring(0, start) + formatted + text.substring(end);
    this.value = this.input.value;
  }
}

// ============== ResponseCard Component ==============
class ResponseCard {
  constructor(props = {}) {
    this.title = props.title || '';
    this.content = props.content || '';
    this.format = props.format || 'markdown';
    this.actions = props.actions || [];
    this.theme = props.theme || 'light';
    this.element = null;
  }

  render() {
    const card = document.createElement('div');
    card.className = `response-card response-card-${this.format}`;
    card.innerHTML = `
      <div class="response-card-header">
        <h3 class="response-card-title">${this.escapeHtml(this.title)}</h3>
      </div>
      <div class="response-card-body">
        <div class="response-card-content">${this.formatContent()}</div>
      </div>
      ${this.actions.length > 0 ? `<div class="response-card-actions">
        ${this.actions.map((action, i) =>
          `<button class="response-card-action" data-action="${i}">${this.escapeHtml(action.label)}</button>`
        ).join('')}
      </div>` : ''}
    `;

    this.element = card;
    this.setupActions();
    return card;
  }

  formatContent() {
    if (this.format === 'code') {
      return `<pre><code>${this.escapeHtml(this.content)}</code></pre>`;
    }
    if (this.format === 'json') {
      try {
        const json = JSON.parse(this.content);
        return `<pre>${this.escapeHtml(JSON.stringify(json, null, 2))}</pre>`;
      } catch (e) {
        return `<pre>${this.escapeHtml(this.content)}</pre>`;
      }
    }
    return `<p>${this.content}</p>`;
  }

  setupActions() {
    if (!this.element) return;
    const buttons = this.element.querySelectorAll('[data-action]');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.action);
        if (this.actions[index] && this.actions[index].onClick) {
          this.actions[index].onClick();
        }
      });
    });
  }

  updateContent(newContent) {
    this.content = newContent;
    if (this.element) {
      const bodyDiv = this.element.querySelector('.response-card-content');
      if (bodyDiv) {
        bodyDiv.innerHTML = this.formatContent();
      }
    }
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// ============== StatusIndicator Component ==============
class StatusIndicator {
  constructor(props = {}) {
    this.status = props.status || 'idle';
    this.label = props.label || '';
    this.animated = props.animated !== false;
    this.size = props.size || 'medium';
    this.element = null;
  }

  render() {
    const container = document.createElement('div');
    container.className = `status-indicator status-${this.status} size-${this.size}`;
    container.innerHTML = `
      <div class="status-dot ${this.animated ? 'animated' : ''}"></div>
      ${this.label ? `<span class="status-label">${this.label}</span>` : ''}
    `;
    this.element = container;
    return container;
  }

  updateStatus(newStatus) {
    this.status = newStatus;
    if (this.element) {
      this.element.className = `status-indicator status-${this.status} size-${this.size}`;
    }
  }

  setLabel(newLabel) {
    this.label = newLabel;
    if (this.element) {
      const label = this.element.querySelector('.status-label');
      if (label) {
        label.textContent = newLabel;
      }
    }
  }
}

// ============== PeerIndicator Component ==============
class PeerIndicator {
  constructor(props = {}) {
    this.peerId = props.peerId || '';
    this.name = props.name || 'Peer';
    this.avatar = props.avatar || null;
    this.status = props.status || 'offline';
    this.size = props.size || 'medium';
    this.element = null;
  }

  render() {
    const container = document.createElement('div');
    container.className = `peer-indicator size-${this.size}`;
    container.innerHTML = `
      <div class="peer-avatar ${this.avatar ? 'with-image' : 'initials'}">
        ${this.avatar ? `<img src="${this.avatar}" alt="${this.name}">` : this.getInitials()}
      </div>
      <div class="peer-info">
        <div class="peer-name">${this.name}</div>
        <div class="peer-status status-${this.status}"></div>
      </div>
    `;
    this.element = container;
    return container;
  }

  getInitials() {
    return this.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  setStatus(newStatus) {
    this.status = newStatus;
    if (this.element) {
      const statusDiv = this.element.querySelector('.peer-status');
      if (statusDiv) {
        statusDiv.className = `peer-status status-${this.status}`;
      }
    }
  }

  updateAvatar(newAvatar) {
    this.avatar = newAvatar;
    if (this.element) {
      const avatarDiv = this.element.querySelector('.peer-avatar');
      if (avatarDiv) {
        avatarDiv.innerHTML = newAvatar
          ? `<img src="${newAvatar}" alt="${this.name}">`
          : this.getInitials();
      }
    }
  }
}

// ============== IntentBadge Component ==============
class IntentBadge {
  constructor(props = {}) {
    this.intent = props.intent || 'general';
    this.confidence = props.confidence || 0.85;
    this.clickable = props.clickable !== false;
    this.theme = props.theme || 'light';
    this.element = null;
    this.onClick = props.onClick || null;
  }

  render() {
    const badge = document.createElement('div');
    badge.className = `intent-badge intent-${this.intent} ${this.clickable ? 'clickable' : ''}`;
    badge.innerHTML = `
      <span class="intent-name">${this.intent}</span>
      <span class="intent-confidence">${Math.round(this.confidence * 100)}%</span>
    `;

    if (this.clickable) {
      badge.addEventListener('click', () => {
        if (this.onClick) this.onClick(this.intent);
      });
    }

    this.element = badge;
    return badge;
  }

  updateIntent(newIntent) {
    this.intent = newIntent;
    if (this.element) {
      this.element.className = `intent-badge intent-${this.intent} ${this.clickable ? 'clickable' : ''}`;
    }
  }

  setConfidence(newConfidence) {
    this.confidence = Math.min(1, Math.max(0, newConfidence));
    if (this.element) {
      const confSpan = this.element.querySelector('.intent-confidence');
      if (confSpan) {
        confSpan.textContent = `${Math.round(this.confidence * 100)}%`;
      }
    }
  }
}

// ============== LoadingSkeleton Component ==============
class LoadingSkeleton {
  constructor(props = {}) {
    this.type = props.type || 'text';
    this.count = props.count || 3;
    this.animated = props.animated !== false;
    this.theme = props.theme || 'light';
    this.element = null;
  }

  render() {
    const container = document.createElement('div');
    container.className = 'loading-skeleton';

    for (let i = 0; i < this.count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = `skeleton-item skeleton-${this.type} ${this.animated ? 'shimmer' : ''}`;

      switch (this.type) {
        case 'text':
          skeleton.style.height = '12px';
          skeleton.style.marginBottom = '8px';
          break;
        case 'avatar':
          skeleton.style.width = '40px';
          skeleton.style.height = '40px';
          skeleton.borderRadius = '50%';
          break;
        case 'card':
          skeleton.style.height = '200px';
          skeleton.style.marginBottom = '16px';
          break;
      }

      container.appendChild(skeleton);
    }

    this.element = container;
    return container;
  }

  stop() {
    if (this.element) {
      this.element.remove();
    }
  }
}

// ============== NotificationToast Component ==============
class NotificationToast {
  constructor(props = {}) {
    this.message = props.message || '';
    this.type = props.type || 'info';
    this.duration = props.duration || 3000;
    this.actions = props.actions || [];
    this.element = null;
    this.timeoutId = null;
  }

  show() {
    const toast = document.createElement('div');
    toast.className = `notification-toast toast-${this.type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-message">${this.escapeHtml(this.message)}</span>
        ${this.actions.length > 0 ? `<div class="toast-actions">
          ${this.actions.map((action, i) =>
            `<button class="toast-action" data-action="${i}">${this.escapeHtml(action.label)}</button>`
          ).join('')}
        </div>` : ''}
      </div>
      <button class="toast-close">✕</button>
    `;

    document.body.appendChild(toast);
    this.element = toast;

    toast.querySelector('.toast-close').addEventListener('click', () => this.hide());

    this.actions.forEach((action, i) => {
      const btn = toast.querySelector(`[data-action="${i}"]`);
      if (btn) {
        btn.addEventListener('click', () => {
          if (action.onClick) action.onClick();
          this.hide();
        });
      }
    });

    if (this.duration > 0) {
      this.timeoutId = setTimeout(() => this.hide(), this.duration);
    }

    return toast;
  }

  hide() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }

  update(newMessage) {
    this.message = newMessage;
    if (this.element) {
      const msgSpan = this.element.querySelector('.toast-message');
      if (msgSpan) {
        msgSpan.textContent = newMessage;
      }
    }
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// ============== TypingIndicator Component ==============
class TypingIndicator {
  constructor(props = {}) {
    this.animated = props.animated !== false;
    this.color = props.color || '#999';
    this.size = props.size || 'medium';
    this.element = null;
  }

  render() {
    const container = document.createElement('div');
    container.className = `typing-indicator size-${this.size}`;
    container.innerHTML = `
      <span class="typing-dot" style="background-color: ${this.color}"></span>
      <span class="typing-dot" style="background-color: ${this.color}"></span>
      <span class="typing-dot" style="background-color: ${this.color}"></span>
    `;

    if (this.animated) {
      container.classList.add('animated');
    }

    this.element = container;
    return container;
  }

  start() {
    if (this.element) {
      this.element.classList.add('animated');
    }
  }

  stop() {
    if (this.element) {
      this.element.classList.remove('animated');
    }
  }
}

// ============== CodeBlock Component ==============
class CodeBlock {
  constructor(props = {}) {
    this.code = props.code || '';
    this.language = props.language || 'javascript';
    this.showLineNumbers = props.showLineNumbers !== false;
    this.copyable = props.copyable !== false;
    this.element = null;
  }

  render() {
    const container = document.createElement('div');
    container.className = `code-block language-${this.language}`;
    container.innerHTML = `
      <div class="code-block-header">
        <span class="code-language">${this.language}</span>
        ${this.copyable ? '<button class="code-copy">Copy</button>' : ''}
      </div>
      <pre><code>${this.escapeHtml(this.code)}</code></pre>
    `;

    if (this.copyable) {
      const copyBtn = container.querySelector('.code-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => this.copyToClipboard());
      }
    }

    this.element = container;
    return container;
  }

  copyToClipboard() {
    navigator.clipboard.writeText(this.code).then(() => {
      const copyBtn = this.element.querySelector('.code-copy');
      if (copyBtn) {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = original;
        }, 2000);
      }
    });
  }

  updateCode(newCode) {
    this.code = newCode;
    if (this.element) {
      const codeEl = this.element.querySelector('code');
      if (codeEl) {
        codeEl.textContent = newCode;
      }
    }
  }

  setLanguage(newLanguage) {
    this.language = newLanguage;
    if (this.element) {
      this.element.className = `code-block language-${this.language}`;
      const langSpan = this.element.querySelector('.code-language');
      if (langSpan) {
        langSpan.textContent = newLanguage;
      }
    }
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// Export components
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ChatBubble,
    ChatInput,
    ResponseCard,
    StatusIndicator,
    PeerIndicator,
    IntentBadge,
    LoadingSkeleton,
    NotificationToast,
    TypingIndicator,
    CodeBlock
  };
}

if (typeof export !== 'undefined') {
  export {
    ChatBubble,
    ChatInput,
    ResponseCard,
    StatusIndicator,
    PeerIndicator,
    IntentBadge,
    LoadingSkeleton,
    NotificationToast,
    TypingIndicator,
    CodeBlock
  };
}

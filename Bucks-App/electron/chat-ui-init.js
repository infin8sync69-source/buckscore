/**
 * CHAT UI INITIALIZATION
 *
 * Initializes the redesigned chat interface and connects it to the backend.
 * Bridges the gap between the chat-engine backend and the UI layer.
 */

class ChatUIInitializer {
  constructor() {
    this.chatPanel = null;
    this.messageList = null;
    this.inputBox = null;
    this.isReady = false;
  }

  /**
   * Initialize the chat UI with new styling
   */
  async init() {
    console.log('[ChatUI] Initializing chat interface...');

    // 1. Ensure chat-styles.css is loaded
    this.ensureStylesheet();

    // 2. Find or create chat panel elements
    this.setupChatPanel();

    // 3. Attach event listeners
    this.attachEventListeners();

    // 4. Connect to backend
    this.connectToBackend();

    this.isReady = true;
    console.log('[ChatUI] ✓ Chat interface initialized');
  }

  /**
   * Ensure chat-styles.css is loaded
   */
  ensureStylesheet() {
    // Check if chat-styles.css is already loaded
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .some(link => link.href.includes('chat-styles.css'));

    if (!existing) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'chat-styles.css';
      document.head.appendChild(link);
      console.log('[ChatUI] ✓ Loaded chat-styles.css');
    }
  }

  /**
   * Setup or enhance the chat panel with new classes
   */
  setupChatPanel() {
    // Find existing chat panel
    this.chatPanel = document.getElementById('nav-chat-panel');
    if (!this.chatPanel) {
      console.warn('[ChatUI] Chat panel not found, creating...');
      this.createChatPanel();
      return;
    }

    // Apply new CSS classes to existing panel
    this.chatPanel.classList.add('chat-panel');

    // Find or create message list
    this.messageList = this.chatPanel.querySelector('.nav-chat-messages-container');
    if (this.messageList) {
      this.messageList.classList.add('chat-message-list');
    }

    // Find or create input area
    this.inputBox = this.chatPanel.querySelector('.nav-chat-composer');
    if (!this.inputBox) {
      this.createInputArea();
    } else {
      this.inputBox.classList.add('chat-input-box');
    }

    console.log('[ChatUI] ✓ Chat panel setup complete');
  }

  /**
   * Create chat panel from scratch if it doesn't exist
   */
  createChatPanel() {
    this.chatPanel = document.createElement('div');
    this.chatPanel.id = 'nav-chat-panel';
    this.chatPanel.className = 'chat-panel glass-panel glass-panel--sheet';
    this.chatPanel.style.cssText = `
      width: 100%;
      height: 500px;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
    `;

    // Header
    const header = document.createElement('div');
    header.className = 'chat-panel-header';
    header.innerHTML = `
      <div>
        <h3 class="chat-panel-header-title">Messages</h3>
        <p class="chat-panel-header-subtitle">End-to-end encrypted</p>
      </div>
      <div class="chat-encryption-badge">
        🔒 Encrypted
      </div>
    `;

    // Message list
    this.messageList = document.createElement('div');
    this.messageList.className = 'chat-message-list';
    this.messageList.innerHTML = `
      <div class="chat-bubble chat-bubble--system">
        Chat interface initialized. Ready to send messages.
      </div>
    `;

    // Input area
    this.inputBox = document.createElement('div');
    this.inputBox.className = 'chat-input-box';
    this.inputBox.innerHTML = `
      <div class="chat-composer">
        <input
          type="text"
          class="chat-composer-input"
          placeholder="Type your message..."
          id="chat-input"
        >
        <button class="chat-composer-btn chat-send-btn" id="chat-send-btn" title="Send (Shift+Enter for newline)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      <div class="chat-formatting-toolbar" style="display: none;">
        <button class="chat-format-btn" data-format="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
        <button class="chat-format-btn" data-format="code" title="Code (Ctrl+~)"><code>\`</code></button>
        <button class="chat-format-btn" data-format="link" title="Link (Ctrl+K)">🔗</button>
      </div>
    `;

    this.chatPanel.appendChild(header);
    this.chatPanel.appendChild(this.messageList);
    this.chatPanel.appendChild(this.inputBox);

    // Add to DOM
    const container = document.querySelector('.main-content-wrapper');
    if (container) {
      container.appendChild(this.chatPanel);
    }

    console.log('[ChatUI] ✓ Created new chat panel');
  }

  /**
   * Create input area if it doesn't exist
   */
  createInputArea() {
    this.inputBox = document.createElement('div');
    this.inputBox.className = 'chat-input-box';
    this.inputBox.innerHTML = `
      <div class="chat-composer">
        <input
          type="text"
          class="chat-composer-input"
          placeholder="Type your message..."
          id="chat-input"
        >
        <button class="chat-composer-btn chat-send-btn" id="chat-send-btn">
          Send
        </button>
      </div>
    `;

    this.chatPanel.appendChild(this.inputBox);
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');

    if (input && sendBtn) {
      // Send on button click
      sendBtn.addEventListener('click', () => this.sendMessage(input.value, input));

      // Send on Enter key (Shift+Enter for newline)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage(input.value, input);
        }
      });

      console.log('[ChatUI] ✓ Event listeners attached');
    }
  }

  /**
   * Send a message
   */
  async sendMessage(text, inputElement) {
    if (!text.trim()) return;

    // Add user message to UI
    this.addMessageBubble(text, 'user');

    // Clear input
    inputElement.value = '';

    // Simulate AI response (replace with real backend call)
    await new Promise(resolve => setTimeout(resolve, 500));

    const response = `[AI Response] Thank you for: "${text.substring(0, 50)}..."`;
    this.addMessageBubble(response, 'peer');

    console.log('[ChatUI] Message sent:', text);
  }

  /**
   * Add a message bubble to the list
   */
  addMessageBubble(text, type = 'user') {
    if (!this.messageList) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble--${type}`;
    bubble.innerHTML = `
      <div class="chat-bubble-content">
        <div class="chat-text">${this.escapeHtml(text)}</div>
      </div>
      <div class="chat-message-footer">
        <span class="chat-timestamp">${this.getTime()}</span>
        ${type === 'user' ? '<span class="chat-status-indicator chat-status-verified">✓ Sent</span>' : ''}
      </div>
    `;

    this.messageList.appendChild(bubble);

    // Scroll to bottom
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  /**
   * Helper: Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Helper: Get current time formatted
   */
  getTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Connect to chat backend (placeholder for real integration)
   */
  connectToBackend() {
    // This will be connected to actual chat-engine.js in Phase 4
    console.log('[ChatUI] Backend connection setup (ready for integration)');

    // Listen for incoming messages (if backend provides them)
    if (window.bucksAPI && window.bucksAPI.onChatMessage) {
      window.bucksAPI.onChatMessage((message) => {
        this.addMessageBubble(message.text, 'peer');
      });
    }
  }

  /**
   * Show/hide chat panel
   */
  togglePanel(show = true) {
    if (this.chatPanel) {
      this.chatPanel.classList.toggle('hidden', !show);
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.chatUI = new ChatUIInitializer();
    window.chatUI.init().catch(console.error);
  });
} else {
  window.chatUI = new ChatUIInitializer();
  window.chatUI.init().catch(console.error);
}

module.exports = { ChatUIInitializer };

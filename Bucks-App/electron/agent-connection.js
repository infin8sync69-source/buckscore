/**
 * AGENT CONNECTION
 *
 * Bridges Electron frontend with soul_engine backend.
 * Handles streaming responses, error management, and UI updates.
 */

class AgentConnection {
  constructor() {
    this.baseUrl = 'http://127.0.0.1:8765';
    this.isConnected = false;
    this.currentSession = null;
    this.responseCallbacks = new Map();
  }

  /**
   * Check agent health
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
      if (response.ok) {
        this.isConnected = true;
        const data = await response.json();
        console.log('[Agent] Connected:', data);
        return { ok: true, status: data };
      }
    } catch (err) {
      console.error('[Agent] Connection failed:', err.message, err.stack);
      this.isConnected = false;
    }
    return { ok: false };
  }

  /**
   * Get agent status
   */
  async getStatus() {
    try {
      const response = await fetch(`${this.baseUrl}/agent/status`);
      return await response.json();
    } catch (err) {
      console.error('[Agent] Status check failed:', err);
      return null;
    }
  }

  /**
   * Send message and stream response
   */
  async chat(message, sessionId, onToken, onDone, onError) {
    if (!this.isConnected) {
      await this.checkHealth();
      if (!this.isConnected) {
        onError('Agent not connected');
        return;
      }
    }

    this.currentSession = sessionId;

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          message: message,
          session_id: sessionId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(line.slice(6));

            if (json.type === 'token') {
              const token = json.content || '';
              fullResponse += token;
              onToken(token);
            } else if (json.type === 'done') {
              onDone(fullResponse);
            } else if (json.type === 'error') {
              onError(json.content || 'Unknown error');
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }

      // Ensure done callback fires
      if (fullResponse.length > 0) {
        onDone(fullResponse);
      }
    } catch (err) {
      console.error('[Agent] Chat error:', err);
      onError(err.message);
    }
  }

  /**
   * Classify query intent
   */
  async classifyIntent(message) {
    try {
      const response = await fetch(`${this.baseUrl}/router/classify?query=${encodeURIComponent(message)}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
      return await response.json();
    } catch (err) {
      console.error('[Agent] Classification failed:', err);
      return { intent: 'unknown' };
    }
  }

  /**
   * Simple keyword-based intent for when backend fails
   */
  fallbackClassifyIntent(message) {
    const lower = message.toLowerCase();

    if (/what|who|when|where|why|how|tell|explain|describe/.test(lower)) {
      return { intent: 'question', confidence: 0.8 };
    } else if (/write|generate|create|compose|code/.test(lower)) {
      return { intent: 'generation', confidence: 0.8 };
    } else if (/search|find|look|locate/.test(lower)) {
      return { intent: 'search', confidence: 0.8 };
    } else if (/help|assist|guide|show/.test(lower)) {
      return { intent: 'assistance', confidence: 0.8 };
    }

    return { intent: 'general', confidence: 0.5 };
  }

  /**
   * Get selected model
   */
  async getSelectedModel() {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      const data = await response.json();
      return data.selected || data[0] || null;
    } catch (err) {
      console.error('[Agent] Model fetch failed:', err);
      return null;
    }
  }
}

// Global instance
window.agentConnection = new AgentConnection();

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await window.agentConnection.checkHealth();
  });
} else {
  window.agentConnection.checkHealth();
}

module.exports = { AgentConnection };

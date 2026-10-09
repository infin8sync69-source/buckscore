'use strict';

class SoulClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async health() {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`health check failed: HTTP ${res.status}`);
    return res.json();
  }

  async getOwnSoul() {
    const res = await fetch(`${this.baseUrl}/api/v1/soul`);
    return res.json();
  }

  async registerPeerSoul(soulManifest) {
    const res = await fetch(`${this.baseUrl}/api/v1/soul/peer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(soulManifest),
    });
    return res.json();
  }

  // Collects a full /chat SSE stream into plain text. Returns { text, tokenCount, ms }.
  async chat(message, { timeoutMs = 60000 } = {}) {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`chat HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let tokenCount = 0;
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'token') {
              text += evt.content || '';
              tokenCount++;
            } else if (evt.type === 'error') {
              throw new Error('agent stream error: ' + (evt.content || JSON.stringify(evt)));
            }
          } catch (e) {
            if (e.message.startsWith('agent stream error')) throw e;
            // non-JSON keepalive line, ignore
          }
        }
      }
      return { text, tokenCount, ms: Date.now() - start };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { SoulClient };

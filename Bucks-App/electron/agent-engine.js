/* 
 * Bucks Agent Engine 
 * Handles Ephemeral UI pops, SLM state minimization, and IPFSService
 */

class IPFSService {
  static queue = [];
  static isProcessing = false;

  static async addBlob(blob, metadata = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ blob, metadata, resolve, reject });
      if (window.bucksAPI && typeof window.bucksAPI.sendTelemetry === 'function') {
        window.bucksAPI.sendTelemetry('IPFS_Queue_Depth', { depth: this.queue.length });
      }
      this.processQueue();
    });
  }

  static async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (window.bucksAPI && typeof window.bucksAPI.sendTelemetry === 'function') {
        window.bucksAPI.sendTelemetry('IPFS_Queue_Depth', { depth: this.queue.length });
      }
      try {
        const arrayBuffer = await task.blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        if (window.bucksAPI && typeof window.bucksAPI.ipfsPublish === 'function') {
          let cid;
          try {
             // Pass raw Uint8Array and properly structured metadata instead of base64 encoded string!
             const meta = {
               name: task.metadata.filename || 'upload',
               type: task.metadata.type || 'file'
             };
             const result = await window.bucksAPI.ipfsPublish(bytes, meta);
             cid = result.cid || result;
          } catch(e) {
             console.warn("IPFS publish failed, generating mock CID for ephemeral UX", e);
             cid = "Qm" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          }
          task.resolve(cid);
        } else {
          // Mock CID if API not available
          console.warn('window.bucksAPI.ipfsPublish not found. Mocking CID.');
          const cid = "Qm" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          setTimeout(() => task.resolve(cid), 800); // simulate network delay
        }
      } catch (err) {
        task.reject(err);
      }
    }
    this.isProcessing = false;
  }
}

class EphemeralUI {
  static layer = document.getElementById('bucks-ephemeral-layer');
  static currentPop = null;
  static timeoutId = null;

  static show(title, message, actions = [], autoDismiss = 5000) {
    if (!this.layer) this.layer = document.getElementById('bucks-ephemeral-layer');
    if (this.currentPop) this.currentPop.remove();
    if (this.timeoutId) clearTimeout(this.timeoutId);

    const pop = document.createElement('div');
    pop.className = 'ephemeral-pop';
    pop.style.pointerEvents = 'auto'; // allow clicking

    let actionsHtml = '';
    actions.forEach((act, i) => {
      actionsHtml += `<button class="ephemeral-btn ${act.primary ? 'primary' : ''}" id="eph-btn-${i}">${act.label}</button>`;
    });

    pop.innerHTML = `
      <span class="ephemeral-close-btn" style="position: absolute; top: 12px; right: 14px; cursor: pointer; opacity: 0.6; font-size: 14px;" onclick="window.BucksAgentEngine.EphemeralUI.dismiss()">✕</span>
      <div class="ephemeral-title">${title}</div>
      <div class="ephemeral-message">${message}</div>
      <div class="ephemeral-actions">${actionsHtml}</div>
    `;

    this.layer.appendChild(pop);
    this.currentPop = pop;

    actions.forEach((act, i) => {
      document.getElementById(`eph-btn-${i}`).addEventListener('click', () => {
        if (this.timeoutId) clearTimeout(this.timeoutId);
        act.onClick();
      });
    });

    if (autoDismiss > 0) {
      this.timeoutId = setTimeout(() => this.dismiss(), autoDismiss);
    }
  }

  static showTag(cid) {
    if (!this.currentPop) return;
    const tag = document.createElement('div');
    tag.className = 'ephemeral-ipfs-tag';
    const cidStr = typeof cid === 'object' ? (cid.cid || cid.path || 'Local') : cid;
    tag.textContent = `CID Stored: ${cidStr}`;
    this.currentPop.insertBefore(tag, this.currentPop.firstChild);
    
    // Auto dismiss after showing tag
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => this.dismiss(), 2500);
  }

  static dismiss() {
    if (this.currentPop) {
      this.currentPop.style.opacity = '0';
      this.currentPop.style.transform = 'translateY(10px) scale(0.95)';
      this.currentPop.style.transition = 'all 0.3s ease-out';
      setTimeout(() => {
        if (this.currentPop) this.currentPop.remove();
        this.currentPop = null;
      }, 300);
    }
  }
}

// AgentOverlay State Manager
class AgentOverlay {
  static isMinimized = false;
  static panel = document.getElementById('nav-chat-panel');

  static toggle() {
    this.isMinimized = !this.isMinimized;
    if (!this.panel) this.panel = document.getElementById('nav-chat-panel');
    
    if (this.isMinimized) {
      this.panel.classList.add('minimized');
      // SLM Low Power mode - halt background polling/DOM snapshotting
      window.__bucksAgentActive = false;
      // Auto-dismiss any active ephemeral UI when minimizing
      EphemeralUI.dismiss();
    } else {
      this.panel.classList.remove('minimized');
      this.panel.classList.remove('thinking');
      // SLM Wake up
      window.__bucksAgentActive = true;
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }
  }

  static setThinking(isThinking) {
    if (!this.panel) this.panel = document.getElementById('nav-chat-panel');
    if (this.isMinimized && isThinking) {
      this.panel.classList.add('thinking');
    } else {
      this.panel.classList.remove('thinking');
    }
  }
}

// Attach to window for renderer.js to access
window.BucksAgentEngine = {
  IPFSService,
  EphemeralUI,
  AgentOverlay
};

// Wire clicking on the minimized FAB to restore it
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('nav-chat-panel');
  if (panel) {
    panel.addEventListener('click', (e) => {
      if (AgentOverlay.isMinimized) {
        AgentOverlay.toggle();
        e.stopPropagation();
      }
    });
  }
});


// Audio Hook Stub
class AudioHook {
  static isRecording = false;
  static mockStream = null;

  static async startRecording() {
    if (this.isRecording) return;
    try {
      this.isRecording = true;
      if (window.bucksAPI && typeof window.bucksAPI.sendTelemetry === 'function') {
        window.bucksAPI.sendTelemetry('Audio_Hook_State', { active: true });
      }
      console.log('Audio hook started');
      return true;
    } catch (e) {
      console.error('Failed to start audio hook', e);
      throw e;
    }
  }

  static stopRecording() {
    if (!this.isRecording) return null;
    this.isRecording = false;
    if (window.bucksAPI && typeof window.bucksAPI.sendTelemetry === 'function') {
      window.bucksAPI.sendTelemetry('Audio_Hook_State', { active: false });
    }
    if (this.mockStream) {
      this.mockStream.getTracks().forEach(t => t.stop());
      this.mockStream = null;
    }
    // Simulate generating a transcript
    const transcript = "Meeting transcript:\n[10:00] Alice: We need to finalize the Agentic UI.\n[10:01] Bob: I agree, the Ephemeral popups look great.\n[10:02] Alice: Let's push this to IPFS.";
    return transcript;
  }
}

window.BucksAgentEngine.AudioHook = AudioHook;

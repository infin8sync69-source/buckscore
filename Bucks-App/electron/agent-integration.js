/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   Agent Integration Bridge — LitAI Model Switching       ║
 * ║   Bridges Bucks Chat Engine to Agent Server               ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 * - Route chat messages to the Bucks Agent Server
 * - Support model switching between LitAI and Ollama
 * - Parse A2UI responses and return formatted results
 * - Maintain agent status and model availability
 */

const http = require("http");
const https = require("https");

// Configuration
// NOTE: this targets the same optional :3000 "agent server" that main.js
// only starts under BUCKS_EXPERIMENTAL_SWARM=1 (its own comment there calls
// it "unsigned, unaudited"). The real always-on agent is the Soul Engine on
// :8765 (soul-engine-supervisor.js) — this module and its "ollama" default
// are a separate, disabled-by-default code path, not what actually answers
// chat by default.
// Deliberately NOT the shared AGENT_SERVER_URL var (cluster-membership.js
// uses that one and defaults to :8765, the always-on Soul Engine) — see
// agent-swarm.js for the same reasoning.
const AGENT_SERVER_URL =
  process.env.BUCKS_SWARM_AGENT_SERVER_URL || "http://localhost:3000";
const REQUEST_TIMEOUT = 60000; // 60 seconds for agent tasks

// State
let currentModel = process.env.MODEL_PROVIDER || "ollama";
let agentStatus = {
  online: false,
  // "unavailable", not "ollama": nothing has actually been contacted yet, and
  // claiming a specific provider before any successful status check is
  // misleading (this file never actually calls Ollama's API either way).
  provider: "unavailable",
  availableProviders: ["ollama", "litai"],
  lastCheck: null,
};

/**
 * Make HTTP request to agent server
 */
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, AGENT_SERVER_URL);
    const protocol = url.protocol === "https:" ? https : http;

    const options = {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      timeout: REQUEST_TIMEOUT,
    };

    const req = protocol.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.on("timeout", () => {
      req.abort();
      reject(new Error("Request timeout"));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Check agent server status
 */
async function checkAgentStatus() {
  try {
    const status = await makeRequest("GET", "/api/v1/status");
    agentStatus.online = true;
    agentStatus.provider = status.current_provider || "unavailable";
    agentStatus.availableProviders = status.available_providers || [
      "ollama",
      "litai",
    ];
    agentStatus.lastCheck = new Date();
    return agentStatus;
  } catch (e) {
    agentStatus.online = false;
    agentStatus.lastCheck = new Date();
    // e.message is empty for AggregateError (Node's Happy-Eyeballs dual-stack
    // connect wraps per-attempt ECONNREFUSED errors and leaves .message ""),
    // which is exactly what happens here since nothing listens on
    // AGENT_SERVER_URL by default — fall back to the wrapped sub-errors.
    const reason = e && (e.message || (e.errors && e.errors.map((x) => x.message).join("; ")) || String(e));
    console.error("[Agent] Status check failed:", reason || "unknown error");
    return agentStatus;
  }
}

/**
 * Send a prompt to the agent server
 * @param {string} prompt - User query
 * @param {string} currentUrl - Current page URL (optional)
 * @param {string} currentTitle - Current page title (optional)
 * @returns {{ status, evaluation, agent_used, a2ui }}
 */
async function sendPromptToAgent(prompt, currentUrl = null, currentTitle = null) {
  try {
    if (!agentStatus.online) {
      await checkAgentStatus();
      if (!agentStatus.online) {
        return {
          status: "error",
          evaluation: "Agent server offline",
          a2ui: {
            type: "text",
            content: "Agent server is not responding. Make sure it's running.",
          },
        };
      }
    }

    const response = await makeRequest("POST", "/api/v1/swarm/task", {
      prompt: prompt,
      current_url: currentUrl,
      current_title: currentTitle,
    });

    return response;
  } catch (e) {
    console.error("[Agent] Task failed:", e);
    return {
      status: "error",
      evaluation: e.message,
      a2ui: {
        type: "text",
        content: `Agent error: ${e.message}`,
      },
    };
  }
}

/**
 * Switch between LitAI and Ollama models
 * @param {string} provider - "litai" or "ollama"
 * @returns {{ status, provider, message }}
 */
async function switchModelProvider(provider) {
  try {
    if (!["litai", "ollama"].includes(provider)) {
      throw new Error(`Invalid provider: ${provider}`);
    }

    const response = await makeRequest("POST", "/api/v1/models/switch", {
      provider: provider,
    });

    currentModel = provider;
    agentStatus.provider = provider;

    return response;
  } catch (e) {
    console.error("[Agent] Model switch failed:", e);
    return {
      status: "error",
      message: `Failed to switch to ${provider}: ${e.message}`,
    };
  }
}

/**
 * Get current model provider info
 * @returns {{ provider, available_providers, models }}
 */
async function getModelProviderInfo() {
  try {
    return await makeRequest("GET", "/api/v1/models/provider");
  } catch (e) {
    console.error("[Agent] Failed to get provider info:", e);
    return {
      provider: currentModel,
      available_providers: ["ollama", "litai"],
      models: {},
    };
  }
}

/**
 * Format A2UI response for display in chat
 */
function formatA2UIResponse(a2ui) {
  if (!a2ui) return "No response";

  if (a2ui.type === "text") {
    return a2ui.content || "No content";
  } else if (a2ui.type === "link") {
    return `🔗 [${a2ui.label}](${a2ui.url})`;
  } else if (a2ui.type === "widget") {
    return formatWidget(a2ui);
  } else if (a2ui.type === "nav") {
    return `→ Navigate to: ${a2ui.url}`;
  }

  return JSON.stringify(a2ui, null, 2);
}

function formatWidget(widget) {
  let result = `📊 ${widget.title || "Widget"}\n`;
  if (widget.items) {
    widget.items.forEach((item) => {
      result += `  • ${item.label}: ${item.value}\n`;
    });
  }
  return result;
}

// Export functions
module.exports = {
  checkAgentStatus,
  sendPromptToAgent,
  switchModelProvider,
  getModelProviderInfo,
  formatA2UIResponse,
  getAgentStatus: () => agentStatus,
  setAgentServerUrl: (url) => {
    AGENT_SERVER_URL = url;
  },
};

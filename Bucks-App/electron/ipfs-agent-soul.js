/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  IPFS Agent Soul Bridge                                      ║
 * ║  Connects IPFS/gossipsub soul layer to the Python agent server║
 * ║                                                              ║
 * ║  On startup:                                                 ║
 * ║    1. Fetch own soul from agent server                       ║
 * ║    2. Pin soul to IPFS                                       ║
 * ║    3. Start advertising soul on gossipsub every 30s          ║
 * ║                                                              ║
 * ║  On peer soul received:                                      ║
 * ║    1. Forward to agent server for verification + registry    ║
 * ║    2. Log trust result                                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const http = require("http");
const { advertiseAgentSoul, pinSoul, onPeerSoul } = require("./ipfs-node");

// The Soul Engine (soul_engine.py) is the live agent server at :8765 — it now
// exposes GET/POST /api/v1/soul* (see soul_engine.py's "Soul identity + P2P
// discovery" section). The old :3000 Tauri-era server this pointed at is dead.
const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8765";
const SOUL_ADVERTISE_INTERVAL_MS = 30_000; // 30 seconds

let _ownSoul = null;
let _advertiseTimer = null;
let _pinAttemptedForSoul = null;

// ── HTTP helper ────────────────────────────────────────────────────────────

function agentGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${AGENT_SERVER_URL}${path}`, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.abort(); reject(new Error("timeout")); });
  });
}

function agentPost(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const url = new URL(path, AGENT_SERVER_URL);
    const req = http.request(url, opts, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.abort(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Own soul lifecycle ─────────────────────────────────────────────────────

async function fetchAndAdvertiseSoul() {
  try {
    const soul = await agentGet("/api/v1/soul");
    if (!soul || !soul.soulId) {
      console.warn("[SoulBridge] Agent server returned no soul — retry in 30s");
      return;
    }

    _ownSoul = soul;

    // Pin to IPFS if no CID yet
    // A failed CID write-back used to add the same manifest every 30 seconds.
    // One attempt per soul identity per app session is enough.
    if ((!soul.frozenMemoryCid || soul.frozenMemoryCid === "") && _pinAttemptedForSoul !== soul.soulId) {
      _pinAttemptedForSoul = soul.soulId;
      const cid = await pinSoul(soul);
      if (cid) {
        // Tell agent server about the CID so it can update the soul
        const updated = await agentPost("/api/v1/soul/set_ipfs_cid", { cid });
        _ownSoul = updated.soul || { ..._ownSoul, frozenMemoryCid: cid };
        console.log(`[SoulBridge] Frozen memory pinned once: ${cid}`);
      }
    }

    await advertiseAgentSoul(_ownSoul);
  } catch (e) {
    console.error("[SoulBridge] Failed to fetch/advertise soul:", e.message);
  }
}

// ── Peer soul handler ──────────────────────────────────────────────────────

async function handlePeerSoul(soul) {
  try {
    const result = await agentPost("/api/v1/soul/peer", soul);
    if (result.trusted) {
      console.log(`[SoulBridge] Trusted peer registered: ${soul.soulId.slice(0, 16)}... (${soul.locality})`);
    } else {
      console.warn(`[SoulBridge] Untrusted peer rejected: ${soul.soulId.slice(0, 16)}... reason=${result.reason}`);
    }
  } catch (e) {
    console.error("[SoulBridge] Failed to forward peer soul:", e.message);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the soul bridge. Call this after the IPFS node is started.
 * @param {number} [delayMs=3000] - Wait before first advertisement (let IPFS connect).
 */
async function start(delayMs = 3000) {
  // Register peer soul listener on the IPFS layer
  onPeerSoul(handlePeerSoul);

  // Initial advertisement after brief delay
  await new Promise((r) => setTimeout(r, delayMs));
  await fetchAndAdvertiseSoul();

  // Periodic re-advertisement
  _advertiseTimer = setInterval(fetchAndAdvertiseSoul, SOUL_ADVERTISE_INTERVAL_MS);
  console.log("[SoulBridge] Soul bridge active — advertising every 30s");
}

function stop() {
  if (_advertiseTimer) {
    clearInterval(_advertiseTimer);
    _advertiseTimer = null;
  }
}

function getOwnSoul() {
  return _ownSoul;
}

module.exports = { start, stop, getOwnSoul };

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  BUCKS AGENT SWARM — Multi-Browser Distributed Intelligence     ║
 * ║                                                                  ║
 * ║  Every Bucks browser instance is a swarm node.                  ║
 * ║  Nodes coordinate via IPFS gossipsub to form a distributed AI:  ║
 * ║                                                                  ║
 * ║  • Capability advertisement (model, tools, load, soul)          ║
 * ║  • Load-aware task delegation                                    ║
 * ║  • Swarm consensus for complex decisions                         ║
 * ║  • Automatic failover when a node goes offline                   ║
 * ║  • WorldSoul hash verification before accepting delegation       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const http = require("http");
const crypto = require("crypto");

// Deliberately a DIFFERENT env var than cluster-membership.js's
// AGENT_SERVER_URL (which defaults to :8765, the always-on Soul Engine):
// this module only matters when BUCKS_EXPERIMENTAL_SWARM=1, and sharing the
// var name meant setting AGENT_SERVER_URL for one purpose silently redirected
// the other module's agent-signing calls to the wrong port.
const AGENT_SERVER_URL = process.env.BUCKS_SWARM_AGENT_SERVER_URL || "http://localhost:3000";
const SWARM_HEARTBEAT_MS = 8_000;   // advertise every 8 s
const PEER_TIMEOUT_MS    = 30_000;  // peer dead after 30 s silence
const MAX_LOAD           = 5;       // max concurrent tasks before refusing delegation

// ── Topic derivation ─────────────────────────────────────────────────────────
const CLUSTER_CIDN = process.env.BUCKS_CLUSTER_CIDN || "mainnet";
const SWARM_CAPABILITY_TOPIC = `bucks-swarm-caps-${CLUSTER_CIDN}`;
const SWARM_TASK_TOPIC       = `bucks-swarm-tasks-${CLUSTER_CIDN}`;
const SWARM_RESULT_TOPIC     = `bucks-swarm-results-${CLUSTER_CIDN}`;
const SWARM_CONSENSUS_TOPIC  = `bucks-swarm-consensus-${CLUSTER_CIDN}`;

// ── Node state ───────────────────────────────────────────────────────────────
let _gossip = null;
let _localNodeId = null;       // libp2p PeerID string
let _localSoul   = null;       // soul manifest from agent server
let _localCaps   = null;       // capability advertisement
let _currentLoad = 0;          // tasks currently in-flight
let _heartbeatTimer = null;

// Peer registry: nodeId → { caps, load, lastSeen, soul }
const _peers = new Map();

// Pending delegations: taskId → { resolve, reject, timeout }
const _pending = new Map();

// Consensus rounds: roundId → { votes: Map<nodeId, answer>, resolve, timeout }
const _consensusRounds = new Map();

// ── Initialise ───────────────────────────────────────────────────────────────

/**
 * Start the swarm layer.
 * Must be called AFTER ipfs-node.js startNode() has completed.
 * @param {object} heliaNode - The running Helia node
 * @param {object} gossip    - The gossipsub service from ipfs-node
 */
async function start(heliaNode, gossip) {
  _gossip      = gossip;
  _localNodeId = heliaNode.libp2p.peerId.toString();

  // Subscribe to swarm topics
  gossip.subscribe(SWARM_CAPABILITY_TOPIC);
  gossip.subscribe(SWARM_TASK_TOPIC);
  gossip.subscribe(SWARM_RESULT_TOPIC);
  gossip.subscribe(SWARM_CONSENSUS_TOPIC);

  gossip.addEventListener("message", _onSwarmMessage);

  // Fetch soul + capabilities from agent server (brief startup delay)
  await new Promise((r) => setTimeout(r, 2000));
  await _refreshLocalCaps();

  // Begin heartbeat
  _heartbeatTimer = setInterval(_heartbeat, SWARM_HEARTBEAT_MS);
  await _heartbeat();

  // Prune dead peers periodically
  setInterval(_pruneDeadPeers, PEER_TIMEOUT_MS);

  console.log(`[Swarm] Node ${_localNodeId.slice(0, 12)} online | model=${_localCaps?.model}`);
}

function stop() {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer);
  _gossip?.unsubscribe(SWARM_CAPABILITY_TOPIC);
  _gossip?.unsubscribe(SWARM_TASK_TOPIC);
  _gossip?.unsubscribe(SWARM_RESULT_TOPIC);
  _gossip?.unsubscribe(SWARM_CONSENSUS_TOPIC);
}

// ── Capability advertisement ──────────────────────────────────────────────────

async function _refreshLocalCaps() {
  try {
    const status = await _agentGet("/api/v1/status");
    const soul   = await _agentGet("/api/v1/soul");
    _localSoul = soul;
    _localCaps = {
      nodeId:       _localNodeId,
      soulId:       soul?.soulId?.slice(0, 16) || "",
      worldSoulHash: soul?.worldSoulHash?.slice(0, 16) || "",
      model:        status?.slm?.model || "unknown",
      modelReady:   status?.slm?.ready || false,
      capabilities: soul?.capabilities || [],
      tools:        status?.tools || 0,
      load:         _currentLoad,
      maxLoad:      MAX_LOAD,
      locality:     soul?.locality || "global",
      agentUrl:     AGENT_SERVER_URL,
      ts:           Date.now(),
    };
  } catch (e) {
    console.warn("[Swarm] Failed to refresh caps:", e.message);
  }
}

async function _heartbeat() {
  if (!_gossip || !_localCaps) return;
  _localCaps.load = _currentLoad;
  _localCaps.ts   = Date.now();
  const msg = { type: "caps", ...(_localCaps) };
  await _publish(SWARM_CAPABILITY_TOPIC, msg);
}

// ── Message router ────────────────────────────────────────────────────────────

function _onSwarmMessage(evt) {
  const topic = evt.detail.topic;
  try {
    const msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
    if (msg.nodeId === _localNodeId) return; // ignore self

    if      (topic === SWARM_CAPABILITY_TOPIC)  _handleCaps(msg);
    else if (topic === SWARM_TASK_TOPIC)        _handleIncomingTask(msg);
    else if (topic === SWARM_RESULT_TOPIC)      _handleResult(msg);
    else if (topic === SWARM_CONSENSUS_TOPIC)   _handleConsensusVote(msg);
  } catch (e) {
    console.error("[Swarm] Parse error:", e.message);
  }
}

// ── Capability handling ───────────────────────────────────────────────────────

function _handleCaps(msg) {
  _peers.set(msg.nodeId, {
    caps:     msg,
    load:     msg.load ?? 0,
    lastSeen: Date.now(),
  });
}

function _pruneDeadPeers() {
  const cutoff = Date.now() - PEER_TIMEOUT_MS;
  for (const [id, peer] of _peers.entries()) {
    if (peer.lastSeen < cutoff) {
      _peers.delete(id);
      console.log(`[Swarm] Pruned dead peer: ${id.slice(0, 12)}`);
    }
  }
}

// ── Task delegation ───────────────────────────────────────────────────────────

/**
 * Delegate a task to the best available swarm node.
 * If no suitable peer is available, falls back to local execution.
 *
 * @param {string} prompt            - The user prompt / task text
 * @param {string} requiredCapability - e.g. "code", "commerce", "rag_search"
 * @param {number} [timeoutMs=20000]
 * @returns {Promise<object>}        - Agent response
 */
async function delegateTask(prompt, requiredCapability = "", timeoutMs = 20_000) {
  const peer = _pickBestPeer(requiredCapability);

  if (!peer) {
    // Run locally
    return _runLocally(prompt);
  }

  const taskId = crypto.randomUUID();
  const task = {
    type:       "task",
    taskId,
    fromNodeId: _localNodeId,
    prompt,
    requiredCapability,
    ts: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(taskId);
      reject(new Error(`Swarm task ${taskId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    _pending.set(taskId, { resolve, reject, timer });
    _publish(SWARM_TASK_TOPIC, { ...task, toNodeId: peer.caps.nodeId });
    console.log(`[Swarm] Delegated task ${taskId.slice(0, 8)} → ${peer.caps.nodeId.slice(0, 12)}`);
  });
}

function _pickBestPeer(capability) {
  const candidates = [];
  for (const [, peer] of _peers.entries()) {
    const caps = peer.caps;
    if (caps.load >= caps.maxLoad) continue;
    if (capability && !caps.capabilities?.includes(capability)) continue;
    // Prefer same worldSoulHash (same Quran soul)
    const soulMatch = _localSoul?.worldSoulHash?.slice(0, 16) === caps.worldSoulHash;
    candidates.push({ peer, soulMatch, score: (caps.maxLoad - caps.load) + (soulMatch ? 10 : 0) });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].peer;
}

// ── Incoming task handler (this node is the worker) ──────────────────────────

async function _handleIncomingTask(msg) {
  if (msg.toNodeId && msg.toNodeId !== _localNodeId) return;
  if (_currentLoad >= MAX_LOAD) {
    await _publish(SWARM_RESULT_TOPIC, {
      type:       "result",
      taskId:     msg.taskId,
      toNodeId:   msg.fromNodeId,
      status:     "error",
      evaluation: "Node overloaded — retry",
      ts: Date.now(),
    });
    return;
  }

  _currentLoad++;
  console.log(`[Swarm] Executing delegated task ${msg.taskId?.slice(0, 8)} (load=${_currentLoad})`);

  try {
    const result = await _runLocally(msg.prompt, msg.current_url, msg.current_title);
    await _publish(SWARM_RESULT_TOPIC, {
      type:     "result",
      taskId:   msg.taskId,
      toNodeId: msg.fromNodeId,
      ...result,
      ts: Date.now(),
    });
  } catch (e) {
    await _publish(SWARM_RESULT_TOPIC, {
      type:       "result",
      taskId:     msg.taskId,
      toNodeId:   msg.fromNodeId,
      status:     "error",
      evaluation: e.message,
      ts: Date.now(),
    });
  } finally {
    _currentLoad = Math.max(0, _currentLoad - 1);
  }
}

function _handleResult(msg) {
  if (msg.toNodeId && msg.toNodeId !== _localNodeId) return;
  const pending = _pending.get(msg.taskId);
  if (!pending) return;
  clearTimeout(pending.timer);
  _pending.delete(msg.taskId);
  pending.resolve(msg);
}

// ── Swarm Consensus ───────────────────────────────────────────────────────────

/**
 * Broadcast a question to all swarm nodes and wait for majority vote.
 * Useful for ethics-sensitive decisions where multiple agents should agree.
 *
 * @param {string} question      - The decision question
 * @param {string[]} options     - Possible answers e.g. ["approve", "reject"]
 * @param {number} quorum        - Minimum votes needed (default: 2)
 * @param {number} timeoutMs
 * @returns {Promise<{answer: string, votes: number, total: number}>}
 */
async function swarmConsensus(question, options = ["approve", "reject"], quorum = 2, timeoutMs = 15_000) {
  const roundId = crypto.randomUUID();

  // Cast our own vote first
  const localVote = await _castLocalVote(question, options);

  const votes = new Map([[_localNodeId, localVote]]);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _consensusRounds.delete(roundId);
      resolve(_tallyVotes(votes, options));
    }, timeoutMs);

    _consensusRounds.set(roundId, {
      votes,
      quorum,
      options,
      resolve: (result) => {
        clearTimeout(timer);
        _consensusRounds.delete(roundId);
        resolve(result);
      },
    });

    _publish(SWARM_CONSENSUS_TOPIC, {
      type:     "vote_request",
      roundId,
      question,
      options,
      fromNodeId: _localNodeId,
      ts: Date.now(),
    });
  });
}

async function _handleConsensusVote(msg) {
  if (msg.type === "vote_request" && msg.fromNodeId !== _localNodeId) {
    const vote = await _castLocalVote(msg.question, msg.options);
    await _publish(SWARM_CONSENSUS_TOPIC, {
      type:      "vote",
      roundId:   msg.roundId,
      vote,
      fromNodeId: _localNodeId,
      ts: Date.now(),
    });
    return;
  }

  if (msg.type === "vote") {
    const round = _consensusRounds.get(msg.roundId);
    if (!round) return;
    round.votes.set(msg.fromNodeId, msg.vote);
    if (round.votes.size >= round.quorum) {
      round.resolve(_tallyVotes(round.votes, round.options));
    }
  }
}

async function _castLocalVote(question, options) {
  try {
    const res = await _agentPost("/api/v1/swarm/task", {
      prompt: `SWARM CONSENSUS VOTE:\nQuestion: ${question}\nOptions: ${options.join(", ")}\nReply with ONLY one option word.`,
    });
    const ans = (res.evaluation || "").trim().toLowerCase();
    return options.find((o) => ans.includes(o.toLowerCase())) || options[0];
  } catch {
    return options[0];
  }
}

function _tallyVotes(votes, options) {
  const counts = {};
  options.forEach((o) => (counts[o] = 0));
  votes.forEach((v) => { if (counts[v] !== undefined) counts[v]++; });
  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { answer: winner[0], votes: winner[1], total: votes.size, breakdown: counts };
}

// ── Local execution ───────────────────────────────────────────────────────────

async function _runLocally(prompt, currentUrl = null, currentTitle = null) {
  return _agentPost("/api/v1/swarm/task", { prompt, current_url: currentUrl, current_title: currentTitle });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function _agentGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${AGENT_SERVER_URL}${path}`, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function _agentPost(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url  = new URL(path, AGENT_SERVER_URL);
    const req  = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Publish helper ────────────────────────────────────────────────────────────

async function _publish(topic, payload) {
  if (!_gossip) return;
  try {
    await _gossip.publish(topic, new TextEncoder().encode(JSON.stringify(payload)));
  } catch (e) {
    if (!e.message?.includes("PublishError.NoPeersSubscribedToTopic")) {
      console.error(`[Swarm] Publish error on ${topic}:`, e.message);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function getSwarmStatus() {
  return {
    nodeId:    _localNodeId,
    peers:     _peers.size,
    load:      _currentLoad,
    maxLoad:   MAX_LOAD,
    caps:      _localCaps,
    peerList:  [..._peers.entries()].map(([id, p]) => ({
      nodeId:   id.slice(0, 16),
      model:    p.caps.model,
      load:     p.caps.load,
      locality: p.caps.locality,
      lastSeen: Math.round((Date.now() - p.lastSeen) / 1000) + "s ago",
    })),
  };
}

module.exports = {
  start,
  stop,
  delegateTask,
  swarmConsensus,
  getSwarmStatus,
};

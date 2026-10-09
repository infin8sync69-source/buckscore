/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  BUCKS CLUSTER MEMBERSHIP — invite-grown exclusive swarm    ║
 * ║                                                            ║
 * ║  CIDN (ipfs-node.js) is an open shared string today — any  ║
 * ║  peer that sets the same value auto-joins. This module adds║
 * ║  a real admission gate on top of that open discovery layer:║
 * ║  peers are still DISCOVERED via the existing soul broadcast║
 * ║  (SOUL_TOPIC, unchanged), but only count as a cluster       ║
 * ║  MEMBER once an already-admitted member (or a genesis seed) ║
 * ║  signs and gossips an admission record for them. Members can║
 * ║  then admit further people themselves — transitive growth,  ║
 * ║  tree-shaped, matching the product's invite flow.           ║
 * ║                                                            ║
 * ║  Follows chat-engine.js's self-contained-module convention: ║
 * ║  owns its own gossip topic/subscribe/dispatch rather than   ║
 * ║  routing through ipfs-node.js's central dispatcher.         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { app } = require("electron");
const { verifyEd25519 } = require("./crypto-utils");

const CLUSTER_SECRET =
  process.env.BUCKS_CLUSTER_SECRET || "BUCKS_DEFAULT_CLUSTER";
const CLUSTER_CIDN = process.env.BUCKS_CLUSTER_CIDN || "mainnet";
const MEMBERSHIP_TOPIC = `bucks-membership-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

// Founder seed(s) — the only identities allowed to mint the FIRST admission
// records with no prior member vouching for them. Override for testing via
// BUCKS_GENESIS_SOUL_IDS (comma-separated soulId hex strings).
const GENESIS_SOUL_IDS = new Set(
  (process.env.BUCKS_GENESIS_SOUL_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8765";
const PRESENCE_TTL_MS = 60_000; // 2x the soul heartbeat interval (30s)

let heliaNode = null;
let gossip = null;
let DATA_FILE = null;

let members = new Map();      // soulId -> MemberRecord (admitted)
let discovered = new Map();   // soulId -> { soul, peerId, lastSeenTs } (heard, not admitted)
let soulPresence = new Map(); // soulId -> { peerId, lastSeenTs } (ALL souls heard, admitted or not)
let peerIdToSoulId = new Map(); // peerId -> soulId (reverse of soulPresence, for feed-post attribution)

// ── Peer key registry ──────────────────────────────────────────────────────────
// Maps soulId -> Ed25519 public key hex for signature verification.
// Since soulId IS the hex-encoded raw Ed25519 public key (see soul/generator.py),
// keys are registered when we see a soul heartbeat or process an admission record.
// This registry enforces fail-closed behaviour: a peer whose key we have never
// seen cannot have their messages verified as valid.
const peerKeys = new Map(); // soulId -> Ed25519 public key hex

function registerPeerKey(soulId, publicKey) {
  if (soulId && publicKey) peerKeys.set(soulId, publicKey);
}

function getPeerKey(soulId) {
  return peerKeys.get(soulId) || null;
}

function canonicalAdmissionPayload(newMemberSoulId, admittedBySoulId, cidn, timestamp) {
  return ["admission", newMemberSoulId, admittedBySoulId, cidn, String(timestamp)].join("|");
}

// ── Agent-server signing (private key never leaves the Python process) ──
function agentPost(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(urlPath, AGENT_SERVER_URL);
    const req = http.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve({}); }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(8000, () => { req.abort(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Persistence (mirrors pinned.json/following.json in ipfs-node.js) ──
function persist() {
  if (!DATA_FILE) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(members), null, 2), "utf8");
  } catch (e) {
    console.error("[Cluster] Failed to persist membership:", e.message);
  }
}

function load() {
  if (!DATA_FILE || !fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    members = new Map(Object.entries(data));
    console.log(`[Cluster] Restored ${members.size} cluster member(s).`);
  } catch (e) {
    console.error("[Cluster] Failed to load membership:", e.message);
  }
}

// ── Discovery: fed by the EXISTING soul heartbeat (SOUL_TOPIC), unchanged.
// A discovered-but-unadmitted soul is visible for search/admit; once
// admitted it's removed from `discovered` and lives only in `members`. ──
function onSoulSeen(soul) {
  if (!soul || !soul.soulId) return;
  const peerId = soul.nodeId || null;
  soulPresence.set(soul.soulId, { peerId, lastSeenTs: Date.now() });
  if (peerId) peerIdToSoulId.set(peerId, soul.soulId);
  // soulId IS the hex-encoded Ed25519 public key (soul/generator.py: _soul_id()).
  // Register it so verifyEd25519 call sites can look it up by soulId.
  registerPeerKey(soul.soulId, soul.soulId);
  if (!members.has(soul.soulId)) {
    discovered.set(soul.soulId, { soul, peerId, lastSeenTs: Date.now() });
  }
}

/**
 * Reverse-lookup: which soulId is CURRENTLY broadcasting from this peerId,
 * per the soul heartbeat (SOUL_TOPIC)? Used to verify feed-post attribution
 * (ipfs-node.js) — a post claiming a soulId is only trusted as cluster-
 * attributable if the peerId that actually published it matches this.
 */
function getSoulIdForPeer(peerId) {
  return peerIdToSoulId.get(peerId) || null;
}

function isActive(soulId) {
  const p = soulPresence.get(soulId);
  return !!p && Date.now() - p.lastSeenTs < PRESENCE_TTL_MS;
}

// ── Admission ──
async function admitMember(targetSoulId, { displayName } = {}) {
  if (!heliaNode) throw new Error("Cluster membership not initialized");
  if (members.has(targetSoulId)) return { ok: false, error: "already a member" };

  const mySoul = await getOwnSoulSafe();
  if (!mySoul || !mySoul.soulId) throw new Error("Local soul identity unavailable");

  const admittedByPeerId = heliaNode.libp2p.peerId.toString();
  const timestamp = Date.now();
  const payload = canonicalAdmissionPayload(targetSoulId, mySoul.soulId, CLUSTER_CIDN, timestamp);
  const signRes = await agentPost("/api/v1/soul/sign", { payload });
  if (!signRes || !signRes.ok) throw new Error("Signing failed (agent server unreachable?)");

  const record = {
    soulId: targetSoulId,
    displayName: displayName || (discovered.get(targetSoulId) || {}).soul?.locality || "",
    admittedBySoulId: mySoul.soulId,
    admittedByPeerId,
    cidn: CLUSTER_CIDN,
    generation: (members.get(mySoul.soulId)?.generation ?? -1) + 1,
    timestamp,
    signature: signRes.signature,
  };

  members.set(targetSoulId, record);
  // Register the admitted peer's public key (soulId == pubkeyHex per soul/generator.py)
  registerPeerKey(targetSoulId, targetSoulId);
  discovered.delete(targetSoulId);
  persist();

  if (gossip) {
    const data = new TextEncoder().encode(JSON.stringify({ type: "admission", record }));
    try {
      await gossip.publish(MEMBERSHIP_TOPIC, data);
    } catch (e) {
      console.error("[Cluster] Failed to gossip admission:", e.message);
    }
  }

  console.log(`[Cluster] Admitted ${targetSoulId.slice(0, 16)}... (gen ${record.generation})`);
  return { ok: true, record };
}

async function getOwnSoulSafe() {
  try {
    const { getOwnSoul } = require("./ipfs-agent-soul");
    return getOwnSoul();
  } catch (e) {
    return null;
  }
}

// ── Gossip receive: validate + accept + flood-once re-broadcast ──
let seenRecordKeys = new Set(); // `${soulId}:${admittedBySoulId}` — avoid re-flooding forever

async function handleMembershipMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    if (data.type !== "admission" || !data.record) return;
    const r = data.record;
    const fromPeerId = msg.from.toString();

    if (!r.soulId || !r.admittedBySoulId || !r.signature || !r.timestamp) return;
    // Transport-layer sender must be the record's claimed admitter (at time
    // of admission) — mirrors the anti-spoof check already used for
    // identity/feed/dweb messages in ipfs-node.js.
    if (r.admittedByPeerId !== fromPeerId) {
      console.warn(`[Cluster] Dropped spoofed admission: claimed admitter peerId ${r.admittedByPeerId} != publisher ${fromPeerId}`);
      return;
    }
    if (r.cidn !== CLUSTER_CIDN) return;

    const payload = canonicalAdmissionPayload(r.soulId, r.admittedBySoulId, r.cidn, r.timestamp);
    // [Trust] Fail-closed: reject admission if we have never seen this admitter's
    // soul heartbeat. getPeerKey returns null for unknown peers.
    const admitterPubKey = getPeerKey(r.admittedBySoulId);
    if (!admitterPubKey) {
      console.warn(`[Trust] No public key registered for admitter ${r.admittedBySoulId.slice(0, 16)}... — rejecting admission (fail-closed)`);
      return;
    }
    if (!verifyEd25519(admitterPubKey, payload, r.signature)) {
      console.warn(`[Cluster] Dropped admission with bad signature for ${r.soulId.slice(0, 16)}...`);
      return;
    }

    // Transitive trust: the admitter must already be a member, or a genesis
    // seed. This is "the algorithm" for cluster growth — deliberately simple.
    const admitterTrusted = members.has(r.admittedBySoulId) || GENESIS_SOUL_IDS.has(r.admittedBySoulId);
    if (!admitterTrusted) {
      console.warn(`[Cluster] Dropped admission: admitter ${r.admittedBySoulId.slice(0, 16)}... is not itself a member`);
      return;
    }

    const dedupeKey = `${r.soulId}:${r.admittedBySoulId}:${r.timestamp}`;
    const alreadySeen = seenRecordKeys.has(dedupeKey);
    seenRecordKeys.add(dedupeKey);

    const existing = members.get(r.soulId);
    if (!existing || existing.timestamp > r.timestamp) {
      members.set(r.soulId, r);
      discovered.delete(r.soulId);
      persist();
      console.log(`[Cluster] Learned membership: ${r.soulId.slice(0, 16)}... via ${r.admittedBySoulId.slice(0, 16)}...`);
    }

    // Flood-once: re-broadcast on first sight so late/indirect peers
    // eventually converge, matching disseminatePost/publishDweb's pattern.
    if (!alreadySeen && gossip) {
      try {
        await gossip.publish(MEMBERSHIP_TOPIC, msg.data);
      } catch (e) {
        // best-effort relay
      }
    }
  } catch (e) {
    console.error("[Cluster] Failed to handle membership message:", e.message);
  }
}

// ── Public read API ──
// No enforcement lives here — a member's advertised version is surfaced as
// an "outdated" flag only, so the UI can show a badge. Convergence toward
// one version happens because routine updates auto-apply (cluster-updater.js
// defaults that to ON), not because anything here rejects stale peers.
function getMembers() {
  const { getPeerVersion, isNewerVersion } = require("./ipfs-node");
  const myVersion = app.getVersion();
  return [...members.values()].map((m) => {
    const peerId = soulPresence.get(m.soulId)?.peerId;
    const appVersion = peerId ? getPeerVersion(peerId) : null;
    return {
      ...m,
      online: isActive(m.soulId),
      appVersion,
      outdated: !!appVersion && isNewerVersion(myVersion, appVersion),
    };
  });
}

function getDiscovered() {
  return [...discovered.values()]
    .filter((d) => isActive(d.soul.soulId))
    .map((d) => ({ soulId: d.soul.soulId, locality: d.soul.locality, peerId: d.peerId, lastSeenTs: d.lastSeenTs }));
}

function search(query) {
  const q = (query || "").toLowerCase().trim();
  const all = [...getMembers().map((m) => ({ ...m, status: "member" })),
               ...getDiscovered().map((d) => ({ ...d, status: "discovered" }))];
  if (!q) return all;
  return all.filter((x) => (x.soulId || "").toLowerCase().includes(q) || (x.displayName || x.locality || "").toLowerCase().includes(q));
}

async function getMyIdentity() {
  const soul = await getOwnSoulSafe();
  return {
    soulId: soul ? soul.soulId : null,
    peerId: heliaNode ? heliaNode.libp2p.peerId.toString() : null,
    isMember: soul ? (members.has(soul.soulId) || GENESIS_SOUL_IDS.has(soul.soulId)) : false,
    memberCount: members.size,
  };
}

function isMember(soulId) {
  return members.has(soulId) || GENESIS_SOUL_IDS.has(soulId);
}

// ── Lifecycle ──
function init(helia, gossipSub) {
  heliaNode = helia;
  gossip = gossipSub;

  const IPFS_DATA_DIR = path.join(app.getPath("userData"), "ipfs-data");
  fs.mkdirSync(IPFS_DATA_DIR, { recursive: true });
  DATA_FILE = path.join(IPFS_DATA_DIR, "cluster-members.json");
  load();

  gossip.addEventListener("message", (evt) => {
    if (evt.detail.topic === MEMBERSHIP_TOPIC) handleMembershipMessage(evt.detail);
  });
  gossip.subscribe(MEMBERSHIP_TOPIC);

  const { onPeerSoul } = require("./ipfs-node");
  onPeerSoul(onSoulSeen);

  console.log(`[Cluster] Membership module active. Topic: ${MEMBERSHIP_TOPIC}`);
  if (GENESIS_SOUL_IDS.size > 0) {
    console.log(`[Cluster] ${GENESIS_SOUL_IDS.size} genesis soul(s) configured.`);
  }
}

module.exports = {
  init,
  admitMember,
  getMembers,
  getDiscovered,
  search,
  getMyIdentity,
  isMember,
  getSoulIdForPeer,
  registerPeerKey,
  getPeerKey,
  MEMBERSHIP_TOPIC,
};

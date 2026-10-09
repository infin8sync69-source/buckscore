/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  BUCKS DEVICE SYNC — multi-device linking for one Soul      ║
 * ║                                                            ║
 * ║  Every install today mints its OWN soulId (agent/soul's     ║
 * ║  local Ed25519 identity — see ipfs-agent-soul.js). There is ║
 * ║  no private-key export/import path, so "the same person's   ║
 * ║  laptop and phone" are, cryptographically, two different    ║
 * ║  souls. This module doesn't change that; instead it lets a  ║
 * ║  person MUTUALLY ATTEST that two (or more) of their own     ║
 * ║  soulIds are the same person's devices — a signed, gossiped ║
 * ║  record from EACH side, so neither device alone can claim   ║
 * ║  a link the other didn't consent to. Once a link is mutual, ║
 * ║  either device can publish a small state snapshot (pinned   ║
 * ║  CID list, followed peers) that the other pulls and merges. ║
 * ║                                                            ║
 * ║  Deliberately NOT covered here: syncing chat/session state. ║
 * ║  Each device's Double Ratchet sessions (signal-store.js) are║
 * ║  local secrets tied to that device's X25519 identity keys — ║
 * ║  fanning out message history across linked devices safely   ║
 * ║  (Signal's actual multi-device approach re-encrypts per      ║
 * ║  recipient device via sender keys) is a separate, harder     ║
 * ║  design problem and out of scope for this module.            ║
 * ║                                                            ║
 * ║  Follows cluster-membership.js's / cluster-updater.js's      ║
 * ║  established patterns: own gossip topic, agent-server-signed ║
 * ║  canonical payloads, CID-pointer state announcements.        ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { app } = require("electron");
const { verifyEd25519 } = require("./crypto-utils");
const { getPeerKey }    = require("./cluster-membership");

const CLUSTER_SECRET =
  process.env.BUCKS_CLUSTER_SECRET || "BUCKS_DEFAULT_CLUSTER";
const DEVICE_LINK_TOPIC = `bucks-devicelink-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;
const DEVICE_STATE_TOPIC = `bucks-devicestate-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8765";
const STATE_REANNOUNCE_INTERVAL_MS = 10 * 60_000;

let _ipfs = null; // ipfs-node.js module ref, injected at init()
let heliaNode = null;
let gossip = null;
let DATA_FILE = null;

// linkRecords key: `${fromSoulId}->${toSoulId}` — one direction per entry.
// A link between A and B is "mutual"/complete once both A->B and B->A exist.
let linkRecords = new Map();
let seenLinkKeys = new Set(); // dedupe flood-once re-broadcast

// Latest known state snapshot pointer per linked soulId, and what we last
// merged, so we don't reprocess an unchanged announcement.
let peerStatePointers = new Map(); // soulId -> { cid, timestamp }
let lastAppliedTimestamp = new Map(); // soulId -> timestamp

let _reannounceTimer = null;

function canonicalLinkPayload(fromSoulId, toSoulId, timestamp) {
  return ["devicelink", fromSoulId, toSoulId, String(timestamp)].join("|");
}

function canonicalStatePayload(soulId, cid, timestamp) {
  return ["devicestate", soulId, cid, String(timestamp)].join("|");
}

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

async function getOwnSoulSafe() {
  try {
    const { getOwnSoul } = require("./ipfs-agent-soul");
    return getOwnSoul();
  } catch (_) {
    return null;
  }
}

// ── Persistence ──
function persist() {
  if (!DATA_FILE) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      linkRecords: Object.fromEntries(linkRecords),
      peerStatePointers: Object.fromEntries(peerStatePointers),
    }, null, 2), "utf8");
  } catch (e) {
    console.error("[DeviceSync] Failed to persist:", e.message);
  }
}

function load() {
  if (!DATA_FILE || !fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    linkRecords = new Map(Object.entries(data.linkRecords || {}));
    peerStatePointers = new Map(Object.entries(data.peerStatePointers || {}));
    console.log(`[DeviceSync] Restored ${linkRecords.size} link record(s), ${peerStatePointers.size} peer state pointer(s).`);
  } catch (e) {
    console.error("[DeviceSync] Failed to load:", e.message);
  }
}

// ── Link queries ──

/** Is `soulId` a MUTUALLY confirmed linked device of ours? Both directions
 * (us->them and them->us) must have a valid, stored record. */
function isLinkedDevice(soulId, mySoulId) {
  if (!mySoulId || !soulId || soulId === mySoulId) return false;
  return linkRecords.has(`${mySoulId}->${soulId}`) && linkRecords.has(`${soulId}->${mySoulId}`);
}

async function getLinkedDevices() {
  const mySoul = await getOwnSoulSafe();
  if (!mySoul || !mySoul.soulId) return [];
  const out = [];
  for (const key of linkRecords.keys()) {
    const [from, to] = key.split("->");
    if (from === mySoul.soulId && linkRecords.has(`${to}->${from}`)) {
      out.push(to);
    }
  }
  return out;
}

async function getPendingLinks() {
  // Links WE initiated (mySoulId -> X) that the other side hasn't reciprocated yet.
  const mySoul = await getOwnSoulSafe();
  if (!mySoul || !mySoul.soulId) return [];
  const out = [];
  for (const key of linkRecords.keys()) {
    const [from, to] = key.split("->");
    if (from === mySoul.soulId && !linkRecords.has(`${to}->${from}`)) out.push(to);
  }
  return out;
}

// ── Initiate a link (call from both devices — e.g. after a QR/pairing flow
// that has already exchanged soulIds — for the link to become mutual) ──
async function initiateLinkDevice(otherSoulId) {
  if (!heliaNode) throw new Error("Device sync not initialized");
  const mySoul = await getOwnSoulSafe();
  if (!mySoul || !mySoul.soulId) throw new Error("Local soul identity unavailable");
  if (otherSoulId === mySoul.soulId) return { ok: false, error: "cannot link a device to itself" };

  const timestamp = Date.now();
  const payload = canonicalLinkPayload(mySoul.soulId, otherSoulId, timestamp);
  const signRes = await agentPost("/api/v1/soul/sign", { payload });
  if (!signRes || !signRes.ok) throw new Error("Signing failed (agent server unreachable?)");

  const record = {
    fromSoulId: mySoul.soulId,
    toSoulId: otherSoulId,
    fromPeerId: heliaNode.libp2p.peerId.toString(),
    timestamp,
    signature: signRes.signature,
  };

  linkRecords.set(`${mySoul.soulId}->${otherSoulId}`, record);
  persist();

  if (gossip) {
    const data = new TextEncoder().encode(JSON.stringify({ type: "devicelink", record }));
    try { await gossip.publish(DEVICE_LINK_TOPIC, data); }
    catch (e) { console.error("[DeviceSync] Failed to gossip link:", e.message); }
  }

  const mutual = isLinkedDevice(otherSoulId, mySoul.soulId);
  console.log(`[DeviceSync] Linked (${mutual ? "mutual" : "pending reciprocation"}) with ${otherSoulId.slice(0, 16)}...`);
  return { ok: true, mutual, record };
}

async function handleLinkMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    if (data.type !== "devicelink" || !data.record) return;
    const r = data.record;
    const fromPeerId = msg.from.toString();

    if (!r.fromSoulId || !r.toSoulId || !r.signature || !r.timestamp) return;
    if (r.fromPeerId !== fromPeerId) {
      console.warn(`[DeviceSync] Dropped spoofed link: claimed sender peerId ${r.fromPeerId} != publisher ${fromPeerId}`);
      return;
    }

    const payload = canonicalLinkPayload(r.fromSoulId, r.toSoulId, r.timestamp);
    // [Trust] Fail-closed: reject if we have no registered public key for the sender.
    const linkSenderPubKey = getPeerKey(r.fromSoulId);
    if (!linkSenderPubKey) {
      console.warn(`[Trust] No public key registered for ${r.fromSoulId.slice(0, 16)}... — rejecting device link (fail-closed)`);
      return;
    }
    if (!verifyEd25519(linkSenderPubKey, payload, r.signature)) {
      console.warn(`[DeviceSync] Dropped link with bad signature: ${r.fromSoulId.slice(0, 16)}... -> ${r.toSoulId.slice(0, 16)}...`);
      return;
    }

    const key = `${r.fromSoulId}->${r.toSoulId}`;
    const dedupeKey = `${key}:${r.timestamp}`;
    const alreadySeen = seenLinkKeys.has(dedupeKey);
    seenLinkKeys.add(dedupeKey);

    const existing = linkRecords.get(key);
    if (!existing || existing.timestamp < r.timestamp) {
      linkRecords.set(key, r);
      persist();
      console.log(`[DeviceSync] Learned link: ${r.fromSoulId.slice(0, 16)}... -> ${r.toSoulId.slice(0, 16)}...`);

      const mySoul = await getOwnSoulSafe();
      if (mySoul && r.toSoulId === mySoul.soulId && isLinkedDevice(r.fromSoulId, mySoul.soulId)) {
        console.log(`[DeviceSync] Link with ${r.fromSoulId.slice(0, 16)}... is now MUTUAL.`);
      }
    }

    if (!alreadySeen && gossip) {
      try { await gossip.publish(DEVICE_LINK_TOPIC, msg.data); } catch (_) { /* best-effort relay */ }
    }
  } catch (e) {
    console.error("[DeviceSync] Failed to handle link message:", e.message);
  }
}

// ── State snapshot: pinned CIDs (visibility only — never auto-fetched, this
// machine's disk budget is the user's own to spend) + followed peers
// (auto-merged, no disk cost). Published to IPFS directly via the fsModule
// (NOT through publishContent — a device-state snapshot is not a public feed
// post), then announced as a CID pointer, mirroring cluster-updater.js. ──

async function publishStateSnapshot() {
  if (!_ipfs) throw new Error("Device sync not initialized");
  const mySoul = await getOwnSoulSafe();
  if (!mySoul || !mySoul.soulId) throw new Error("Local soul identity unavailable");

  const fsModule = _ipfs.getFsModule();
  if (!fsModule) throw new Error("IPFS filesystem module unavailable");

  // "Locally available content" is two distinct registries in ipfs-node.js:
  // explicitly pinContent()-ed CIDs (other peers' content this node chose to
  // host, tracked in pinnedFiles/getStorageStats) and this node's OWN
  // published posts (already resident in its blockstore from publishContent,
  // but NOT added to pinnedFiles — that registry is for explicit pin actions
  // only). A device-state snapshot should surface both, since both are
  // genuinely fetchable from this device right now.
  const myPeerId = heliaNode.libp2p.peerId.toString();
  const explicitlyPinned = _ipfs.getStorageStats().pinnedItems.map((i) => ({ cid: i.cid, name: i.name, size: i.size }));
  const ownPosts = _ipfs.getFeed({ clusterOnly: false })
    .filter((p) => p.peerId === myPeerId)
    .map((p) => ({ cid: p.cid, name: p.metadata?.name, size: p.metadata?.size }));
  const seenCids = new Set();
  const pinnedCids = [...explicitlyPinned, ...ownPosts].filter((i) => (seenCids.has(i.cid) ? false : (seenCids.add(i.cid), true)));

  const snapshot = {
    soulId: mySoul.soulId,
    timestamp: Date.now(),
    pinnedCids,
    followedPeers: _ipfs.getFollowing(),
  };

  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const cid = await fsModule.addBytes(bytes);
  const cidStr = cid.toString();

  const payload = canonicalStatePayload(mySoul.soulId, cidStr, snapshot.timestamp);
  const signRes = await agentPost("/api/v1/soul/sign", { payload });
  if (!signRes || !signRes.ok) throw new Error("Signing failed (agent server unreachable?)");

  const announcement = { soulId: mySoul.soulId, cid: cidStr, timestamp: snapshot.timestamp, signature: signRes.signature };
  peerStatePointers.set(mySoul.soulId, { cid: cidStr, timestamp: snapshot.timestamp });
  persist();

  if (gossip) {
    const data = new TextEncoder().encode(JSON.stringify({ type: "devicestate", announcement }));
    try { await gossip.publish(DEVICE_STATE_TOPIC, data); }
    catch (e) { console.error("[DeviceSync] Failed to gossip state announcement:", e.message); }
  }

  console.log(`[DeviceSync] Published state snapshot: ${cidStr} (${snapshot.pinnedCids.length} pins, ${snapshot.followedPeers.length} follows)`);
  return { ok: true, cid: cidStr };
}

async function handleStateMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    if (data.type !== "devicestate" || !data.announcement) return;
    const a = data.announcement;
    if (!a.soulId || !a.cid || !a.timestamp || !a.signature) return;

    const mySoul = await getOwnSoulSafe();
    if (!mySoul || !isLinkedDevice(a.soulId, mySoul.soulId)) return; // only linked devices' state is trusted

    const payload = canonicalStatePayload(a.soulId, a.cid, a.timestamp);
    // [Trust] Fail-closed: reject if we have no registered public key for the sender.
    const stateSenderPubKey = getPeerKey(a.soulId);
    if (!stateSenderPubKey) {
      console.warn(`[Trust] No public key registered for ${a.soulId.slice(0, 16)}... — rejecting state announcement (fail-closed)`);
      return;
    }
    if (!verifyEd25519(stateSenderPubKey, payload, a.signature)) {
      console.warn(`[DeviceSync] Dropped state announcement with bad signature from ${a.soulId.slice(0, 16)}...`);
      return;
    }

    const existing = peerStatePointers.get(a.soulId);
    if (existing && existing.timestamp >= a.timestamp) return; // not newer
    peerStatePointers.set(a.soulId, { cid: a.cid, timestamp: a.timestamp });
    persist();

    await mergeStateSnapshot(a.soulId, a.cid, a.timestamp);
  } catch (e) {
    console.error("[DeviceSync] Failed to handle state message:", e.message);
  }
}

/** Pull a linked device's snapshot and merge the safe (no-disk-cost) parts.
 * Followed peers are merged automatically; pinned CIDs are only exposed via
 * getSyncedPins() for the user to explicitly pin (never auto-fetched — pin
 * fetches the full content and this machine's disk is not ours to spend). */
async function mergeStateSnapshot(soulId, cidStr, timestamp) {
  if (!_ipfs) return;
  try {
    const bytes = await _ipfs.getContent(cidStr);
    const snapshot = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (snapshot.soulId !== soulId) {
      console.warn(`[DeviceSync] Snapshot soulId mismatch (expected ${soulId.slice(0, 16)}..., content says ${snapshot.soulId}) — ignoring`);
      return;
    }

    for (const peerId of snapshot.followedPeers || []) {
      try { _ipfs.followPeer(peerId); } catch (_) { /* best-effort */ }
    }

    lastAppliedTimestamp.set(soulId, timestamp);
    console.log(`[DeviceSync] Merged state from linked device ${soulId.slice(0, 16)}... (${(snapshot.followedPeers || []).length} follows merged, ${(snapshot.pinnedCids || []).length} pins available)`);
  } catch (e) {
    console.error(`[DeviceSync] Failed to fetch/merge snapshot ${cidStr}:`, e.message);
  }
}

/** Pinned-CID references known from linked devices' snapshots, NOT auto-
 * fetched — the UI/user decides whether to actually cluster-pin any of these
 * locally (via the existing pinContent/cluster-pin flow). */
async function getSyncedPins() {
  const linked = await getLinkedDevices();
  const out = [];
  for (const soulId of linked) {
    const pointer = peerStatePointers.get(soulId);
    if (!pointer) continue;
    try {
      const bytes = await _ipfs.getContent(pointer.cid);
      const snapshot = JSON.parse(Buffer.from(bytes).toString("utf8"));
      for (const item of snapshot.pinnedCids || []) {
        out.push({ ...item, fromSoulId: soulId });
      }
    } catch (_) { /* snapshot not fetchable right now — skip */ }
  }
  return out;
}

// ── Lifecycle ──
function init(ipfsModule, helia, gossipSub) {
  _ipfs = ipfsModule;
  heliaNode = helia;
  gossip = gossipSub;

  const IPFS_DATA_DIR = path.join(app.getPath("userData"), "ipfs-data");
  fs.mkdirSync(IPFS_DATA_DIR, { recursive: true });
  DATA_FILE = path.join(IPFS_DATA_DIR, "device-sync.json");
  load();

  gossip.addEventListener("message", (evt) => {
    if (evt.detail.topic === DEVICE_LINK_TOPIC) handleLinkMessage(evt.detail);
    else if (evt.detail.topic === DEVICE_STATE_TOPIC) handleStateMessage(evt.detail);
  });
  gossip.subscribe(DEVICE_LINK_TOPIC);
  gossip.subscribe(DEVICE_STATE_TOPIC);

  _reannounceTimer = setInterval(() => {
    publishStateSnapshot().catch((e) => console.warn("[DeviceSync] Periodic snapshot publish failed:", e.message));
  }, STATE_REANNOUNCE_INTERVAL_MS);

  console.log(`[DeviceSync] Active. Link topic: ${DEVICE_LINK_TOPIC}, state topic: ${DEVICE_STATE_TOPIC}`);
}

function stop() {
  if (_reannounceTimer) {
    clearInterval(_reannounceTimer);
    _reannounceTimer = null;
  }
}

module.exports = {
  init,
  stop,
  initiateLinkDevice,
  getLinkedDevices,
  getPendingLinks,
  isLinkedDevice,
  publishStateSnapshot,
  getSyncedPins,
  DEVICE_LINK_TOPIC,
  DEVICE_STATE_TOPIC,
};

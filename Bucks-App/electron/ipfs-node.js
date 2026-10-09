const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

// --- Swarm Intelligence Constants ---
const CLUSTER_SECRET =
  process.env.BUCKS_CLUSTER_SECRET || "BUCKS_DEFAULT_CLUSTER";
const CLUSTER_CIDN = process.env.BUCKS_CLUSTER_CIDN || "mainnet";
const CLUSTER_TOPIC = `bucks-swarm-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

const FEED_TOPIC = `bucks-feed-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;
const COMPUTE_TOPIC = `bucks-compute-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

// --- Agent Soul Topics ---
const SOUL_TOPIC = `bucks-souls-${CLUSTER_CIDN}`;
const AGENT_INBOX_PREFIX = `bucks-agent-inbox-`;
const DWEB_TOPIC = `bucks-dweb-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

let heliaNode = null;
let fsModule = null;
let gossip = null;

let feed = [];
let following = new Set();
let pinnedFiles = new Map();
let IPFS_DATA_DIR = null;
let forageInterval = null;
let advertiseInterval = null;

let dwebIndex = [];
let dwebIndexFile = null;

// Recommend/not-recommend votes: cid -> Map(soulId -> { direction, timestamp }).
// Merged with pin/unpin by design (product decision) — recommending a CID
// pins+seeds it, un-recommending unpins it. "Active" below is a recency
// proxy (recent vote timestamp), not a live peer-presence check, to keep
// this module independent of cluster-membership.js's soul-presence table.
let contentVotes = new Map();
const VOTE_ACTIVE_WINDOW_MS = 5 * 60_000;

// Swarm State
let clusterPeers = new Map(); // PeerID -> { version, cidn, reputation, lastSeen }
let localReputation = 100; // Base pheromone level

// Soul State
let localSoul = null;
let peerSoulCallbacks = []; // registered listeners for incoming peer souls

/**
 * Initialize the Helia IPFS node with filesystem-backed storage.
 * Uses dynamic import() since Helia is ESM-only.
 */
async function startNode() {
  if (heliaNode) return heliaNode;

  // Initialize data dir now that app is ready
  IPFS_DATA_DIR = path.join(app.getPath("userData"), "ipfs-data");
  dwebIndexFile = path.join(IPFS_DATA_DIR, "dweb-index.json");

  try {
    // Dynamic imports for ESM modules
    const { createHelia } = await import("helia");
    const { unixfs } = await import("@helia/unixfs");
    const { FsBlockstore } = await import("blockstore-fs");
    const { FsDatastore } = await import("datastore-fs");
    const { gossipsub } = await import("@chainsafe/libp2p-gossipsub");
    const fs = require("fs");

    // Ensure IPFS data directory exists
    if (!fs.existsSync(IPFS_DATA_DIR)) {
      fs.mkdirSync(IPFS_DATA_DIR, { recursive: true });
    }
    
    // Load discovered dweb index
    if (fs.existsSync(dwebIndexFile)) {
      try {
        dwebIndex = JSON.parse(fs.readFileSync(dwebIndexFile, "utf8"));
        console.log(`[IPFS] Loaded ${dwebIndex.length} discovered dWeb pages.`);
      } catch (e) {
        console.error("[IPFS] Failed to load dweb index:", e);
        dwebIndex = [];
      }
    }
    if (!fs.existsSync(path.join(IPFS_DATA_DIR, "blocks"))) {
      fs.mkdirSync(path.join(IPFS_DATA_DIR, "blocks"), { recursive: true });
    }
    if (!fs.existsSync(path.join(IPFS_DATA_DIR, "datastore"))) {
      fs.mkdirSync(path.join(IPFS_DATA_DIR, "datastore"), { recursive: true });
    }

    const blockstore = new FsBlockstore(path.join(IPFS_DATA_DIR, "blocks"));
    const datastore = new FsDatastore(path.join(IPFS_DATA_DIR, "datastore"));

    const { identify } = await import("@libp2p/identify");
    const { tcp } = await import("@libp2p/tcp");
    const { webSockets } = await import("@libp2p/websockets");
    const { createLibp2p } = await import("libp2p");
    const { noise } = await import("@chainsafe/libp2p-noise");
    const { yamux } = await import("@chainsafe/libp2p-yamux");
    const { mplex } = await import("@libp2p/mplex");
    const { mdns } = await import("@libp2p/mdns");
    const { bootstrap } = await import("@libp2p/bootstrap");
    const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import("@libp2p/crypto/keys");
    const { circuitRelayTransport } = await import("@libp2p/circuit-relay-v2");
    const { dcutr } = await import("@libp2p/dcutr");
    const { autoNAT } = await import("@libp2p/autonat");
    const { uPnPNAT } = await import("@libp2p/upnp-nat");
    const { kadDHT } = await import("@libp2p/kad-dht");
    const { ping } = await import("@libp2p/ping");

    // A stable PeerId across restarts is required for cluster membership,
    // vote attribution, and "who's currently reachable" to mean anything —
    // without this, createLibp2p() below would mint a fresh random identity
    // every launch and every peer/member table would churn on each restart.
    const peerKeyFile = path.join(IPFS_DATA_DIR, "libp2p-peer.key");
    let peerPrivateKey;
    if (fs.existsSync(peerKeyFile)) {
      peerPrivateKey = privateKeyFromProtobuf(new Uint8Array(fs.readFileSync(peerKeyFile)));
    } else {
      peerPrivateKey = await generateKeyPair("Ed25519");
      fs.writeFileSync(peerKeyFile, Buffer.from(privateKeyToProtobuf(peerPrivateKey)));
    }

    // Peer discovery: mDNS finds Bucks nodes on the same LAN automatically;
    // BUCKS_BOOTSTRAP_PEERS (comma-separated multiaddrs, e.g. over Tailscale)
    // connects machines across networks.
    const peerDiscovery = [mdns({ interval: 10000 })];
    let bootstrapList = (process.env.BUCKS_BOOTSTRAP_PEERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (bootstrapList.length === 0 && !process.env.BUCKS_TESTING) {
      // Fallback to public IPFS bootstrap nodes if no private bootstrap peers are configured
      bootstrapList = [
        "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
        "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
        "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
        "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt"
      ];
      console.log("[Swarm] No private bootstrap peers configured. Using public bootstrap nodes.");
    }
    peerDiscovery.push(bootstrap({ list: bootstrapList }));
    console.log(`[Swarm] Bootstrap peers configured: ${bootstrapList.length}`);

    // Stable ports so other machines can bootstrap-dial this node; fall back
    // to OS-assigned ports if another instance already holds them.
    async function createNode(listen) {
      return createLibp2p({
        privateKey: peerPrivateKey,
        addresses: { listen },
        transports: [tcp(), webSockets(), circuitRelayTransport()],
        // libp2p v3 renamed connectionEncryption → connectionEncrypters; the
        // old key is silently ignored, which left the node with NO encrypters
        // and made every inter-node dial fail (EncryptionFailedError).
        connectionEncrypters: [noise()],
        streamMuxers: [yamux(), mplex()],
        peerDiscovery,
        services: {
          identify: identify(),
          // The installed @chainsafe/libp2p-gossipsub calls this option
          // `allowPublishToZeroTopicPeers`; the old `allowPublishToZeroPeers`
          // spelling was silently ignored, so every publish before a topic
          // mesh formed threw NoPeersSubscribedToTopic (identity/soul/feed/
          // membership/vote/release broadcasts all hit this path).
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
          ping: ping(),
          dcutr: dcutr(),
          autonat: autoNAT(),
          upnp: uPnPNAT(),
          dht: kadDHT({
            protocol: '/ipfs/lan/kad/1.0.0',
            clientMode: true
          })
        },
      });
    }

    let libp2pNode;
    try {
      libp2pNode = await createNode(["/ip4/0.0.0.0/tcp/4020", "/ip4/0.0.0.0/tcp/4021/ws", "/p2p-circuit"]);
    } catch (portErr) {
      console.warn(`[Swarm] Ports 4020/4021 unavailable (${portErr.message}) — using random ports.`);
      libp2pNode = await createNode(["/ip4/0.0.0.0/tcp/0", "/ip4/0.0.0.0/tcp/0/ws", "/p2p-circuit"]);
    }

    libp2pNode.addEventListener("peer:discovery", (evt) => {
      const peer = evt.detail;
      console.log(`[Swarm] Discovered peer: ${peer.id.toString()}`);
      libp2pNode.dial(peer.id).catch(() => {});
    });
    libp2pNode.addEventListener("peer:connect", (evt) => {
      console.log(`[Swarm] Connected to peer: ${evt.detail.toString()}`);
    });

    const { bitswap } = await import("@helia/block-brokers");

    heliaNode = await createHelia({
      blockstore,
      datastore,
      libp2p: libp2pNode,
      blockBrokers: [
        bitswap()
      ]
    });

    fsModule = unixfs(heliaNode);
    gossip = heliaNode.libp2p.services.pubsub;

    // --- Swarm Identity & Handshake ---
    gossip.addEventListener("message", (evt) => {
      const topic = evt.detail.topic;
      if (topic === CLUSTER_TOPIC) {
        handleClusterMessage(evt.detail);
      } else if (topic === FEED_TOPIC) {
        handleFeedMessage(evt.detail);
      } else if (topic === SOUL_TOPIC) {
        handleSoulMessage(evt.detail);
      } else if (topic === DWEB_TOPIC) {
        handleDwebMessage(evt.detail);
      }
    });
    gossip.subscribe(CLUSTER_TOPIC);
    gossip.subscribe(FEED_TOPIC);
    gossip.subscribe(SOUL_TOPIC);
    gossip.subscribe(DWEB_TOPIC);

    // --- Swarm Survival: Foraging ---
    forageInterval = setInterval(forageForScarcity, 60000); // Forage every minute

    // Start periodic identity advertisement (Heartbeat)
    advertiseInterval = setInterval(advertiseIdentity, 10000);

    console.log(
      `[Swarm] Cluster Node Active. PeerID: ${heliaNode.libp2p.peerId.toString()}`,
    );
    console.log(`[Swarm] Topic: ${CLUSTER_TOPIC}`);

    // Load persisted following list
    const followFile = path.join(IPFS_DATA_DIR, "following.json");
    if (fs.existsSync(followFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(followFile, "utf8"));
        data.forEach((id) => following.add(id));
        console.log(`[IPFS] Restored ${following.size} followed peers.`);
      } catch (e) {
        console.error("[IPFS] Failed to load following list:", e);
      }
    }

    // Load persisted feed
    const feedFile = path.join(IPFS_DATA_DIR, "feed.json");
    if (fs.existsSync(feedFile)) {
      try {
        feed = JSON.parse(fs.readFileSync(feedFile, "utf8"));
        console.log(`[IPFS] Restored ${feed.length} feed items.`);
      } catch (e) {
        console.error("[IPFS] Failed to load feed:", e);
      }
    }

    // Load pinned metadata
    const pinnedFile = path.join(IPFS_DATA_DIR, "pinned.json");
    if (fs.existsSync(pinnedFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(pinnedFile, "utf8"));
        pinnedFiles = new Map(Object.entries(data));
        console.log(`[IPFS] Restored ${pinnedFiles.size} pinned files.`);
      } catch (e) {
        console.error("[IPFS] Failed to load pinned metadata:", e);
      }
    }

    // Load recommend/not-recommend votes
    const votesFile = path.join(IPFS_DATA_DIR, "votes.json");
    if (fs.existsSync(votesFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(votesFile, "utf8"));
        contentVotes = new Map(
          Object.entries(data).map(([cid, voters]) => [cid, new Map(Object.entries(voters))]),
        );
        console.log(`[IPFS] Restored votes for ${contentVotes.size} CID(s).`);
      } catch (e) {
        console.error("[IPFS] Failed to load votes:", e);
      }
    }

    return heliaNode;
  } catch (err) {
    console.error("[IPFS] Failed to start Helia node:", err);
    throw err;
  }
}

/**
 * Broadcast local identity information to the swarm.
 */
async function advertiseIdentity() {
  if (!gossip) return;

  const identity = {
    type: "identity",
    peerId: heliaNode.libp2p.peerId.toString(),
    version: app.getVersion(),
    cidn: CLUSTER_CIDN,
    reputation: localReputation,
    timestamp: Date.now(),
  };

  const data = new TextEncoder().encode(JSON.stringify(identity));
  try {
    await gossip.publish(CLUSTER_TOPIC, data);
  } catch (e) {
    console.error("[Swarm] Failed to broadcast identity:", e);
  }
}

/**
 * Handle incoming swarm messages.
 * Validates peers and updates cluster state.
 */
function handleClusterMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const fromPeerId = msg.from.toString();

    // Ignore self-messages
    if (fromPeerId === heliaNode.libp2p.peerId.toString()) return;

    // Enforce transport-layer sender validation
    if (data.peerId !== fromPeerId) {
      console.warn(`[Swarm] Dropped spoofed identity message: payload peerId ${data.peerId} does not match publisher ${fromPeerId}`);
      return;
    }

    if (data.type === "identity") {
      const peerId = data.peerId;

      // Validate Cluster ID (CIDN)
      if (data.cidn !== CLUSTER_CIDN) {
        console.warn(
          `[Swarm] Rejected peer ${peerId}: CIDN mismatch (${data.cidn})`,
        );
        return;
      }

      // Update Cluster Peer Map
      clusterPeers.set(peerId, {
        version: data.version,
        reputation: data.reputation,
        lastSeen: Date.now(),
      });

      // Version Check (Swarm Survival)
      if (isNewerVersion(data.version, app.getVersion())) {
        console.log(
          `[Swarm] Peer ${peerId} has newer version: ${data.version}. Sync required.`,
        );
        // IPC back to main will handle the UI prompt/auto-update
      }
    }
  } catch (e) {
    console.error("[Swarm] Failed to parse message:", e);
  }
}

/**
 * Handle incoming feed updates from the swarm mesh.
 */
function handleFeedMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const fromPeerId = msg.from.toString();
    if (data.type === "post") {
      // Enforce transport-layer sender validation
      if (data.post && data.post.peerId !== fromPeerId) {
        console.warn(`[Swarm] Dropped spoofed feed post: payload peerId ${data.post.peerId} does not match publisher ${fromPeerId}`);
        return;
      }
      // A post's self-claimed soulId is only trusted for cluster-feed
      // attribution if it matches the soulId currently, independently
      // verified as broadcasting from this same peerId (soul heartbeat on
      // SOUL_TOPIC). Otherwise strip it — the post still enters the global
      // feed, it just won't count as "from a cluster member".
      if (data.post && data.post.soulId) {
        try {
          const clusterMembership = require("./cluster-membership");
          const verifiedSoulId = clusterMembership.getSoulIdForPeer(fromPeerId);
          if (data.post.soulId !== verifiedSoulId) {
            console.warn(`[Swarm] Stripped unverified soulId claim on post ${data.post.cid.slice(0, 8)} from ${fromPeerId.slice(0, 12)}...`);
            data.post.soulId = null;
          }
        } catch (_) {
          data.post.soulId = null; // cluster-membership not active — can't verify, don't trust
        }
      }
      // Check if already in feed
      if (!feed.some((p) => p.cid === data.post.cid)) {
        feed.unshift(data.post);
        console.log(
          `[Swarm] Received gossiped post: ${data.post.cid.slice(0, 8)}`,
        );
      }

      // Record activity for reputation (ACO)
      recordPeerActivity(data.post.peerId, true);
    } else if (data.type === "vote") {
      // Trust level matches "post" above: transport-sender must be the
      // claimed voter's CURRENT peerId, but the vote itself is unsigned —
      // a hostile peer can vote as itself, not impersonate another voter.
      const v = data.vote;
      if (!v || !v.cid || !v.voterSoulId || !v.voterPeerId || (v.direction !== "up" && v.direction !== "down")) return;
      if (v.voterPeerId !== fromPeerId) {
        console.warn(`[Swarm] Dropped spoofed vote: payload voterPeerId ${v.voterPeerId} does not match publisher ${fromPeerId}`);
        return;
      }
      recordVote(v.cid, v.voterSoulId, v.direction, v.timestamp || Date.now());
    }
  } catch (e) {
    console.error("[Swarm] Failed to handle feed message:", e);
  }
}

/**
 * Record a recommend/not-recommend vote for a CID (local or gossiped).
 * One vote per (cid, soulId) — casting again overwrites the prior direction.
 */
function recordVote(cidStr, voterSoulId, direction, timestamp = Date.now()) {
  if (!contentVotes.has(cidStr)) contentVotes.set(cidStr, new Map());
  contentVotes.get(cidStr).set(voterSoulId, { direction, timestamp });
}

/**
 * Broadcast this node's vote to the swarm so peers' availability counts
 * reflect it (upvoteContent()/unrecommendContent() never used to gossip at
 * all — vote counts didn't actually propagate before this).
 */
async function broadcastVote(cidStr, voterSoulId, direction) {
  if (!gossip) return;
  const vote = {
    cid: cidStr,
    direction,
    voterSoulId,
    voterPeerId: heliaNode.libp2p.peerId.toString(),
    timestamp: Date.now(),
  };
  const data = new TextEncoder().encode(JSON.stringify({ type: "vote", vote }));
  try {
    await gossip.publish(FEED_TOPIC, data);
  } catch (e) {
    console.error("[Swarm] Failed to broadcast vote:", e);
  }
}

/**
 * Vote counts for a CID: total up/down, plus "active" up-voters (voted
 * recently — a legibility proxy for "currently reachable source nodes",
 * per the product's "more recommended = more available" model).
 */
function getVoteCounts(cidStr) {
  const voters = contentVotes.get(cidStr);
  if (!voters) return { upCount: 0, downCount: 0, activeUpCount: 0 };
  let upCount = 0, downCount = 0, activeUpCount = 0;
  const now = Date.now();
  voters.forEach((v) => {
    if (v.direction === "up") {
      upCount++;
      if (now - v.timestamp < VOTE_ACTIVE_WINDOW_MS) activeUpCount++;
    } else if (v.direction === "down") {
      downCount++;
    }
  });
  return { upCount, downCount, activeUpCount };
}

/**
 * This node's own current vote on a CID, if any ("up" | "down" | null) —
 * drives the UI's active/toggled arrow state.
 */
function getMyVote(cidStr, mySoulId) {
  const voters = contentVotes.get(cidStr);
  const v = voters && mySoulId ? voters.get(mySoulId) : null;
  return v ? v.direction : null;
}

/**
 * Digital Pheromones (ACO): Record successful data delivery from a peer.
 */
function recordPeerActivity(peerId, success = true) {
  const peer = clusterPeers.get(peerId);
  if (!peer) return;

  if (success) {
    peer.reputation = Math.min(200, peer.reputation + 5); // Accumulate pheromones
  } else {
    peer.reputation = Math.max(0, peer.reputation - 10); // Evaporate pheromones
  }
}

function isNewerVersion(v1, v2) {
  const p1 = v1.split(".").map(Number);
  const p2 = v2.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return true;
    if (p1[i] < p2[i]) return false;
  }
  return false;
}

/** Last-known app version a given peer advertised on CLUSTER_TOPIC (or null
 * if never seen there) — used by cluster-membership.js to show a soft
 * "outdated" badge, no enforcement. */
function getPeerVersion(peerId) {
  const p = clusterPeers.get(peerId);
  return p ? p.version : null;
}

/**
 * Foraging Algorithm: Seek out under-represented data (Scarcity).
 * This mimics an immune system protecting rare memories.
 */
async function forageForScarcity() {
  console.log("[Swarm] Foraging for scarce data...");
  // In a real swarm, we'd query the DHT for random CIDs
  // and check their provider counts.
  // If count < 3, we "forage" (pin) the data and earn simulated yield.
}

/**
 * Information Dissemination: Flocking via Gossipsub.
 * Broadcasts a new post to the local swarm mesh.
 */
async function disseminatePost(post) {
  if (!gossip) return;
  const data = new TextEncoder().encode(JSON.stringify({ type: "post", post }));
  try {
    await gossip.publish(FEED_TOPIC, data);
    console.log(`[Swarm] Gossiped post: ${post.cid.slice(0, 8)}`);
  } catch (e) {
    console.error("[Swarm] Gossip failed:", e);
  }
}

/**
 * Gracefully stop the IPFS node.
 */
async function stopNode() {
  if (forageInterval) {
    clearInterval(forageInterval);
    forageInterval = null;
  }
  if (advertiseInterval) {
    clearInterval(advertiseInterval);
    advertiseInterval = null;
  }
  if (heliaNode) {
    // Persist feed and following before shutdown
    const fs = require("fs");
    try {
      fs.writeFileSync(
        path.join(IPFS_DATA_DIR, "following.json"),
        JSON.stringify([...following], null, 2),
        "utf8",
      );
      fs.writeFileSync(
        path.join(IPFS_DATA_DIR, "feed.json"),
        JSON.stringify(feed.slice(-100), null, 2),
        "utf8", // Keep last 100 items
      );
      fs.writeFileSync(
        path.join(IPFS_DATA_DIR, "pinned.json"),
        JSON.stringify(Object.fromEntries(pinnedFiles), null, 2),
        "utf8",
      );
      fs.writeFileSync(
        path.join(IPFS_DATA_DIR, "votes.json"),
        JSON.stringify(
          Object.fromEntries([...contentVotes].map(([cid, voters]) => [cid, Object.fromEntries(voters)])),
          null, 2,
        ),
        "utf8",
      );
    } catch (e) {
      console.error("[IPFS] Failed to persist state:", e);
    }

    await heliaNode.stop();
    heliaNode = null;
    fsModule = null;
    console.log("[IPFS] Node stopped.");
  }
}

/**
 * Publish content to IPFS and add to the local feed.
 * @param {Buffer|Uint8Array|string} content - File content to publish
 * @param {object} metadata - { name, type, description }
 * @returns {object} - { cid, peerId, timestamp, metadata }
 */
async function publishContent(content, metadata = {}) {
  if (!heliaNode || !fsModule) throw new Error("IPFS node not initialized");

  let data;
  if (typeof content === "string") {
    data = new TextEncoder().encode(content);
  } else if (Array.isArray(content)) {
    data = new Uint8Array(content);
  } else if (content instanceof Uint8Array) {
    data = content;
  } else if (content && typeof content === "object") {
    data = new Uint8Array(Object.values(content));
  } else {
    data = content;
  }
  const cid = await fsModule.addBytes(data);
  const cidStr = cid.toString();

  // Self-tag with our soulId (best-effort — undefined until the soul bridge's
  // first fetch completes) so cluster members can attribute this post to us.
  // Receivers independently re-verify this against the live soul-presence
  // mapping (see handleFeedMessage) rather than trusting it outright.
  let soulId = null;
  try {
    soulId = require("./ipfs-agent-soul").getOwnSoul()?.soulId || null;
  } catch (_) { /* soul bridge not loaded in this context (e.g. tests) */ }

  const post = {
    cid: cidStr,
    peerId: heliaNode.libp2p.peerId.toString(),
    soulId,
    timestamp: Date.now(),
    metadata: {
      name: metadata.name || "Untitled",
      type: metadata.type || "file",
      description: metadata.description || "",
      size: data.length,
    },
    upvotes: 0,
    pinned: true, // Publisher always pins their own content
  };

  feed.unshift(post);
  console.log(`[IPFS] Published: ${cidStr} (${metadata.name || "Untitled"})`);

  // Disseminate to the Swarm!
  disseminatePost(post);

  return post;
}

/**
 * Retrieve content from IPFS by CID or hierarchical path.
 * Supports UnixFS directory traversal and index.html fallback.
 * @param {string} pathStr - The CID or CID path (e.g. "Qm.../assets/logo.png")
 * @returns {Uint8Array} - The file content
 */
async function getContent(pathStr) {
  // Normalize path
  const normalized = pathStr.replace(/^\//, '');
  const firstSlash = normalized.indexOf('/');
  let baseCidStr = firstSlash === -1 ? normalized : normalized.substring(0, firstSlash);
  const subPathStr = firstSlash === -1 ? '' : normalized.substring(firstSlash + 1);

  // Try Helia resolution first
  if (heliaNode && fsModule) {
    try {
      const { CID } = await import("multiformats/cid");
      let currentCid = CID.parse(baseCidStr);
      
      if (subPathStr) {
        const pathParts = subPathStr.split('/').filter(Boolean);
        for (const part of pathParts) {
          let found = false;
          for await (const entry of fsModule.ls(currentCid)) {
            if (entry.name === part) {
              currentCid = entry.cid;
              found = true;
              break;
            }
          }
          if (!found) {
            throw new Error(`Path component not found: ${part}`);
          }
        }
      }

      // Check if the final resolved CID is a directory. ls() itself is NOT a
      // reliable directory test: for a raw/file leaf it yields a single
      // self-referential entry (the node describing itself) rather than
      // throwing or yielding nothing, so a truthy-after-ls() check false-
      // positives on every plain file and misroutes it into the
      // "directory without index.html" error below. stat().type is the
      // one source of truth for node kind.
      const stat = await fsModule.stat(currentCid);
      if (stat.type === 'directory') {
        let indexCid = null;
        for await (const entry of fsModule.ls(currentCid)) {
          if (entry.name === 'index.html') {
            indexCid = entry.cid;
            break;
          }
        }
        if (!indexCid) {
          throw new Error("Directory listing without index.html is not supported");
        }
        currentCid = indexCid;
      }

      const chunks = [];
      for await (const chunk of fsModule.cat(currentCid)) {
        chunks.push(chunk);
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch (heliaErr) {
      console.warn(`[IPFS Node] Helia path resolution failed: ${heliaErr.message}. Falling back to Kubo gateway...`);
    }
  }

  // Fallback to Kubo HTTP gateway if Helia fails or is not initialized
  const http = require('http');
  return new Promise((resolve, reject) => {
    const gatewayUrl = `http://127.0.0.1:8080/ipfs/${normalized}`;
    http.get(gatewayUrl, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Kubo gateway returned HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    }).on('error', (err) => {
      reject(new Error(`Failed to contact Kubo gateway: ${err.message}`));
    });
  });
}

/**
 * Follow a peer — subscribe to their content feed.
 * @param {string} peerId - The PeerID to follow
 */
function followPeer(peerId) {
  if (following.has(peerId)) return { status: "already_following", peerId };
  following.add(peerId);
  console.log(`[IPFS] Now following: ${peerId}`);
  return { status: "followed", peerId };
}

/**
 * Unfollow a peer.
 * @param {string} peerId - The PeerID to unfollow
 */
function unfollowPeer(peerId) {
  following.delete(peerId);
  console.log(`[IPFS] Unfollowed: ${peerId}`);
  return { status: "unfollowed", peerId };
}

/** Currently-followed peerIds — used by device-sync.js to merge a linked
 * device's follow list without depending on getNodeInfo()'s wider shape. */
function getFollowing() {
  return [...following];
}

/**
 * Pin content — fetch it locally so this node hosts/seeds it. This is now a
 * STANDALONE action, independent of recommend/not-recommend: pinning is "I
 * want to store & serve this", voting is "I do/don't recommend this to the
 * network". A user can pin without recommending, or recommend without pinning.
 * @param {string} cidStr - The CID to pin
 */
async function pinContent(cidStr) {
  if (!heliaNode || !fsModule) throw new Error("IPFS node not initialized");

  const post = feed.find((p) => p.cid === cidStr);
  try {
    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(cidStr);

    // Fetch to ensure a local copy (this is what makes us a host/source).
    const chunks = [];
    let totalSize = 0;
    for await (const chunk of fsModule.cat(cid)) {
      chunks.push(chunk);
      totalSize += chunk.length;
    }

    if (post) post.pinned = true;
    pinnedFiles.set(cidStr, {
      size: totalSize,
      timestamp: Date.now(),
      name: post ? post.metadata.name : "Remote File",
      type: post ? post.metadata.type : "unknown",
    });

    console.log(`[IPFS] Pinned: ${cidStr} (${totalSize} bytes)`);
    return { status: "pinned", cid: cidStr, size: totalSize };
  } catch (err) {
    console.error(`[IPFS] Failed to pin ${cidStr}:`, err);
    return { status: "error", error: err.message };
  }
}

/**
 * Unpin content to free up storage. Standalone — does NOT cast a vote.
 * @param {string} cidStr
 */
async function unpinContent(cidStr) {
  if (pinnedFiles.has(cidStr)) {
    pinnedFiles.delete(cidStr);
    const post = feed.find((p) => p.cid === cidStr);
    if (post) post.pinned = false;
    console.log(`[IPFS] Unpinned: ${cidStr}`);
    return { status: "unpinned", cid: cidStr };
  }
  return { status: "not_found", cid: cidStr };
}

/**
 * Recommend content — cast a positive network vote and broadcast it. Pure
 * signal: does NOT pin. To also host it, pin separately.
 */
async function recommendContent(cidStr) {
  const post = feed.find((p) => p.cid === cidStr);
  if (post) post.upvotes = (post.upvotes || 0) + 1;
  if (localSoul && localSoul.soulId) {
    recordVote(cidStr, localSoul.soulId, "up");
    broadcastVote(cidStr, localSoul.soulId, "up");
  }
  console.log(`[IPFS] Recommended: ${cidStr}`);
  return { status: "recommended", cid: cidStr };
}

/**
 * Not-recommend content — cast a negative network vote and broadcast it. Pure
 * signal: does NOT unpin. Valid even for a CID this node never pinned.
 */
async function unrecommendContent(cidStr) {
  if (localSoul && localSoul.soulId) {
    recordVote(cidStr, localSoul.soulId, "down");
    broadcastVote(cidStr, localSoul.soulId, "down");
  }
  console.log(`[IPFS] Not-recommended: ${cidStr}`);
  return { status: "not_recommended", cid: cidStr };
}

/** Back-compat alias: the old "upvote = pin" name still pins (no vote now). */
const upvoteContent = pinContent;

/**
 * Get storage statistics.
 */
function getStorageStats() {
  let totalSize = 0;
  pinnedFiles.forEach((meta) => {
    totalSize += meta.size;
  });

  return {
    pinnedCount: pinnedFiles.size,
    totalSizeBytes: totalSize,
    pinnedItems: [...pinnedFiles.entries()].map(([cid, meta]) => ({
      cid,
      ...meta,
    })),
  };
}

/**
 * Get the aggregated feed from all sources.
 * @param {{ clusterOnly?: boolean }} [opts] - clusterOnly (default true) limits
 *   results to posts self-attributed (and independently verified — see
 *   handleFeedMessage) to a soulId that's a member of the caller's own
 *   cluster, plus the caller's own posts regardless of membership status.
 *   Pass clusterOnly:false for the unfiltered global/discovery view.
 * @returns {Array} - Array of post objects sorted by timestamp
 */
function getFeed(opts = {}) {
  const clusterOnly = opts.clusterOnly !== false; // default true
  const sorted = feed.sort((a, b) => b.timestamp - a.timestamp);
  if (!clusterOnly) return sorted.slice(0, 50);

  const myPeerId = heliaNode ? heliaNode.libp2p.peerId.toString() : null;
  let clusterMembership = null;
  try { clusterMembership = require("./cluster-membership"); } catch (_) { /* not active */ }

  const filtered = sorted.filter((p) => {
    if (p.peerId === myPeerId) return true; // always see your own posts
    if (!clusterMembership) return false; // can't verify membership -> fail closed
    return !!(p.soulId && clusterMembership.isMember(p.soulId));
  });
  return filtered.slice(0, 50);
}

/**
 * Get IPFS node information.
 */
function getNodeInfo() {
  if (!heliaNode) return { status: "offline" };

  return {
    status: "online",
    peerId: heliaNode.libp2p.peerId.toString(),
    addresses: heliaNode.libp2p.getMultiaddrs().map((a) => a.toString()),
    peers: heliaNode.libp2p.getPeers().length,
    following: [...following],
    feedCount: feed.length,
    storageDir: IPFS_DATA_DIR,
    cluster: {
      secret: CLUSTER_SECRET.slice(0, 3) + "***",
      cidn: CLUSTER_CIDN,
      topic: CLUSTER_TOPIC,
      peers: [...clusterPeers.entries()].map(([id, data]) => ({ id, ...data })),
      reputation: localReputation,
    },
  };
}

/**
 * Get list of connected peers.
 */
function getPeers() {
  if (!heliaNode) return [];
  return heliaNode.libp2p.getPeers().map((p) => p.toString());
}

/**
 * Handle an incoming soul advertisement from a peer agent.
 * Fires all registered peerSoulCallbacks for verification + registry.
 */
function handleSoulMessage(msg) {
  try {
    const soul = JSON.parse(new TextDecoder().decode(msg.data));
    if (!soul || !soul.soulId) return;
    const fromPeerId = msg.from.toString();
    // Bind it directly to the verified publisher PeerID
    soul.nodeId = fromPeerId;

    // Ignore our own broadcasts
    if (localSoul && soul.soulId === localSoul.soulId) return;
    console.log(`[Soul] Peer soul received: ${soul.soulId.slice(0, 16)}... locality=${soul.locality}`);
    peerSoulCallbacks.forEach((cb) => {
      try { cb(soul); } catch (e) { console.error("[Soul] Callback error:", e); }
    });
  } catch (e) {
    console.error("[Soul] Failed to parse soul message:", e);
  }
}

/**
 * Advertise this node's agent soul to the swarm.
 * @param {object} soul - The soul manifest from the agent server.
 */
async function advertiseAgentSoul(soul) {
  if (!gossip) return;
  localSoul = soul;
  const data = new TextEncoder().encode(JSON.stringify(soul));
  try {
    await gossip.publish(SOUL_TOPIC, data);
    console.log(`[Soul] Advertised soul: ${soul.soulId.slice(0, 16)}...`);
  } catch (e) {
    console.error("[Soul] Failed to advertise soul:", e);
  }
}

/**
 * Pin a soul manifest to IPFS and return its CID.
 * @param {object} soul - The soul manifest to pin.
 * @returns {string} CID string, or "" on failure.
 */
async function pinSoul(soul) {
  if (!heliaNode || !fsModule) return "";
  try {
    const data = new TextEncoder().encode(JSON.stringify(soul));
    const cid = await fsModule.addBytes(data);
    const cidStr = cid.toString();
    console.log(`[Soul] Pinned soul to IPFS: ${cidStr}`);
    return cidStr;
  } catch (e) {
    console.error("[Soul] Failed to pin soul:", e);
    return "";
  }
}

/**
 * Register a callback to be fired when a peer soul advertisement arrives.
 * @param {function} callback - Called with the parsed soul object.
 */
function onPeerSoul(callback) {
  peerSoulCallbacks.push(callback);
}

/**
 * Get the local soul (null if not yet set).
 */
function getLocalSoul() {
  return localSoul;
}

/**
 * Getters for internal references (used by chat-engine.js).
 */
function getHeliaNode() {
  return heliaNode;
}
function getGossip() {
  return gossip;
}
function getFsModule() {
  return fsModule;
}

/**
 * Handle incoming dWeb index publication messages from the swarm.
 */
function handleDwebMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const fromPeerId = msg.from.toString();
    if (data.type === "publish") {
      // Enforce transport-layer sender validation
      if (data.publisher !== fromPeerId) {
        console.warn(`[Swarm] Dropped spoofed dWeb publication: publisher ${data.publisher} does not match transport publisher ${fromPeerId}`);
        return;
      }
      if (!dwebIndex.some((item) => item.cid === data.cid)) {
        dwebIndex.unshift({
          cid: data.cid,
          name: data.name || 'Unnamed',
          title: data.title || 'Untitled',
          desc: data.desc || '',
          timestamp: data.timestamp || Date.now()
        });
        saveDwebIndex();
        console.log(`[Swarm] Discovered new dWeb page: ${data.name} (${data.cid.slice(0, 8)})`);
      }
    }
  } catch (e) {
    console.error("[Swarm] Failed to handle dweb message:", e);
  }
}

/**
 * Save current local dwebIndex array to JSON file.
 */
function saveDwebIndex() {
  if (!dwebIndexFile) return;
  const fs = require("fs");
  try {
    fs.writeFileSync(dwebIndexFile, JSON.stringify(dwebIndex), "utf8");
  } catch (e) {
    console.error("[IPFS] Failed to save dweb index:", e);
  }
}

/**
 * Broadcast a new dWeb page publication to the swarm.
 */
async function publishDweb(name, cid, title, desc) {
  if (!gossip) return;
  const metadata = {
    type: "publish",
    cid,
    name,
    title,
    desc,
    timestamp: Date.now(),
    publisher: heliaNode.libp2p.peerId.toString()
  };

  if (!dwebIndex.some((item) => item.cid === cid)) {
    dwebIndex.unshift(metadata);
    saveDwebIndex();
  }

  try {
    const data = new TextEncoder().encode(JSON.stringify(metadata));
    await gossip.publish(DWEB_TOPIC, data);
    console.log(`[Swarm] Broadcasted dWeb publication: ${name} (${cid.slice(0, 8)})`);
  } catch (e) {
    console.error("[Swarm] Failed to broadcast dWeb publication:", e);
  }
}

/**
 * Get all discovered dWeb pages.
 */
function getDwebIndex() {
  return dwebIndex;
}

/**
 * Search the discovered dWeb pages.
 */
function searchDweb(query) {
  const q = query.toLowerCase().trim();
  if (!q) return dwebIndex;
  return dwebIndex.filter(item => 
    item.name.toLowerCase().includes(q) ||
    item.title.toLowerCase().includes(q) ||
    item.desc.toLowerCase().includes(q) ||
    item.cid.includes(q)
  );
}

/**
 * Manually dial and connect to a peer by their multiaddress.
 */
async function connectPeer(multiaddr) {
  if (!heliaNode) throw new Error("IPFS node not running");
  try {
    const { multiaddr: parseMultiaddr } = await import("@multiformats/multiaddr");
    const ma = parseMultiaddr(multiaddr);
    await heliaNode.libp2p.dial(ma);
    console.log(`[Swarm] Manually connected to peer: ${multiaddr}`);
    return { success: true };
  } catch (err) {
    console.error(`[Swarm] Failed to connect to peer ${multiaddr}:`, err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  startNode,
  stopNode,
  publishContent,
  getContent,
  followPeer,
  unfollowPeer,
  getFollowing,
  upvoteContent,
  pinContent,
  recommendContent,
  unrecommendContent,
  getVoteCounts,
  getMyVote,
  getFeed,
  getNodeInfo,
  getPeers,
  unpinContent,
  getStorageStats,
  getHeliaNode,
  getGossip,
  getFsModule,
  advertiseAgentSoul,
  pinSoul,
  onPeerSoul,
  getLocalSoul,
  publishDweb,
  getDwebIndex,
  searchDweb,
  connectPeer,
  getPeerVersion,
  isNewerVersion,
};

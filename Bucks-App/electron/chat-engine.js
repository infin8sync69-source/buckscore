/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   BUCKS BROWSER — Chat Engine                            ║
 * ║   E2E Encrypted P2P Messaging over IPFS Gossipsub        ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 * - Subscribe to chat gossipsub topic
 * - Encrypt/decrypt messages via signal-store
 * - Persist chat history locally
 * - Publish and process pre-key bundles for X3DH
 * - Notify renderer of incoming messages
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const signalStore = require("./signal-store");
const agentIntegration = require("./agent-integration");

// ─── Constants ───
const CLUSTER_SECRET =
  process.env.BUCKS_CLUSTER_SECRET || "BUCKS_DEFAULT_CLUSTER";
const CHAT_TOPIC = `bucks-chat-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;
const BUNDLE_TOPIC = `bucks-keys-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

let gossip = null;
let heliaNode = null;
let fsModule = null;
let localPeerId = null;
let CHAT_DATA_DIR = null;
let onMessageCallback = null;

// In-memory state
let peerBundles = new Map(); // peerId -> preKeyBundle
let peerVerified = new Map(); // peerId -> boolean (Ed25519 signed-pre-key verified)
let conversations = new Map(); // peerId -> { messages: [], unreadCount: number, lastMessage: string, lastTimestamp: string }

/**
 * Accept a peer bundle only if it isn't tampered. Rejects bundles whose signed
 * pre-key signature fails Ed25519 verification (active MITM); accepts verified
 * and legacy-unsigned bundles, recording which for the UI trust indicator.
 * @returns {boolean} whether the bundle was accepted/stored
 */
function acceptBundle(peerId, bundle) {
  const v = signalStore.verifyPreKeyBundle(bundle);
  if (!v.ok) {
    console.warn(`[Chat] Rejected bundle from ${peerId.substring(0, 8)}: ${v.reason}`);
    return false;
  }
  // Reject a signing-key swap: once we've verified a peer, its signingKey is
  // pinned (trust-on-first-use). A later bundle with a different key is an
  // impersonation attempt.
  const existing = peerBundles.get(peerId);
  if (peerVerified.get(peerId) && existing && existing.signingKey &&
      bundle.signingKey && bundle.signingKey !== existing.signingKey) {
    console.warn(`[Chat] Rejected bundle from ${peerId.substring(0, 8)}: signing key changed (possible impersonation)`);
    return false;
  }
  peerBundles.set(peerId, bundle);
  peerVerified.set(peerId, !!v.verified);
  return true;
}

/**
 * Initialize the chat engine.
 * @param {object} helia - Helia node instance
 * @param {object} gossipSub - Gossipsub instance
 * @param {object} unixfs - Helia UnixFS module
 */
async function initChat(helia, gossipSub, unixfs) {
  heliaNode = helia;
  gossip = gossipSub;
  fsModule = unixfs;
  localPeerId = helia.libp2p.peerId.toString();

  CHAT_DATA_DIR = path.join(
    app.getPath("userData"),
    "ipfs-data",
    "chat-history",
  );
  fs.mkdirSync(CHAT_DATA_DIR, { recursive: true });

  // Initialize Signal store (async: loads the PQC modules before returning)
  await signalStore.initStore();

  // Load persisted conversations
  loadConversations();

  // Subscribe to key exchange topic
  gossip.addEventListener("message", (evt) => {
    const topic = evt.detail.topic;
    if (topic === BUNDLE_TOPIC) {
      handleBundleMessage(evt.detail);
    }
  });

  gossip.subscribe(BUNDLE_TOPIC);

  // Exchange key bundles immediately upon peer connection. The gossipsub
  // mesh takes ~1 heartbeat to form after a fresh connection, so this first
  // publish can race mesh formation and get silently dropped (gossipsub
  // doesn't buffer/retry) — without a second attempt, two peers meeting for
  // the first time would otherwise wait for the unrelated 30s periodic
  // republish below before they could exchange keys at all.
  heliaNode.libp2p.addEventListener("peer:connect", (evt) => {
    console.log(`[Chat] Swarm connection established with peer: ${evt.detail.toString()}. Triggering bundle exchange.`);
    publishPreKeyBundle();
    setTimeout(publishPreKeyBundle, 2000);
  });

  // Register direct stream handler for E2E chat messages.
  // NOTE: the libp2p major in this repo's dependency tree has swapped
  // protocol-handler calling conventions mid-project (seen firsthand: v3
  // calls handler(stream, connection) positionally with an event-based
  // MessageStream that has no .source/.sink; v2 — what @chainsafe/
  // libp2p-gossipsub actually supports, see package.json — calls
  // handler({ stream, connection }) with the classic it-stream duplex). This
  // handles either shape instead of hard-coding the version installed today.
  heliaNode.libp2p.handle('/bucks/chat/1.0.0', async (arg1, arg2) => {
    const stream = arg1 && arg1.stream ? arg1.stream : arg1;
    const connection = arg1 && arg1.stream ? arg1.connection : arg2;
    try {
      const source = typeof stream.sink === 'function' && stream.source != null
        ? stream.source
        : (await import('@libp2p/utils')).messageStreamToDuplex(stream).source;
      const chunks = [];
      for await (const chunk of source) {
        let bytes;
        if (chunk instanceof Uint8Array) {
          bytes = chunk;
        } else if (chunk.subarray) {
          bytes = chunk.subarray();
        } else {
          bytes = new Uint8Array(chunk);
        }
        chunks.push(bytes);
      }
      const { concat, toString } = await import('uint8arrays');
      const allBytes = concat(chunks);
      const text = toString(allBytes);
      const data = JSON.parse(text);

      // Authenticity: `data.from` is a self-reported field inside the JSON
      // payload — it must match the noise-authenticated remote peer of this
      // very stream, or anyone we accept a connection from could claim to be
      // any other peerId (spoofing X3DH inits and chat messages alike).
      const remotePeerId = connection && connection.remotePeer ? connection.remotePeer.toString() : null;
      if (!remotePeerId || data.from !== remotePeerId) {
        console.warn(`[Chat] Dropped ${data.type || 'message'}: claimed from=${data.from} does not match authenticated stream peer ${remotePeerId}`);
        return;
      }

      if (data.type === "x3dh_init") {
        handleX3DHInit(data);
      } else if (data.type === "chat_message") {
        handleDirectChatMessage(data);
      }
    } catch (err) {
      console.error("[Chat] Error in direct stream handler:", err);
    }
  });

  // Initialize agent integration — only probe the :3000 experimental swarm
  // agent server when that layer is actually enabled (see main.js, gated
  // behind BUCKS_EXPERIMENTAL_SWARM=1); otherwise nothing listens there by
  // design and this would just log a guaranteed connection failure on every
  // chat-engine startup.
  if (process.env.BUCKS_EXPERIMENTAL_SWARM === '1') {
    await agentIntegration.checkAgentStatus();
  }

  // Broadcast our pre-key bundle periodically
  publishPreKeyBundle();
  setInterval(publishPreKeyBundle, 30000); // Every 30s

  console.log(`[Chat] Engine initialized (Direct E2E streams enabled).`);
  console.log(`[Chat] Key exchange topic: ${BUNDLE_TOPIC}`);
  console.log(
    `[Chat] Agent Integration ready. Current provider: ${agentIntegration.getAgentStatus().provider}`,
  );
}

// ─── Pre-Key Bundle Exchange ───

/**
 * Broadcast this node's pre-key bundle to the cluster.
 */
async function publishPreKeyBundle() {
  if (!gossip) return;

  const bundle = signalStore.getPreKeyBundle();
  const message = {
    type: "prekey_bundle",
    peerId: localPeerId,
    bundle: bundle,
    timestamp: Date.now(),
  };

  const data = new TextEncoder().encode(JSON.stringify(message));
  try {
    await gossip.publish(BUNDLE_TOPIC, data);
  } catch (e) {
    // Silently ignore publish errors (common when no peers)
  }
}

/**
 * Handle incoming pre-key bundle messages.
 */
function handleBundleMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    if (data.type !== "prekey_bundle") return;

    // Trust the gossipsub-verified publisher (msg.from), never the
    // self-reported data.peerId — otherwise any mesh peer can broadcast a
    // bundle claiming to be a soulId/peerId it doesn't own (see ipfs-node.js
    // for the same fromPeerId = msg.from.toString() pattern used elsewhere).
    const fromPeerId = msg.from ? msg.from.toString() : null;
    if (!fromPeerId || fromPeerId !== data.peerId) {
      console.warn(`[Chat] Dropped bundle: claimed peerId ${data.peerId} does not match publisher ${fromPeerId}`);
      return;
    }
    if (fromPeerId === localPeerId) return; // Ignore our own

    if (!acceptBundle(fromPeerId, data.bundle)) return; // tampered / impersonation
    persistBundles();
  } catch (e) {
    // Ignore malformed bundles
  }
}

function persistBundles() {
  const bundlesFile = path.join(CHAT_DATA_DIR, "peer-bundles.json");
  const bundlesObj = {};
  peerBundles.forEach((b, id) => {
    bundlesObj[id] = { bundle: b, verified: !!peerVerified.get(id) };
  });
  try {
    fs.writeFileSync(bundlesFile, JSON.stringify(bundlesObj, null, 2), "utf8");
  } catch (e) {
    /* ignore */
  }
}

// ─── Message Sending ───

/**
 * Send an encrypted message to a peer.
 * @param {string} peerId - Recipient's peer ID
 * @param {string} text - Plaintext message
 * @param {string|null} attachmentCid - Optional IPFS CID for attached file
 * @returns {{ success: boolean, error?: string }}
 */
async function sendDirect(peerId, payload) {
  // peerId here is always a .toString()'d string (see localPeerId / data.to /
  // data.from throughout this file), but libp2p's dialProtocol only special-
  // cases real PeerId objects (isPeerId() check in get-peer.js) — a bare
  // string falls into its multiaddr-array branch and throws
  // "multiaddrs[0].getComponents is not a function". Every direct send needs
  // a real PeerId instance.
  const { peerIdFromString } = await import('@libp2p/peer-id');
  const stream = await heliaNode.libp2p.dialProtocol(peerIdFromString(peerId), '/bucks/chat/1.0.0');
  const data = new TextEncoder().encode(JSON.stringify(payload));
  // Same dual-shape handling as the receive side (see handler comment above):
  // classic streams expose stream.sink directly for it-pipe; newer
  // event-based MessageStreams need @libp2p/utils's pipe() to wrap them.
  if (typeof stream.sink === 'function') {
    const { pipe } = await import('it-pipe');
    await pipe([data], stream.sink);
  } else {
    const { pipe } = await import('@libp2p/utils');
    await pipe([data], stream);
  }
}

async function sendMessage(peerId, text, attachmentCid = null) {
  if (!gossip) return { success: false, error: "Chat engine not initialized" };

  // Establish session if needed
  if (!signalStore.hasSession(peerId)) {
    const bundle = peerBundles.get(peerId);
    if (!bundle) {
      return {
        success: false,
        error: "No key bundle available for this peer. They may be offline.",
      };
    }

    // Perform X3DH (hybrid ML-KEM-768 + X25519 when the peer's bundle supports it)
    const { sharedSecret, ephemeralPublicKey, kemCiphertext } =
      signalStore.performX3DH(bundle);

    // Send X3DH init message so peer can derive the same shared secret.
    // Only commit the session locally once we know the init message actually
    // reached the peer — committing beforehand left a permanently desynced
    // session on failure: hasSession() would report true, so retries skipped
    // re-sending the init while the peer never got it to respond to.
    const initMessage = {
      type: "x3dh_init",
      from: localPeerId,
      to: peerId,
      identityKey: signalStore.getIdentityPublicKey(),
      ephemeralKey: ephemeralPublicKey,
      oneTimePreKeyId: bundle.oneTimePreKeyId,
      kemCiphertext: kemCiphertext, // null for non-hybrid peers
      timestamp: Date.now(),
    };

    try {
      await sendDirect(peerId, initMessage);
    } catch (e) {
      console.error("[Chat] Failed to send X3DH init:", e);
      return { success: false, error: "Failed to establish E2E session: " + e.message };
    }

    signalStore.createSession(peerId, sharedSecret, true, bundle);
  }

  // Encrypt the message
  const payload = JSON.stringify({
    text: text || "",
    attachmentCid: attachmentCid || null,
  });

  const encResult = signalStore.encryptMessage(peerId, payload);
  if (!encResult) {
    return { success: false, error: "Encryption failed — no session" };
  }

  // Build envelope
  const envelope = {
    type: "chat_message",
    from: localPeerId,
    to: peerId,
    encrypted: encResult.encrypted,
    ratchetKey: encResult.ratchetKey,
    counter: encResult.counter,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  // Authenticate the envelope so a hostile peer can't spoof `from`. The
  // recipient verifies this against our advertised Ed25519 signing key.
  envelope.sig = signalStore.signWithIdentity(envelopeSigningBytes(envelope));

  try {
    await sendDirect(peerId, envelope);
  } catch (e) {
    console.error("[Chat] Failed to publish message:", e);
    return { success: false, error: "Failed to send via direct stream: " + e.message };
  }

  // Store in local history
  const localMsg = {
    sender: localPeerId,
    text: text || "",
    timestamp: new Date().toISOString(),
    cid: attachmentCid || undefined,
    encrypted: true,
  };

  addToConversation(peerId, localMsg);
  console.log(`[Chat] Sent encrypted message to ${peerId.substring(0, 8)}...`);

  return { success: true };
}

/**
 * Send a file as an encrypted chat attachment.
 * @param {string} peerId - Recipient peer ID
 * @param {Uint8Array|number[]} fileData - File bytes
 * @param {string} filename - Original filename
 * @returns {{ success: boolean, cid?: string, error?: string }}
 */
async function sendFile(peerId, fileData, filename) {
  if (!fsModule) return { success: false, error: "IPFS not ready" };

  try {
    // Add file to IPFS (encrypted at rest is optional — we encrypt the CID reference in the message)
    const data =
      fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
    const cid = await fsModule.addBytes(data);
    const cidStr = cid.toString();

    // Send chat message with the CID
    const result = await sendMessage(peerId, `📎 ${filename}`, cidStr);
    if (result.success) {
      return { success: true, cid: cidStr };
    }
    return result;
  } catch (err) {
    console.error("[Chat] File send failed:", err);
    return { success: false, error: err.message };
  }
}

// ─── Message Receiving ───

/**
 * Canonical byte string that the envelope signature covers. Excludes `sig`
 * itself and the transport-only `nonce`. Field order is fixed on both sides.
 */
function envelopeSigningBytes(env) {
  return [
    env.type, env.from, env.to, String(env.counter), env.ratchetKey || "",
    env.encrypted.ciphertext, env.encrypted.iv, env.encrypted.tag,
    String(env.timestamp),
  ].join("|");
}

/**
 * Handle incoming chat messages from gossipsub.
 */
function handleDirectChatMessage(data) {
  try {
    // Only process messages addressed to us
    if (data.type !== "chat_message") return;
    if (data.to !== localPeerId) return;
    if (data.from === localPeerId) return; // Ignore own messages

    // Authenticity: if we know the sender's signing key, the envelope
    // signature MUST verify — this rejects `from`-spoofed messages. If we
    // don't have their bundle yet we can't verify, but decryption still
    // requires a real X3DH session, so a forgery can't produce readable text.
    const senderBundle = peerBundles.get(data.from);
    if (senderBundle && senderBundle.signingKey) {
      const good = data.sig && signalStore.verifyWithPeerSigningKey(
        senderBundle.signingKey, envelopeSigningBytes(data), data.sig,
      );
      if (!good) {
        console.warn(`[Chat] Dropped unauthenticated message claiming to be from ${data.from.substring(0, 8)}`);
        return;
      }
    }

    // Decrypt
    const plaintext = signalStore.decryptMessage(data.from, {
      encrypted: data.encrypted,
      ratchetKey: data.ratchetKey,
      counter: data.counter,
    });

    if (plaintext === null) {
      console.warn(
        `[Chat] Failed to decrypt message from ${data.from.substring(0, 8)}`,
      );
      return;
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(plaintext);
    } catch (e) {
      payload = { text: plaintext, attachmentCid: null };
    }

    const localMsg = {
      sender: data.from,
      text: payload.text || "",
      timestamp: new Date(data.timestamp).toISOString(),
      cid: payload.attachmentCid || undefined,
      encrypted: true,
    };

    addToConversation(data.from, localMsg);
    console.log(
      `[Chat] Received encrypted message from ${data.from.substring(0, 8)}...`,
    );

    // Notify renderer
    if (onMessageCallback) {
      onMessageCallback({
        peerId: data.from,
        message: localMsg,
      });
    }
  } catch (e) {
    console.error("[Chat] Failed to handle direct message:", e);
  }
}

/**
 * Handle X3DH init messages — establish session as responder.
 */
function handleX3DHInit(data) {
  if (data.to !== localPeerId) return;
  if (data.from === localPeerId) return;

  // Don't re-establish if we already have a session
  if (signalStore.hasSession(data.from)) return;

  try {
    const sharedSecret = signalStore.respondX3DH(
      data.identityKey,
      data.ephemeralKey,
      data.oneTimePreKeyId || null,
      data.kemCiphertext || null,
    );
    signalStore.createSession(data.from, sharedSecret, false);
    console.log(
      `[Chat] X3DH session established with ${data.from.substring(0, 8)}... (responder${data.kemCiphertext ? ", hybrid PQC" : ""})`,
    );
  } catch (e) {
    console.error(
      `[Chat] X3DH init failed from ${data.from.substring(0, 8)}:`,
      e.message,
    );
  }
}

// ─── Conversation Management ───

function addToConversation(peerId, message) {
  let conv = conversations.get(peerId);
  if (!conv) {
    conv = { messages: [], unreadCount: 0, lastMessage: "", lastTimestamp: "" };
    conversations.set(peerId, conv);
  }

  conv.messages.push(message);
  conv.lastMessage = message.text || "📎 Attachment";
  conv.lastTimestamp = message.timestamp;

  // Increment unread if not from us
  if (message.sender !== localPeerId) {
    conv.unreadCount++;
  }

  // Keep only last 500 messages per conversation
  if (conv.messages.length > 500) {
    conv.messages = conv.messages.slice(-500);
  }

  saveConversation(peerId);
}

/**
 * Get chat history for a peer.
 * @param {string} peerId
 * @returns {{ history: object[], sessionInfo: object|null }}
 */
function getChatHistory(peerId) {
  const conv = conversations.get(peerId);
  return {
    history: conv ? conv.messages : [],
    sessionInfo: signalStore.getSessionInfo(peerId),
    hasSession: signalStore.hasSession(peerId),
    verified: !!peerVerified.get(peerId),
  };
}

/**
 * Get all conversations (for the messages list page).
 * @returns {{ conversations: object[] }}
 */
function getConversations() {
  const result = [];
  conversations.forEach((conv, peerId) => {
    result.push({
      peer_id: peerId,
      last_message: conv.lastMessage,
      timestamp: conv.lastTimestamp,
      unread_count: conv.unreadCount,
      encrypted: true,
      hasSession: signalStore.hasSession(peerId),
      verified: !!peerVerified.get(peerId),
    });
  });

  // Sort by most recent
  result.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return { conversations: result };
}

/**
 * Mark a conversation as read.
 */
function markAsRead(peerId) {
  const conv = conversations.get(peerId);
  if (conv) {
    conv.unreadCount = 0;
    saveConversation(peerId);
  }
  return { success: true };
}

// ─── Persistence ───

function saveConversation(peerId) {
  if (!CHAT_DATA_DIR) return;
  const sanitized = peerId.replace(/[^a-zA-Z0-9]/g, "_");
  const filePath = path.join(CHAT_DATA_DIR, `${sanitized}.json`);
  const conv = conversations.get(peerId);
  if (!conv) return;

  try {
    fs.writeFileSync(filePath, JSON.stringify(conv, null, 2), "utf8");
  } catch (e) {
    console.error(
      `[Chat] Failed to save conversation ${peerId.substring(0, 8)}:`,
      e,
    );
  }
}

function loadConversations() {
  if (!CHAT_DATA_DIR) return;

  // Load peer bundles
  const bundlesFile = path.join(CHAT_DATA_DIR, "peer-bundles.json");
  if (fs.existsSync(bundlesFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(bundlesFile, "utf8"));
      for (const [id, entry] of Object.entries(data)) {
        // New shape: { bundle, verified }. Legacy shape: the raw bundle.
        const bundle = entry && entry.bundle ? entry.bundle : entry;
        peerBundles.set(id, bundle);
        if (entry && typeof entry.verified === "boolean") {
          peerVerified.set(id, entry.verified);
        }
      }
      console.log(`[Chat] Loaded ${peerBundles.size} peer key bundles.`);
    } catch (e) {
      /* ignore */
    }
  }

  // Load conversation files
  try {
    const files = fs
      .readdirSync(CHAT_DATA_DIR)
      .filter((f) => f.endsWith(".json") && f !== "peer-bundles.json");
    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(CHAT_DATA_DIR, file), "utf8"),
        );
        // Reconstruct peerId from filename
        const peerId = file.replace(".json", "").replace(/_/g, "");
        // But filenames are sanitized, so we need to use the sender from messages
        if (data.messages && data.messages.length > 0) {
          const otherPeer = data.messages.find((m) => m.sender !== localPeerId);
          const pid = otherPeer ? otherPeer.sender : peerId;
          conversations.set(pid, data);
        }
      } catch (e) {
        /* skip invalid files */
      }
    }
    console.log(`[Chat] Loaded ${conversations.size} conversations.`);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Set the callback for incoming messages (used by main.js to forward to renderer).
 */
function setOnMessageCallback(callback) {
  onMessageCallback = callback;
}

/**
 * Get own pre-key bundle (for QR code sharing or manual exchange).
 */
function getOwnBundle() {
  return {
    peerId: localPeerId,
    bundle: signalStore.getPreKeyBundle(),
  };
}

/**
 * Manually process a peer's pre-key bundle (e.g., from QR scan).
 */
function processPeerBundle(peerId, bundle) {
  if (!acceptBundle(peerId, bundle)) {
    return { success: false, error: "Bundle failed verification (tampered or impersonation)" };
  }
  persistBundles();
  return { success: true, verified: !!peerVerified.get(peerId) };
}

/**
 * Check if we have a key bundle for a peer.
 */
function hasPeerBundle(peerId) {
  return peerBundles.has(peerId);
}

module.exports = {
  initChat,
  sendMessage,
  sendFile,
  getChatHistory,
  getConversations,
  markAsRead,
  setOnMessageCallback,
  getOwnBundle,
  processPeerBundle,
  hasPeerBundle,
  // Agent integration exports
  sendPromptToAgent: agentIntegration.sendPromptToAgent,
  switchModelProvider: agentIntegration.switchModelProvider,
  getModelProviderInfo: agentIntegration.getModelProviderInfo,
  getAgentStatus: agentIntegration.getAgentStatus,
  checkAgentStatus: agentIntegration.checkAgentStatus,
  CHAT_TOPIC,
  BUNDLE_TOPIC,
};

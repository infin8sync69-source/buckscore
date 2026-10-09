/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   BUCKS BROWSER — Signal Protocol Key Store              ║
 * ║   Pure JS implementation using Node.js crypto            ║
 * ║   Hybrid classical + post-quantum:                       ║
 * ║   X25519 (ECDH) + ML-KEM-768 (FIPS 203) key agreement,   ║
 * ║   Ed25519 + ML-DSA-65 (FIPS 204) signatures,              ║
 * ║   AES-256-GCM + HKDF                                     ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * This module manages:
 * - Identity key pairs (long-term X25519 + ML-KEM/ML-DSA keys)
 * - Signed pre-keys & one-time pre-keys for hybrid X3DH
 * - Per-peer Double Ratchet session state
 * - Persistent storage in the Electron userData directory
 *
 * Post-quantum posture: X3DH is hardened with an ML-KEM-768 encapsulation
 * mixed into the same HKDF that derives the session root key (mirrors
 * Signal's own PQXDH design). We deliberately do NOT re-run a KEM at every
 * Double Ratchet DH step — HKDF/HMAC-SHA256 are one-way, so once the root key
 * is seeded with a PQ-safe component, every downstream ratchet chain key
 * derived from it stays protected even if X25519 is later broken (harvest-
 * now-decrypt-later), without paying per-message KEM ciphertext overhead.
 * The PQ pre-key instead rotates on the same cadence as the classical signed
 * pre-key (see regenerateSignedPreKey), which is where fresh PQ material
 * actually matters. ML-DSA-65 signatures likewise bind the pre-key bundle
 * against a quantum forger, alongside the existing Ed25519 signature.
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
// Lazy/optional electron import so this module can also run under plain node
// (unit tests). In-app both `app` and `safeStorage` are always available.
let app = null, safeStorage = null;
try { ({ app, safeStorage } = require("electron")); } catch (_) { /* test env */ }

let STORE_DIR = null;

// ─── Post-Quantum Primitives (ML-KEM-768 / ML-DSA-65) ───
// @noble/post-quantum ships ESM-only; this module is CommonJS, so we load it
// once via dynamic import() during initStore() and cache the module refs.
// Every function below that touches PQC assumes initStore() has already
// resolved — true for all real call sites (chat-engine.js awaits initStore()
// before subscribing to any topic that could trigger a bundle/X3DH handler).

let mlKem768 = null;
let mlDsa65 = null;

async function loadPQC() {
  if (mlKem768 && mlDsa65) return;
  const [{ ml_kem768 }, { ml_dsa65 }] = await Promise.all([
    import("@noble/post-quantum/ml-kem.js"),
    import("@noble/post-quantum/ml-dsa.js"),
  ]);
  mlKem768 = ml_kem768;
  mlDsa65 = ml_dsa65;
}

// ─── Crypto Primitives ───

/**
 * Generate an X25519 key pair for Diffie-Hellman key exchange.
 * Returns { publicKey: Buffer, privateKey: Buffer }
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey,
    privateKey: privateKey,
  };
}

/**
 * Perform X25519 Diffie-Hellman shared secret derivation.
 * @param {Buffer} privateKeyDer - Our private key in PKCS8 DER
 * @param {Buffer} publicKeyDer - Peer's public key in SPKI DER
 * @returns {Buffer} 32-byte shared secret
 */
function computeSharedSecret(privateKeyDer, publicKeyDer) {
  const privKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyDer),
    format: "der",
    type: "pkcs8",
  });
  const pubKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyDer),
    format: "der",
    type: "spki",
  });
  return crypto.diffieHellman({ privateKey: privKey, publicKey: pubKey });
}

/**
 * HKDF (HMAC-based Key Derivation Function) — RFC 5869
 * @param {Buffer} ikm - Input keying material
 * @param {Buffer} salt - Salt (optional, defaults to zeros)
 * @param {Buffer} info - Context info
 * @param {number} length - Output key length in bytes
 * @returns {Buffer}
 */
function hkdf(ikm, salt, info, length = 32) {
  if (!salt) salt = Buffer.alloc(32, 0);
  // Extract
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
  // Expand
  let t = Buffer.alloc(0);
  let okm = Buffer.alloc(0);
  let i = 1;
  while (okm.length < length) {
    t = crypto
      .createHmac("sha256", prk)
      .update(Buffer.concat([t, info, Buffer.from([i])]))
      .digest();
    okm = Buffer.concat([okm, t]);
    i++;
  }
  return okm.subarray(0, length);
}

/**
 * AES-256-GCM encrypt
 * @param {Buffer} key - 32-byte key
 * @param {Buffer|string} plaintext
 * @returns {{ ciphertext: string, iv: string, tag: string }} base64-encoded
 */
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * AES-256-GCM decrypt
 * @param {Buffer} key - 32-byte key
 * @param {{ ciphertext: string, iv: string, tag: string }} envelope
 * @returns {Buffer}
 */
function decrypt(key, envelope) {
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Ed25519 Signing (verifiable identity signatures) ───
// X25519 keys can only do Diffie-Hellman — they cannot sign. The original
// implementation "signed" the pre-key with an HMAC keyed by the identity
// *private* key, which no peer can ever verify. We now carry a parallel
// Ed25519 signing identity: its public key travels in the pre-key bundle and
// peers verify the signed-pre-key signature against it.

function generateSigningKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return { publicKey, privateKey };
}

function signEd25519(privateKeyDer, data) {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyDer), format: "der", type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(data), key);
}

function verifyEd25519(publicKeyDer, data, signature) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyDer), format: "der", type: "spki",
    });
    return crypto.verify(null, Buffer.from(data), key, Buffer.from(signature));
  } catch (_) {
    return false;
  }
}

// ─── Encrypted-at-rest persistence (Electron safeStorage / OS keychain) ───
// Identity private keys and ratchet session state previously sat in plaintext
// JSON on disk. Files are now wrapped with safeStorage (Keychain-backed on
// macOS). Legacy plaintext files are read transparently and re-encrypted on
// the next save. Falls back to plaintext only when the OS facility is
// unavailable (e.g. some Linux setups without a keyring, or unit tests).

const ENC_MAGIC = "BUCKSENC1:";

function _canEncryptAtRest() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); }
  catch (_) { return false; }
}

function writeProtected(file, obj) {
  const json = JSON.stringify(obj, null, 2);
  if (_canEncryptAtRest()) {
    try {
      fs.writeFileSync(file, ENC_MAGIC + safeStorage.encryptString(json).toString("base64"), "utf8");
      return;
    } catch (e) {
      console.warn("[Signal] safeStorage encryption failed, falling back to plaintext:", e.message);
    }
  }
  fs.writeFileSync(file, json, "utf8");
}

function readProtected(file) {
  const raw = fs.readFileSync(file, "utf8");
  if (raw.startsWith(ENC_MAGIC)) {
    const blob = Buffer.from(raw.slice(ENC_MAGIC.length), "base64");
    return JSON.parse(safeStorage.decryptString(blob));
  }
  return JSON.parse(raw); // legacy plaintext — re-encrypted on next save
}

// ─── Key Store ───

let identityKeyPair = null; // { publicKey, privateKey } Buffers (DER) — X25519 (DH)
let signingKeyPair = null;  // { publicKey, privateKey } Buffers (DER) — Ed25519 (signatures)
let pqSigningKeyPair = null; // { publicKey, secretKey } Uint8Arrays — ML-DSA-65 (post-quantum signatures)
let signedPreKey = null; // { keyId, keyPair, pqKeyPair, signature, signatureDsa }
let oneTimePreKeys = new Map(); // keyId -> keyPair
let sessions = new Map(); // peerId -> SessionState
let preKeyCounter = 0;

/**
 * Initialize the key store. Loads or generates identity keys.
 */
async function initStore() {
  await loadPQC();

  STORE_DIR = path.join(app.getPath("userData"), "ipfs-data", "signal");
  fs.mkdirSync(STORE_DIR, { recursive: true });

  const identityFile = path.join(STORE_DIR, "identity.json");
  if (fs.existsSync(identityFile)) {
    try {
      const data = readProtected(identityFile);
      identityKeyPair = {
        publicKey: Buffer.from(data.publicKey, "base64"),
        privateKey: Buffer.from(data.privateKey, "base64"),
      };
      // Ed25519 signing identity — added after first ship, so migrate older
      // identities that lack it (generate once, persist alongside).
      if (data.signingPublicKey && data.signingPrivateKey) {
        signingKeyPair = {
          publicKey: Buffer.from(data.signingPublicKey, "base64"),
          privateKey: Buffer.from(data.signingPrivateKey, "base64"),
        };
      }
      // ML-DSA-65 post-quantum signing identity — same migration story.
      if (data.pqSigningPublicKey && data.pqSigningPrivateKey) {
        pqSigningKeyPair = {
          publicKey: Buffer.from(data.pqSigningPublicKey, "base64"),
          secretKey: Buffer.from(data.pqSigningPrivateKey, "base64"),
        };
      }
      preKeyCounter = data.preKeyCounter || 0;
      console.log("[Signal] Identity loaded.");
    } catch (e) {
      console.error("[Signal] Failed to load identity, regenerating:", e);
      identityKeyPair = null;
    }
  }

  if (!identityKeyPair) {
    identityKeyPair = generateKeyPair();
    signingKeyPair = generateSigningKeyPair();
    pqSigningKeyPair = mlDsa65.keygen();
    preKeyCounter = 0;
    saveIdentity();
    console.log("[Signal] New identity generated.");
  } else {
    let migrated = false;
    if (!signingKeyPair) {
      // Migrate a pre-Ed25519 identity in place.
      signingKeyPair = generateSigningKeyPair();
      migrated = true;
      console.log("[Signal] Added Ed25519 signing key to existing identity.");
    }
    if (!pqSigningKeyPair) {
      // Migrate a pre-hybrid identity in place.
      pqSigningKeyPair = mlDsa65.keygen();
      migrated = true;
      console.log("[Signal] Added ML-DSA-65 post-quantum signing key to existing identity.");
    }
    if (migrated) saveIdentity();
  }

  // Generate signed pre-key (classical + post-quantum)
  regenerateSignedPreKey();

  // Generate initial batch of one-time pre-keys
  generateOneTimePreKeys(10);

  // Load persisted sessions
  loadSessions();
}

function saveIdentity() {
  const identityFile = path.join(STORE_DIR, "identity.json");
  writeProtected(identityFile, {
    publicKey: identityKeyPair.publicKey.toString("base64"),
    privateKey: identityKeyPair.privateKey.toString("base64"),
    signingPublicKey: signingKeyPair.publicKey.toString("base64"),
    signingPrivateKey: signingKeyPair.privateKey.toString("base64"),
    pqSigningPublicKey: Buffer.from(pqSigningKeyPair.publicKey).toString("base64"),
    pqSigningPrivateKey: Buffer.from(pqSigningKeyPair.secretKey).toString("base64"),
    preKeyCounter: preKeyCounter,
  });
}

function regenerateSignedPreKey() {
  const keyPair = generateKeyPair(); // X25519
  const pqKeyPair = mlKem768.keygen(); // ML-KEM-768

  // Bind the classical and post-quantum pre-keys into a single signed
  // statement (sign their concatenation) so an attacker can't splice a valid
  // classical pre-key together with a forged/unrelated PQ pre-key, or vice
  // versa. Both an Ed25519 and an ML-DSA-65 signature cover the same bytes —
  // a peer needs to break both signature schemes to forge this bundle.
  const signedMaterial = Buffer.concat([
    keyPair.publicKey,
    Buffer.from(pqKeyPair.publicKey),
  ]);
  const signature = signEd25519(signingKeyPair.privateKey, signedMaterial);
  const signatureDsa = Buffer.from(mlDsa65.sign(signedMaterial, pqSigningKeyPair.secretKey));

  signedPreKey = {
    keyId: Date.now(),
    keyPair: keyPair,
    pqKeyPair: {
      publicKey: Buffer.from(pqKeyPair.publicKey),
      secretKey: Buffer.from(pqKeyPair.secretKey),
    },
    signature: signature,
    signatureDsa: signatureDsa,
  };
}

function generateOneTimePreKeys(count) {
  for (let i = 0; i < count; i++) {
    const keyId = ++preKeyCounter;
    oneTimePreKeys.set(keyId, generateKeyPair());
  }
  saveIdentity(); // Update counter
}

// ─── Pre-Key Bundle (for X3DH) ───

/**
 * Get this node's pre-key bundle for advertisement.
 * This is what peers need to establish a session with us.
 */
function getPreKeyBundle() {
  // Pick one OTK to share (first available)
  let oneTimePreKeyId = null;
  let oneTimePreKeyPublic = null;
  if (oneTimePreKeys.size > 0) {
    const [id, kp] = oneTimePreKeys.entries().next().value;
    oneTimePreKeyId = id;
    oneTimePreKeyPublic = kp.publicKey.toString("base64");
  }

  return {
    identityKey: identityKeyPair.publicKey.toString("base64"),
    // Ed25519 verification key — lets peers verify signedPreKeySignature.
    signingKey: signingKeyPair.publicKey.toString("base64"),
    // ML-DSA-65 verification key — lets peers verify signedPQPreKeySignature.
    pqSigningKey: Buffer.from(pqSigningKeyPair.publicKey).toString("base64"),
    signedPreKeyId: signedPreKey.keyId,
    signedPreKey: signedPreKey.keyPair.publicKey.toString("base64"),
    // ML-KEM-768 public key — the initiator encapsulates against this to mix
    // a post-quantum shared secret into the X3DH root key (see performX3DH).
    signedPQPreKey: signedPreKey.pqKeyPair.publicKey.toString("base64"),
    // Both signatures cover the SAME bytes: concat(signedPreKey, signedPQPreKey).
    signedPreKeySignature: signedPreKey.signature.toString("base64"),
    signedPQPreKeySignature: signedPreKey.signatureDsa.toString("base64"),
    oneTimePreKeyId: oneTimePreKeyId,
    oneTimePreKey: oneTimePreKeyPublic,
  };
}

/**
 * Verify a peer's pre-key bundle: the signed pre-key (classical + PQ, bound
 * together as one signed statement) must carry a valid Ed25519 signature from
 * the bundle's own signing key, and — for hybrid-upgraded peers — a valid
 * ML-DSA-65 signature too. This is what stops a man-in-the-middle from
 * swapping in their own signed pre-key, classical or quantum. Bundles from
 * older peers that predate Ed25519 (no `signingKey`) are accepted but flagged
 * unverified; bundles that have Ed25519 but predate the PQ upgrade (no
 * `signedPQPreKey`) are accepted as classical-only and flagged `pq: false` so
 * the UI can warn and X3DH falls back to classical-only key agreement.
 * @returns {{ ok: boolean, verified: boolean, pq?: boolean, reason?: string }}
 */
function verifyPreKeyBundle(bundle) {
  if (!bundle || !bundle.identityKey || !bundle.signedPreKey) {
    return { ok: false, verified: false, reason: "malformed bundle" };
  }
  if (!bundle.signingKey || !bundle.signedPreKeySignature) {
    return { ok: true, verified: false, reason: "legacy unsigned bundle" };
  }

  const classicalPub = Buffer.from(bundle.signedPreKey, "base64");
  const hasPQ = !!(bundle.signedPQPreKey && bundle.pqSigningKey && bundle.signedPQPreKeySignature);
  const signedMaterial = hasPQ
    ? Buffer.concat([classicalPub, Buffer.from(bundle.signedPQPreKey, "base64")])
    : classicalPub;

  const edOk = verifyEd25519(
    Buffer.from(bundle.signingKey, "base64"),
    signedMaterial,
    Buffer.from(bundle.signedPreKeySignature, "base64"),
  );
  if (!edOk) {
    return { ok: false, verified: false, reason: "signed pre-key signature invalid" };
  }

  if (!hasPQ) {
    return { ok: true, verified: true, pq: false, reason: "peer bundle predates post-quantum upgrade" };
  }

  const dsaOk = mlDsa65.verify(
    Buffer.from(bundle.signedPQPreKeySignature, "base64"),
    signedMaterial,
    Buffer.from(bundle.pqSigningKey, "base64"),
  );
  if (!dsaOk) {
    return { ok: false, verified: false, reason: "post-quantum signed pre-key signature invalid" };
  }

  return { ok: true, verified: true, pq: true };
}

// ─── X3DH Key Agreement (Initiator Side) ───

/**
 * Perform X3DH as the initiator to derive a shared secret with a peer.
 * When the peer's bundle carries an ML-KEM-768 signed pre-key, this also
 * encapsulates against it and mixes the resulting shared secret into the same
 * HKDF as the classical DH outputs — a hybrid PQXDH-style handshake. Falls
 * back to classical-only X3DH for peers who haven't upgraded yet.
 * @param {object} peerBundle - The peer's pre-key bundle
 * @returns {{ sharedSecret: Buffer, ephemeralPublicKey: string, kemCiphertext: string|null }}
 */
function performX3DH(peerBundle) {
  const ephemeral = generateKeyPair();

  const peerIdentityKey = Buffer.from(peerBundle.identityKey, "base64");
  const peerSignedPreKey = Buffer.from(peerBundle.signedPreKey, "base64");

  // DH1: Our identity key × Peer's signed pre-key
  const dh1 = computeSharedSecret(identityKeyPair.privateKey, peerSignedPreKey);
  // DH2: Our ephemeral key × Peer's identity key
  const dh2 = computeSharedSecret(ephemeral.privateKey, peerIdentityKey);
  // DH3: Our ephemeral key × Peer's signed pre-key
  const dh3 = computeSharedSecret(ephemeral.privateKey, peerSignedPreKey);

  let dhConcat = Buffer.concat([dh1, dh2, dh3]);

  // DH4 (optional): Our ephemeral key × Peer's one-time pre-key
  if (peerBundle.oneTimePreKey) {
    const peerOTK = Buffer.from(peerBundle.oneTimePreKey, "base64");
    const dh4 = computeSharedSecret(ephemeral.privateKey, peerOTK);
    dhConcat = Buffer.concat([dhConcat, dh4]);
  }

  // Hybrid PQC step: encapsulate against the peer's ML-KEM-768 pre-key. The
  // resulting ciphertext travels alongside the ephemeral key in the X3DH init
  // message so the responder can decapsulate the same shared secret.
  let kemCiphertext = null;
  let infoLabel = "BucksSignalX3DH";
  if (peerBundle.signedPQPreKey) {
    const peerPQPub = Buffer.from(peerBundle.signedPQPreKey, "base64");
    const { cipherText, sharedSecret: kemSs } = mlKem768.encapsulate(peerPQPub);
    dhConcat = Buffer.concat([dhConcat, Buffer.from(kemSs)]);
    kemCiphertext = Buffer.from(cipherText).toString("base64");
    infoLabel = "BucksSignalX3DH-Hybrid";
  }

  // Derive shared secret via HKDF
  const sharedSecret = hkdf(
    dhConcat,
    null,
    Buffer.from(infoLabel, "utf8"),
    32,
  );

  return {
    sharedSecret,
    ephemeralPublicKey: ephemeral.publicKey.toString("base64"),
    kemCiphertext,
  };
}

// ─── X3DH Key Agreement (Responder Side) ───

/**
 * Process an incoming X3DH handshake from a peer.
 * @param {string} peerIdentityKeyB64 - Peer's identity public key
 * @param {string} ephemeralKeyB64 - Peer's ephemeral public key
 * @param {number|null} oneTimePreKeyId - Which OTK was used (if any)
 * @param {string|null} kemCiphertextB64 - Peer's ML-KEM-768 ciphertext (hybrid only)
 * @returns {Buffer} sharedSecret
 */
function respondX3DH(peerIdentityKeyB64, ephemeralKeyB64, oneTimePreKeyId, kemCiphertextB64 = null) {
  const peerIdentityKey = Buffer.from(peerIdentityKeyB64, "base64");
  const ephemeralKey = Buffer.from(ephemeralKeyB64, "base64");

  // DH1: Our signed pre-key × Peer's identity key
  const dh1 = computeSharedSecret(
    signedPreKey.keyPair.privateKey,
    peerIdentityKey,
  );
  // DH2: Our identity key × Peer's ephemeral key
  const dh2 = computeSharedSecret(identityKeyPair.privateKey, ephemeralKey);
  // DH3: Our signed pre-key × Peer's ephemeral key
  const dh3 = computeSharedSecret(
    signedPreKey.keyPair.privateKey,
    ephemeralKey,
  );

  let dhConcat = Buffer.concat([dh1, dh2, dh3]);

  // DH4: Use and consume the one-time pre-key
  if (oneTimePreKeyId !== null && oneTimePreKeys.has(oneTimePreKeyId)) {
    const otk = oneTimePreKeys.get(oneTimePreKeyId);
    const dh4 = computeSharedSecret(otk.privateKey, ephemeralKey);
    dhConcat = Buffer.concat([dhConcat, dh4]);
    oneTimePreKeys.delete(oneTimePreKeyId); // Consume it

    // Replenish if running low
    if (oneTimePreKeys.size < 5) {
      generateOneTimePreKeys(5);
    }
  }

  // Hybrid PQC step: decapsulate the initiator's ML-KEM-768 ciphertext against
  // our current signed pre-key's PQ secret key. Requires the PQ pre-key that
  // was live when the initiator fetched our bundle — same rotation-race
  // caveat that already applies to the classical signedPreKey.
  let infoLabel = "BucksSignalX3DH";
  if (kemCiphertextB64) {
    const kemCt = Buffer.from(kemCiphertextB64, "base64");
    const kemSs = mlKem768.decapsulate(kemCt, signedPreKey.pqKeyPair.secretKey);
    dhConcat = Buffer.concat([dhConcat, Buffer.from(kemSs)]);
    infoLabel = "BucksSignalX3DH-Hybrid";
  }

  return hkdf(dhConcat, null, Buffer.from(infoLabel, "utf8"), 32);
}

// ─── Double Ratchet Session State ───

/**
 * @typedef {Object} SessionState
 * @property {Buffer} rootKey - Current root key (32 bytes)
 * @property {Buffer} sendChainKey - Current sending chain key
 * @property {Buffer} recvChainKey - Current receiving chain key
 * @property {number} sendCounter - Messages sent in current chain
 * @property {number} recvCounter - Messages received in current chain
 * @property {object} sendRatchetKey - Our current ratchet key pair
 * @property {Buffer} peerRatchetKey - Peer's current ratchet public key
 */

/**
 * Initialize a new session with a peer after X3DH.
 * @param {string} peerId
 * @param {Buffer} sharedSecret - From X3DH
 * @param {boolean} isInitiator - Whether we initiated the session
 */
function createSession(peerId, sharedSecret, isInitiator, peerBundle = null) {
  const ratchetKeyPair = generateKeyPair();

  const session = {
    rootKey: sharedSecret,
    sendChainKey: null,
    recvChainKey: null,
    sendCounter: 0,
    recvCounter: 0,
    sendRatchetKey: isInitiator ? {
      publicKey: ratchetKeyPair.publicKey.toString("base64"),
      privateKey: ratchetKeyPair.privateKey.toString("base64"),
    } : {
      publicKey: signedPreKey.keyPair.publicKey.toString("base64"),
      privateKey: signedPreKey.keyPair.privateKey.toString("base64"),
    },
    peerRatchetKey: isInitiator && peerBundle ? peerBundle.signedPreKey : null,
    isInitiator: isInitiator,
    established: Date.now(),
  };

  // For the initiator, perform initial DH ratchet step
  if (isInitiator && peerBundle) {
    const peerSignedPreKeyBuf = Buffer.from(peerBundle.signedPreKey, "base64");
    const dhResult = computeSharedSecret(ratchetKeyPair.privateKey, peerSignedPreKeyBuf);
    const derived = hkdf(
      Buffer.concat([sharedSecret, dhResult]),
      null,
      Buffer.from("BucksRatchet", "utf8"),
      64,
    );
    session.sendChainKey = derived.subarray(0, 32);
    session.rootKey = derived.subarray(32, 64);
  }

  sessions.set(peerId, session);
  saveSessions();
  console.log(
    `[Signal] Session created with ${peerId.substring(0, 8)}... (${isInitiator ? "initiator" : "responder"})`,
  );
}

/**
 * Encrypt a message for a peer using the Double Ratchet.
 * @param {string} peerId
 * @param {string} plaintext
 * @returns {{ encrypted: object, ratchetKey: string, counter: number } | null}
 */
function encryptMessage(peerId, plaintext) {
  const session = sessions.get(peerId);
  if (!session) return null;

  // Derive message key from chain key using HKDF
  if (!session.sendChainKey) {
    // If no send chain yet, derive from root.
    // BUG FIX: Buffer.from(buffer, "base64") misinterprets raw Buffer bytes as
    // a UTF-8 base64 string → garbage HKDF input. Use type-checked coercion.
    const rootKeyBuf = Buffer.isBuffer(session.rootKey)
      ? session.rootKey
      : Buffer.from(session.rootKey, "base64");
    const derived = hkdf(
      rootKeyBuf,
      null,
      Buffer.from("BucksMsgKey", "utf8"),
      64,
    );
    session.sendChainKey = derived.subarray(0, 32);
  }

  // KDF chain step: derive message key and advance chain
  const messageKey = hkdf(
    typeof session.sendChainKey === "string"
      ? Buffer.from(session.sendChainKey, "base64")
      : session.sendChainKey,
    null,
    Buffer.from("BucksMsgKey" + session.sendCounter, "utf8"),
    32,
  );

  // Advance chain key
  session.sendChainKey = hkdf(
    typeof session.sendChainKey === "string"
      ? Buffer.from(session.sendChainKey, "base64")
      : session.sendChainKey,
    null,
    Buffer.from("BucksChainAdv", "utf8"),
    32,
  );

  const encrypted = encrypt(messageKey, plaintext);
  const counter = session.sendCounter;
  session.sendCounter++;

  // Serialize chainKey for persistence
  if (Buffer.isBuffer(session.sendChainKey)) {
    session.sendChainKey = session.sendChainKey.toString("base64");
  }

  saveSessions();

  return {
    encrypted,
    ratchetKey: session.sendRatchetKey.publicKey,
    counter,
  };
}

/**
 * Decrypt a message from a peer using the Double Ratchet.
 * @param {string} peerId
 * @param {object} envelope - { encrypted, ratchetKey, counter }
 * @returns {string|null} plaintext
 */
function decryptMessage(peerId, envelope) {
  let session = sessions.get(peerId);
  if (!session) {
    console.warn(
      `[Signal] No session for ${peerId.substring(0, 8)}, cannot decrypt`,
    );
    return null;
  }

  // If peer's ratchet key changed, perform a DH ratchet step
  if (envelope.ratchetKey && envelope.ratchetKey !== session.peerRatchetKey) {
    session.peerRatchetKey = envelope.ratchetKey;

    // Perform DH with peer's new ratchet key
    const peerRatchetKeyBuf = Buffer.from(envelope.ratchetKey, "base64");
    const ourPrivKey = Buffer.from(session.sendRatchetKey.privateKey, "base64");

    try {
      const dhResult = computeSharedSecret(ourPrivKey, peerRatchetKeyBuf);
      const rootKeyBuf =
        typeof session.rootKey === "string"
          ? Buffer.from(session.rootKey, "base64")
          : session.rootKey;

      // Receive-side DH ratchet step: derive new recvChainKey + intermediate rootKey.
      const derivedRecv = hkdf(
        Buffer.concat([rootKeyBuf, dhResult]),
        null,
        Buffer.from("BucksRatchet", "utf8"),
        64,
      );
      session.recvChainKey = derivedRecv.subarray(0, 32);
      const interRootKey = derivedRecv.subarray(32, 64);
      session.recvCounter = 0;

      // BUG FIX: complete the Double Ratchet by also generating a new local
      // ratchet key pair and performing the send-side DH step. Without this the
      // local sendRatchetKey is frozen at its initial value, the peer never sees
      // a new ratchet key, their root key never advances via DH, and forward
      // secrecy is broken after the first message chain.
      const newRatchetKeyPair = generateKeyPair();
      const dhSend = computeSharedSecret(newRatchetKeyPair.privateKey, peerRatchetKeyBuf);
      const derivedSend = hkdf(
        Buffer.concat([interRootKey, dhSend]),
        null,
        Buffer.from("BucksRatchet", "utf8"),
        64,
      );
      session.sendChainKey = derivedSend.subarray(0, 32).toString("base64");
      session.rootKey = derivedSend.subarray(32, 64).toString("base64");
      session.sendRatchetKey = {
        publicKey: newRatchetKeyPair.publicKey.toString("base64"),
        privateKey: newRatchetKeyPair.privateKey.toString("base64"),
      };
      session.sendCounter = 0;
    } catch (e) {
      console.error("[Signal] DH ratchet step failed:", e.message);
    }
  }

  // Derive receive chain if needed
  if (!session.recvChainKey) {
    const rootKeyBuf =
      typeof session.rootKey === "string"
        ? Buffer.from(session.rootKey, "base64")
        : session.rootKey;
    const derived = hkdf(
      rootKeyBuf,
      null,
      Buffer.from("BucksMsgKey", "utf8"),
      64,
    );
    session.recvChainKey = derived.subarray(0, 32);
  }

  // Derive message key for this counter
  const recvChainBuf = Buffer.isBuffer(session.recvChainKey)
    ? session.recvChainKey
    : Buffer.from(session.recvChainKey, "base64");

  const messageKey = hkdf(
    recvChainBuf,
    null,
    Buffer.from("BucksMsgKey" + envelope.counter, "utf8"),
    32,
  );

  // Advance receive chain key
  session.recvChainKey = hkdf(
    recvChainBuf,
    null,
    Buffer.from("BucksChainAdv", "utf8"),
    32,
  ).toString("base64");

  session.recvCounter = envelope.counter + 1;
  saveSessions();

  try {
    const plaintext = decrypt(messageKey, envelope.encrypted);
    return plaintext.toString("utf8");
  } catch (err) {
    console.error(
      `[Signal] Decryption failed for ${peerId.substring(0, 8)}:`,
      err.message,
    );
    return null;
  }
}

/**
 * Check if a session exists for a peer.
 */
function hasSession(peerId) {
  return sessions.has(peerId);
}

/**
 * Get session info (for UI display).
 */
function getSessionInfo(peerId) {
  const session = sessions.get(peerId);
  if (!session) return null;
  return {
    established: session.established,
    messagesSent: session.sendCounter,
    messagesReceived: session.recvCounter,
    isInitiator: session.isInitiator,
  };
}

// ─── Persistence ───

function saveSessions() {
  if (!STORE_DIR) return;
  const sessionsFile = path.join(STORE_DIR, "sessions.json");
  const data = {};
  sessions.forEach((session, peerId) => {
    // Serialize Buffer fields to base64
    const s = { ...session };
    if (Buffer.isBuffer(s.rootKey)) s.rootKey = s.rootKey.toString("base64");
    if (Buffer.isBuffer(s.sendChainKey))
      s.sendChainKey = s.sendChainKey.toString("base64");
    if (Buffer.isBuffer(s.recvChainKey))
      s.recvChainKey = s.recvChainKey.toString("base64");
    data[peerId] = s;
  });
  try {
    writeProtected(sessionsFile, data); // encrypted at rest (ratchet keys)
  } catch (e) {
    console.error("[Signal] Failed to save sessions:", e);
  }
}

function loadSessions() {
  if (!STORE_DIR) return;
  const sessionsFile = path.join(STORE_DIR, "sessions.json");
  if (fs.existsSync(sessionsFile)) {
    try {
      const data = readProtected(sessionsFile);
      for (const [peerId, session] of Object.entries(data)) {
        sessions.set(peerId, session);
      }
      console.log(`[Signal] Loaded ${sessions.size} sessions.`);
    } catch (e) {
      console.error("[Signal] Failed to load sessions:", e);
    }
  }
}

// ─── Public API ───

function getIdentityPublicKey() {
  return identityKeyPair ? identityKeyPair.publicKey.toString("base64") : null;
}

/** Sign arbitrary bytes/string with our Ed25519 identity → base64 signature. */
function signWithIdentity(data) {
  return signEd25519(signingKeyPair.privateKey, data).toString("base64");
}

/** Verify base64 Ed25519 `signature` over `data` using a peer's base64 signing key. */
function verifyWithPeerSigningKey(peerSigningKeyB64, data, signatureB64) {
  if (!peerSigningKeyB64 || !signatureB64) return false;
  return verifyEd25519(
    Buffer.from(peerSigningKeyB64, "base64"), data, Buffer.from(signatureB64, "base64"),
  );
}

module.exports = {
  initStore,
  getIdentityPublicKey,
  getPreKeyBundle,
  verifyPreKeyBundle,
  performX3DH,
  respondX3DH,
  createSession,
  encryptMessage,
  decryptMessage,
  hasSession,
  getSessionInfo,
  signWithIdentity,
  verifyWithPeerSigningKey,
  encrypt,
  decrypt,
  hkdf,
  generateKeyPair,
};

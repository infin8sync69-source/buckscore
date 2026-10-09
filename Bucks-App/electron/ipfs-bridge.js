/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  IPFS Bridge — agent ↔ browser content plane                     ║
 * ║                                                                  ║
 * ║  The Python agent (soul_engine.py) speaks the Kubo HTTP API;     ║
 * ║  the browser runs an in-process Helia node with no HTTP API.     ║
 * ║  This module closes that gap from both ends:                     ║
 * ║                                                                  ║
 * ║  1. Kubo-compatible HTTP API backed by the Helia node            ║
 * ║     (/api/v0/add, cat, pin/add, id, version + /ipfs/<cid>        ║
 * ║     gateway + /api/v0/bucks/* extensions). Binds 127.0.0.1:5001  ║
 * ║     when no Kubo daemon holds it — the agent's default endpoint  ║
 * ║     then works with zero external dependencies — else :5006.     ║
 * ║  2. When a local Kubo daemon IS running, peers it with the       ║
 * ║     Helia node in both directions so bitswap moves blocks        ║
 * ║     between the two worlds: CIDs the agent adds via Kubo         ║
 * ║     resolve in the browser swarm and vice versa.                 ║
 * ║  3. Writes ~/.bucks/ipfs.json so the agent discovers which       ║
 * ║     endpoint to use (config.py / ipfs_endpoints.py reads it).    ║
 * ║                                                                  ║
 * ║  No Electron imports — testable standalone with any Helia node. ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");

const KUBO_API_URL = process.env.BUCKS_KUBO_API || "http://127.0.0.1:5001";
const KUBO_GATEWAY_URL = process.env.BUCKS_KUBO_GATEWAY || "http://127.0.0.1:8080";
const PREFERRED_PORT = 5001; // Kubo's default — agent works unconfigured
const FALLBACK_PORT = Number(process.env.BUCKS_IPFS_BRIDGE_PORT || 5006);
const PEERING_INTERVAL_MS = 60_000;
const BRIDGE_AGENT_VERSION = "bucks-ipfs-bridge/1.0";
const BUCKS_HOME = process.env.BUCKS_HOME || path.join(os.homedir(), ".bucks");
const MANIFEST_FILE = path.join(BUCKS_HOME, "ipfs.json");

let _ipfs = null; // injected ipfs-node module (or compatible interface)
let _server = null;
let _boundPort = null;
let _peeringTimer = null;
let _kuboInfo = null; // { id, addresses } when a real Kubo daemon is present
let _peeredOnce = false;

// ── Kubo daemon detection & peering ────────────────────────────────────────

function kuboRequest(pathname, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${KUBO_API_URL}${pathname}`,
      { method: "POST" },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Kubo HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
          }
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    req.end();
  });
}

/**
 * Detect a REAL Kubo daemon at KUBO_API_URL. Returns null if the port is
 * closed or held by another Bucks bridge instance (AgentVersion match).
 */
async function detectKubo() {
  try {
    const id = await kuboRequest("/api/v0/id");
    if (!id || !id.ID) return null;
    if ((id.AgentVersion || "").startsWith("bucks-ipfs-bridge")) return null;
    return { id: id.ID, addresses: id.Addresses || [], agent: id.AgentVersion || "" };
  } catch {
    return null;
  }
}

/**
 * Bidirectionally peer the Helia node with the local Kubo daemon.
 * Helia here has no DHT — without an explicit dial the two nodes never
 * meet, and content added on one side is invisible to the other.
 */
async function peerWithKubo() {
  const heliaNode = _ipfs.getHeliaNode();
  if (!heliaNode || !_kuboInfo) return;

  // Kubo → Helia: hand Kubo our loopback multiaddrs.
  const peerId = heliaNode.libp2p.peerId.toString();
  const ourAddrs = heliaNode.libp2p
    .getMultiaddrs()
    .map((a) => a.toString())
    .filter((a) => a.startsWith("/ip4/127.0.0.1/tcp/") && !a.includes("/ws"));
  for (const addr of ourAddrs) {
    const full = addr.includes("/p2p/") ? addr : `${addr}/p2p/${peerId}`;
    try {
      await kuboRequest(`/api/v0/swarm/connect?arg=${encodeURIComponent(full)}`);
    } catch (e) {
      // Non-fatal: the Helia-side dial below is the second chance.
    }
  }

  // Helia → Kubo: dial Kubo's loopback TCP addrs (our transports: tcp/ws).
  const kuboAddrs = _kuboInfo.addresses.filter(
    (a) =>
      a.startsWith("/ip4/127.0.0.1/tcp/") &&
      !a.includes("/quic") &&
      !a.includes("/webtransport") &&
      !a.includes("/webrtc") &&
      !a.includes("/ws"),
  );
  for (const addr of kuboAddrs) {
    const full = addr.includes("/p2p/") ? addr : `${addr}/p2p/${_kuboInfo.id}`;
    try {
      const res = await _ipfs.connectPeer(full);
      if (res && res.success && !_peeredOnce) {
        _peeredOnce = true;
        console.log(`[Bridge] Helia ↔ Kubo peered (${_kuboInfo.id.slice(0, 12)}…) — content planes merged.`);
      }
    } catch {
      // keep trying other addrs / next interval
    }
  }
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

function readBody(req, limitBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        req.destroy();
        return reject(new Error("payload too large"));
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Minimal multipart/form-data parser: returns { filename, data } of the
 * first file part (what Kubo's /api/v0/add consumes).
 */
function parseMultipart(body, contentType) {
  const m = /boundary=("?)([^";]+)\1/i.exec(contentType || "");
  if (!m) return null;
  const boundary = Buffer.from(`--${m[2]}`);
  const parts = [];
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const next = body.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    // part = headers \r\n\r\n content \r\n
    const part = body.slice(idx + boundary.length + 2, next - 2); // skip \r\n after boundary, trim trailing \r\n
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const data = part.slice(headerEnd + 4);
      const fn = /filename=("?)([^"\r\n;]*)\1/i.exec(headers);
      parts.push({ headers, filename: fn ? fn[2] : null, data });
    }
    idx = next;
  }
  if (parts.length === 0) return null;
  return parts.find((p) => p.filename !== null) || parts[0];
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}

function sniffContentType(buf, name = "") {
  const ext = path.extname(name).toLowerCase();
  const byExt = {
    ".html": "text/html", ".htm": "text/html", ".css": "text/css",
    ".js": "text/javascript", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".txt": "text/plain",
    ".md": "text/plain", ".pdf": "application/pdf",
  };
  if (byExt[ext]) return byExt[ext];
  const head = buf.slice(0, 64).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "text/html";
  if (head.startsWith("{") || head.startsWith("[")) return "application/json";
  // Heuristic: printable ⇒ text
  const sample = buf.slice(0, 256);
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  return sample.length && printable / sample.length > 0.9 ? "text/plain; charset=utf-8" : "application/octet-stream";
}

// ── Helia-backed operations ─────────────────────────────────────────────────

async function heliaAdd(data, filename) {
  const fsModule = _ipfs.getFsModule();
  if (!fsModule) throw new Error("IPFS node not initialized");
  const cid = await fsModule.addBytes(data);
  // Write-through to Kubo: bitswap alone can't be trusted to move blocks
  // Helia→Kubo on this setup (Kubo broadcast reduction + Routing.Type=None
  // means idle peers never receive wants), so mirror the block directly.
  // Only possible for single raw blocks (codec 0x55), where block/put with
  // cid-codec=raw reproduces the identical CID — that covers knowledge
  // fragments, souls, and dweb pages, which are all single-block.
  if (_kuboInfo && cid.code === 0x55) {
    try {
      const put = await kuboBlockPut(data);
      if (put.Key && put.Key !== cid.toString()) {
        console.warn(`[Bridge] block/put CID mismatch: helia=${cid} kubo=${put.Key}`);
      }
    } catch (e) {
      console.warn(`[Bridge] Kubo write-through failed (content still on Helia): ${e.message}`);
    }
  }
  return { Name: filename || cid.toString(), Hash: cid.toString(), Size: String(data.length) };
}

/**
 * Pin a whole local directory as a UnixFS tree, wrapped in a root directory
 * CID. Takes a local filesystem path rather than an upload — the only
 * caller (scripts/build-and-pin-release.js) already runs on this same
 * machine to reach this bridge at all (same co-located trust level as
 * heliaAdd's raw-bytes endpoint), so there's no need to invent a multipart
 * directory wire format when both sides already share a filesystem.
 *
 * Unchanged files across releases produce byte-identical sub-CIDs (that's
 * the whole point — see build-and-pin-release.js's "appTree" field), so
 * this is what makes routine-tier updates only transfer changed blocks.
 */
async function heliaAddDir(dirPath) {
  const fsModule = _ipfs.getFsModule();
  if (!fsModule) throw new Error("IPFS node not initialized");
  const { globSource } = await import("@helia/unixfs");

  let rootCid = null;
  let fileCount = 0;
  let totalSize = 0;
  for await (const entry of fsModule.addAll(globSource(dirPath, "**/*"), { wrapWithDirectory: true })) {
    rootCid = entry.cid; // last yielded entry is the wrapping root directory
    if (entry.unixfs?.type !== "directory") {
      fileCount++;
      totalSize += Number(entry.size || 0);
    }
  }
  if (!rootCid) throw new Error(`No files found under ${dirPath}`);
  return { Hash: rootCid.toString(), FileCount: fileCount, TotalSize: String(totalSize) };
}

/** POST raw bytes to Kubo /api/v0/block/put (multipart), pinned. */
function kuboBlockPut(data) {
  return new Promise((resolve, reject) => {
    const boundary = `----bucksbridge${Date.now().toString(16)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="block"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(data), tail]);
    const req = http.request(
      `${KUBO_API_URL}/api/v0/block/put?cid-codec=raw&pin=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let out = "";
        res.on("data", (d) => (out += d));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`block/put HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("block/put timeout")));
    req.end(body);
  });
}

const FETCH_TIMEOUT_MS = 30_000; // bound bitswap fetches so HTTP calls can't hang

async function heliaPin(cidStr) {
  const heliaNode = _ipfs.getHeliaNode();
  const fsModule = _ipfs.getFsModule();
  if (!heliaNode || !fsModule) throw new Error("IPFS node not initialized");
  const { CID } = await import("multiformats/cid");
  const cid = CID.parse(cidStr);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  // Ensure blocks are local first (fetch via bitswap if needed)…
  for await (const _chunk of fsModule.cat(cid, { signal })) { /* drain */ }
  // …then pin so GC never evicts them. Already-pinned is fine.
  try {
    for await (const _p of heliaNode.pins.add(cid, { signal })) { /* drain */ }
  } catch (e) {
    if (!/already pinned/i.test(e.message || "")) throw e;
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

// ── Request router ──────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${_boundPort}`);
  const p = url.pathname;

  try {
    // Gateway path: GET /ipfs/<cid>[/sub/path]
    if (p.startsWith("/ipfs/")) {
      const ipfsPath = p.slice("/ipfs/".length);
      const content = await withTimeout(_ipfs.getContent(ipfsPath), FETCH_TIMEOUT_MS, "gateway fetch");
      const buf = Buffer.from(content);
      res.writeHead(200, {
        "Content-Type": sniffContentType(buf, ipfsPath),
        "Content-Length": buf.length,
        "X-Ipfs-Path": p,
      });
      return res.end(buf);
    }

    if (p === "/api/v0/version") {
      return sendJson(res, 200, {
        Version: "0.0.0-bucks-helia",
        AgentVersion: BRIDGE_AGENT_VERSION,
        System: `${os.arch()}/${os.platform()}`,
      });
    }

    if (p === "/api/v0/id") {
      const heliaNode = _ipfs.getHeliaNode();
      if (!heliaNode) return sendJson(res, 503, { Message: "IPFS node not initialized" });
      return sendJson(res, 200, {
        ID: heliaNode.libp2p.peerId.toString(),
        Addresses: heliaNode.libp2p.getMultiaddrs().map((a) => a.toString()),
        AgentVersion: BRIDGE_AGENT_VERSION,
        Protocols: [],
      });
    }

    if (p === "/api/v0/add") {
      const body = await readBody(req);
      const part = parseMultipart(body, req.headers["content-type"]);
      if (!part) return sendJson(res, 400, { Message: "expected multipart/form-data with a file part" });
      const result = await heliaAdd(part.data, part.filename);
      if (url.searchParams.get("pin") !== "false") {
        try { await heliaPin(result.Hash); } catch { /* local add already cached blocks */ }
      }
      return sendJson(res, 200, result);
    }

    if (p === "/api/v0/add-dir" && req.method === "POST") {
      const body = await readBody(req);
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); }
      catch { return sendJson(res, 400, { Message: "expected JSON body" }); }
      const { dirPath } = payload;
      if (!dirPath) return sendJson(res, 400, { Message: "required: dirPath (local filesystem path)" });
      const result = await heliaAddDir(dirPath);
      if (url.searchParams.get("pin") !== "false") {
        try { await heliaPin(result.Hash); } catch { /* local add already cached blocks */ }
      }
      return sendJson(res, 200, result);
    }

    if (p === "/api/v0/cat") {
      const arg = url.searchParams.get("arg");
      if (!arg) return sendJson(res, 400, { Message: "argument \"ipfs-path\" is required" });
      const content = await withTimeout(
        _ipfs.getContent(arg.replace(/^\/?ipfs\//, "")), FETCH_TIMEOUT_MS, "cat",
      );
      const buf = Buffer.from(content);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": buf.length });
      return res.end(buf);
    }

    if (p === "/api/v0/pin/add") {
      const arg = url.searchParams.get("arg");
      if (!arg) return sendJson(res, 400, { Message: "argument \"ipfs-path\" is required" });
      const cidStr = arg.replace(/^\/?ipfs\//, "");
      await heliaPin(cidStr);
      return sendJson(res, 200, { Pins: [cidStr] });
    }

    // ── Bucks extensions: reach the browser's dweb/swarm layer ────────────
    if (p === "/api/v0/bucks/dweb/publish") {
      const body = await readBody(req);
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); }
      catch { return sendJson(res, 400, { Message: "expected JSON body" }); }
      const { name, title, desc } = payload;
      let cid = payload.cid;
      if (!cid && typeof payload.content === "string") {
        const added = await heliaAdd(Buffer.from(payload.content, "utf8"), name || "page.html");
        cid = added.Hash;
      }
      if (!cid || !name) return sendJson(res, 400, { Message: "required: name + (content | cid)" });
      await _ipfs.publishDweb(name, cid, title || name, desc || "");
      return sendJson(res, 200, { ok: true, cid, name });
    }

    if (p === "/api/v0/bucks/dweb/search") {
      const q = url.searchParams.get("q") || "";
      return sendJson(res, 200, { results: _ipfs.searchDweb(q) });
    }

    if (p === "/api/v0/bucks/dweb/index") {
      return sendJson(res, 200, { results: _ipfs.getDwebIndex() });
    }

    if (p === "/api/v0/bucks/node/info") {
      return sendJson(res, 200, _ipfs.getNodeInfo());
    }

    // ── Cluster membership: read-only. Deliberately no admit endpoint here —
    // admission is a trust-boundary action that only the renderer's explicit
    // user-click flow may perform (see cluster-membership.js header comment
    // and main.js's 'cluster-admit' IPC handler). Agent tools built on this
    // bridge (agent/tools/cluster_tools.py) can therefore never admit a peer,
    // even if a future tool schema mistakenly tried to. ──
    if (p === "/api/v0/bucks/cluster/members") {
      const clusterMembership = require("./cluster-membership");
      return sendJson(res, 200, { members: clusterMembership.getMembers() });
    }

    if (p === "/api/v0/bucks/cluster/discovered") {
      const clusterMembership = require("./cluster-membership");
      return sendJson(res, 200, { discovered: clusterMembership.getDiscovered() });
    }

    if (p === "/api/v0/bucks/cluster/identity") {
      const clusterMembership = require("./cluster-membership");
      return sendJson(res, 200, await clusterMembership.getMyIdentity());
    }

    // ── File listings (agent/tools/cluster_tools.py) ──
    if (p === "/api/v0/bucks/files/mine") {
      return sendJson(res, 200, _ipfs.getStorageStats());
    }

    if (p === "/api/v0/bucks/files/cluster") {
      return sendJson(res, 200, { feed: _ipfs.getFeed() });
    }

    // ── Recommend / not-recommend — pure network signal, independent of pin ──
    if (p === "/api/v0/bucks/cluster/votes") {
      const cid = url.searchParams.get("cid") || "";
      return sendJson(res, 200, _ipfs.getVoteCounts(cid));
    }

    if (p === "/api/v0/bucks/cluster/vote" && req.method === "POST") {
      const body = await readBody(req);
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); }
      catch { return sendJson(res, 400, { Message: "expected JSON body" }); }
      const { cid, direction } = payload;
      if (!cid || (direction !== "up" && direction !== "down")) {
        return sendJson(res, 400, { Message: "required: cid + direction ('up'|'down')" });
      }
      const result = direction === "down" ? await _ipfs.unrecommendContent(cid) : await _ipfs.recommendContent(cid);
      return sendJson(res, 200, result);
    }

    // ── Pin / unpin — standalone "host this locally", no vote ──
    if (p === "/api/v0/bucks/cluster/pin" && req.method === "POST") {
      const body = await readBody(req);
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); }
      catch { return sendJson(res, 400, { Message: "expected JSON body" }); }
      const { cid, unpin } = payload;
      if (!cid) return sendJson(res, 400, { Message: "required: cid" });
      const result = unpin ? await _ipfs.unpinContent(cid) : await _ipfs.pinContent(cid);
      return sendJson(res, 200, result);
    }

    // ── Release publish (build-and-pin-release.js talks to this running
    // instance's own bridge — it must already be a cluster member, same as
    // any other node pinning content). Manifest signature is verified again
    // by every RECEIVING member against RELEASE_PUBLISHER_PUBKEY, so a bad
    // actor calling this on their own machine only broadcasts something
    // every other node will reject. ──
    if (p === "/api/v0/bucks/release/announce" && req.method === "POST") {
      const body = await readBody(req);
      let payload;
      try { payload = JSON.parse(body.toString("utf8")); }
      catch { return sendJson(res, 400, { Message: "expected JSON body" }); }
      const { manifestCid, manifest } = payload;
      if (!manifestCid || !manifest) return sendJson(res, 400, { Message: "required: manifestCid + manifest" });
      const clusterUpdater = require("./cluster-updater");
      const result = await clusterUpdater.announceRelease(manifestCid, manifest);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { Message: `unknown endpoint: ${p}` });
  } catch (err) {
    console.error(`[Bridge] ${req.method} ${p} failed:`, err.message);
    return sendJson(res, 500, { Message: err.message, Type: "error" });
  }
}

// ── Endpoint manifest (~/.bucks/ipfs.json) ─────────────────────────────────

function writeManifest() {
  const heliaNode = _ipfs.getHeliaNode();
  const bridgeUrl = _boundPort ? `http://127.0.0.1:${_boundPort}` : null;
  const gatewayUrls = [];
  if (_kuboInfo) gatewayUrls.push(`${KUBO_GATEWAY_URL}/ipfs/`);
  if (bridgeUrl) gatewayUrls.push(`${bridgeUrl}/ipfs/`);
  gatewayUrls.push("https://ipfs.io/ipfs/", "https://dweb.link/ipfs/");

  const manifest = {
    mode: _kuboInfo ? "kubo+bridge" : "bridge-only",
    apiUrl: _kuboInfo ? KUBO_API_URL : bridgeUrl,
    bridgeUrl,
    gatewayUrls,
    peerId: heliaNode ? heliaNode.libp2p.peerId.toString() : null,
    kubo: _kuboInfo
      ? { present: true, apiUrl: KUBO_API_URL, gatewayUrl: KUBO_GATEWAY_URL, peerId: _kuboInfo.id }
      : { present: false },
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(BUCKS_HOME, { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`[Bridge] Endpoint manifest written: ${MANIFEST_FILE} (mode=${manifest.mode}, api=${manifest.apiUrl})`);
  } catch (e) {
    console.error("[Bridge] Failed to write endpoint manifest:", e.message);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/**
 * Start the bridge. `ipfsModule` is ./ipfs-node (or any object exposing
 * getHeliaNode, getFsModule, getContent, connectPeer, publishDweb,
 * searchDweb, getDwebIndex, getNodeInfo). Call after startNode().
 */
async function start(ipfsModule) {
  _ipfs = ipfsModule;

  _kuboInfo = await detectKubo();

  // Bind the Kubo-compat API: take :5001 only when no Kubo daemon holds it,
  // so an agent with default config talks to whichever node exists.
  const tryPorts = _kuboInfo ? [FALLBACK_PORT] : [PREFERRED_PORT, FALLBACK_PORT];
  for (const port of tryPorts) {
    try {
      _server = await listenOn(port);
      _boundPort = port;
      break;
    } catch (e) {
      console.warn(`[Bridge] Port ${port} unavailable (${e.message})`);
    }
  }
  if (_server) {
    console.log(`[Bridge] Kubo-compatible API serving Helia node at http://127.0.0.1:${_boundPort}`);
  } else {
    console.error("[Bridge] Could not bind any API port — agent falls back to Kubo/gateways only.");
  }

  if (_kuboInfo) {
    console.log(`[Bridge] Local Kubo daemon detected (${_kuboInfo.agent}) — starting peering loop.`);
    await peerWithKubo();
    _peeringTimer = setInterval(() => {
      peerWithKubo().catch(() => {});
    }, PEERING_INTERVAL_MS);
  } else {
    console.log("[Bridge] No local Kubo daemon — Helia bridge is the primary IPFS API.");
  }

  writeManifest();
  return { port: _boundPort, kubo: !!_kuboInfo };
}

function stop() {
  if (_peeringTimer) {
    clearInterval(_peeringTimer);
    _peeringTimer = null;
  }
  if (_server) {
    _server.close();
    _server = null;
    _boundPort = null;
  }
}

module.exports = { start, stop, detectKubo };

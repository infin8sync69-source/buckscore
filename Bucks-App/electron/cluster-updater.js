/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  BUCKS CLUSTER UPDATER — releases distributed over the      ║
 * ║  cluster's own IPFS swarm, replacing GitHub-releases        ║
 * ║  electron-updater entirely.                                 ║
 * ║                                                            ║
 * ║  Trust model: deliberately NOT the peer-admission graph     ║
 * ║  (cluster-membership.js). Letting any admitted member sign  ║
 * ║  something that auto-runs on every other member's machine   ║
 * ║  is a supply-chain risk out of proportion to "can add a     ║
 * ║  friend" — so release manifests are only trusted if signed  ║
 * ║  by a single hardcoded maintainer key, independent of who's ║
 * ║  been invited into the cluster.                              ║
 * ║                                                            ║
 * ║  Flow: scripts/build-and-pin-release.js (run on the         ║
 * ║  maintainer's own already-running Bucks instance) builds,   ║
 * ║  pins, signs, and asks this module (via ipfs-bridge.js) to  ║
 * ║  gossip-announce the new manifest CID. Every other member's ║
 * ║  running app verifies the signature, and — if newer than    ║
 * ║  its own version — offers the update. Downloading it also   ║
 * ║  self-pins the artifact, so that member becomes a           ║
 * ║  distribution source for the next one (no central server).  ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, shell } = require("electron");
const { verifyEd25519 } = require("./crypto-utils");

const CLUSTER_SECRET =
  process.env.BUCKS_CLUSTER_SECRET || "BUCKS_DEFAULT_CLUSTER";
const RELEASE_TOPIC = `bucks-release-${crypto.createHash("sha256").update(CLUSTER_SECRET).digest("hex").slice(0, 16)}`;

// Single maintainer key, independent of cluster-membership admission.
// Empty by default: with no configured publisher, every announce is
// rejected (fails closed) rather than silently trusting the first signer
// that shows up. scripts/build-and-pin-release.js prints this value the
// first time it generates a release-signing key.
const RELEASE_PUBLISHER_PUBKEY = process.env.BUCKS_RELEASE_PUBLISHER_PUBKEY || "";

const REANNOUNCE_INTERVAL_MS = 5 * 60_000; // keep the release discoverable for late joiners

let _ipfs = null;
let _mainWindow = null;
let _dataFile = null;
let _reannounceTimer = null;

let pendingUpdate = null;   // verified, newer-than-us manifest awaiting user action
let publishedRelease = null; // the last release *this* instance announced (if any)
let _applying = false;      // guards against overlapping apply attempts

function isNewerVersion(v1, v2) {
  const p1 = v1.split(".").map(Number);
  const p2 = v2.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) > (p2[i] || 0)) return true;
    if ((p1[i] || 0) < (p2[i] || 0)) return false;
  }
  return false;
}

function manifestSigningPayload(manifest) {
  const cids = manifest.artifacts.map((a) => a.cid).sort();
  // Must match scripts/build-and-pin-release.js's payload construction
  // exactly, field-for-field — appTree.rootCid is included so a swapped
  // directory CID invalidates the signature just like a swapped artifact
  // CID would.
  return [
    manifest.version, manifest.releasedAt, cids.join(","),
    manifest.publisherSoulId, manifest.tier, manifest.appTree ? manifest.appTree.rootCid : "",
  ].join("|");
}

function persistHistory() {
  if (!_dataFile) return;
  try {
    fs.writeFileSync(_dataFile, JSON.stringify({ publishedRelease }, null, 2), "utf8");
  } catch (e) {
    console.error("[ClusterUpdater] Failed to persist release history:", e.message);
  }
}

function loadHistory() {
  if (!_dataFile || !fs.existsSync(_dataFile)) return;
  try {
    const data = JSON.parse(fs.readFileSync(_dataFile, "utf8"));
    publishedRelease = data.publishedRelease || null;
  } catch (e) {
    console.error("[ClusterUpdater] Failed to load release history:", e.message);
  }
}

function pickArtifact(manifest) {
  const sourceArtifact = manifest.artifacts.find((a) => a.kind === "source-tarball");
  if (sourceArtifact) return sourceArtifact;

  const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
  const arch = process.arch;
  return (
    manifest.artifacts.find((a) => a.platform === platform && a.arch === arch) ||
    manifest.artifacts.find((a) => a.platform === platform)
  );
}

async function handleReleaseMessage(msg) {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    if (data.type !== "release_announce" || !data.manifestCid) return;
    if (!RELEASE_PUBLISHER_PUBKEY) {
      console.warn("[ClusterUpdater] Ignoring release announce — no BUCKS_RELEASE_PUBLISHER_PUBKEY configured, failing closed.");
      return;
    }
    if (data.publisherSoulId !== RELEASE_PUBLISHER_PUBKEY) return; // not our trusted publisher

    const bytes = await _ipfs.getContent(data.manifestCid);
    const manifest = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (manifest.publisherSoulId !== RELEASE_PUBLISHER_PUBKEY) return;

    const payload = manifestSigningPayload(manifest);
    if (!verifyEd25519(RELEASE_PUBLISHER_PUBKEY, payload, manifest.signature)) {
      console.warn(`[ClusterUpdater] Dropped release manifest with bad signature: ${manifest.version}`);
      return;
    }

    if (!isNewerVersion(manifest.version, app.getVersion())) return; // not newer, nothing to do

    pendingUpdate = { manifestCid: data.manifestCid, manifest };
    console.log(`[ClusterUpdater] Update available via cluster: v${manifest.version} (current v${app.getVersion()}, tier: ${manifest.tier})`);

    // Routine tier (JS/HTML/CSS/assets only) applies automatically — this is
    // what makes updates "seamless" rather than a manual download+click.
    // Runtime tier (Electron/native dep changed) still needs the user's
    // explicit go-ahead, since it means a real reinstall.
    if (manifest.tier === "routine" && manifest.appTree && !_applying) {
      console.log("[ClusterUpdater] Routine update — applying automatically.");
      applyPendingUpdate().catch((e) => console.error("[ClusterUpdater] Auto-apply failed:", e.message));
    } else if (_mainWindow && _mainWindow.webContents) {
      _mainWindow.webContents.send("cluster-update-available", manifest);
    }
  } catch (e) {
    console.error("[ClusterUpdater] Failed to handle release announce:", e.message);
  }
}

/** Called by ipfs-bridge.js's /api/v0/bucks/release/announce route, invoked
 * by scripts/build-and-pin-release.js after it pins a new build. */
async function announceRelease(manifestCid, manifest) {
  const gossip = _ipfs.getGossip();
  if (!gossip) throw new Error("Gossip not available");

  const announcement = {
    type: "release_announce",
    manifestCid,
    version: manifest.version,
    publisherSoulId: manifest.publisherSoulId,
    timestamp: Date.now(),
  };
  await gossip.publish(RELEASE_TOPIC, new TextEncoder().encode(JSON.stringify(announcement)));

  publishedRelease = { manifestCid, version: manifest.version, publisherSoulId: manifest.publisherSoulId };
  persistHistory();
  _scheduleReannounce();
  console.log(`[ClusterUpdater] Announced release v${manifest.version} (${manifestCid})`);
  return { ok: true };
}

function _scheduleReannounce() {
  if (_reannounceTimer) clearInterval(_reannounceTimer);
  _reannounceTimer = setInterval(async () => {
    if (!publishedRelease) return;
    const gossip = _ipfs.getGossip();
    if (!gossip) return;
    const announcement = {
      type: "release_announce",
      manifestCid: publishedRelease.manifestCid,
      version: publishedRelease.version,
      publisherSoulId: publishedRelease.publisherSoulId,
      timestamp: Date.now(),
    };
    try {
      await gossip.publish(RELEASE_TOPIC, new TextEncoder().encode(JSON.stringify(announcement)));
    } catch (e) { /* best-effort */ }
  }, REANNOUNCE_INTERVAL_MS);
}

/** Dispatches on the pending manifest's tier. Routine updates apply
 * automatically with no installer UI; runtime updates keep today's
 * download-installer-and-click-through behavior. */
async function applyPendingUpdate() {
  if (!pendingUpdate) return { ok: false, error: "no pending update" };
  if (_applying) return { ok: false, error: "an update is already being applied" };
  _applying = true;
  try {
    const { manifest } = pendingUpdate;
    if (manifest.tier === "routine" && manifest.appTree) {
      return await applyRoutineUpdate(manifest);
    }
    const artifact = pickArtifact(manifest);
    if (artifact && artifact.kind === "source-tarball") {
      return await applySourceTarballUpdate(manifest, artifact);
    }
    return await applyRuntimeUpdate(manifest);
  } finally {
    _applying = false;
  }
}

/** Source-tarball update: fetch the source tarball, verify its checksum,
 * extract it over the existing repository directory, re-run the install script,
 * and relaunch the app. */
async function applySourceTarballUpdate(manifest, artifact) {
  const fsModule = _ipfs.getFsModule();
  if (!fsModule) return { ok: false, error: "IPFS node not initialized" };

  const appDir = path.dirname(require.main.filename);
  const repoDir = path.resolve(appDir, "..");
  const stagingDir = path.join(os.tmpdir(), `bucks-update-src-staging-${manifest.version}-${Date.now()}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    const bytes = await _ipfs.getContent(artifact.cid);
    const buf = Buffer.from(bytes);

    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha !== artifact.sha256) {
      return { ok: false, error: `checksum mismatch (expected ${artifact.sha256}, got ${sha})` };
    }

    const tarballPath = path.join(stagingDir, artifact.filename);
    fs.writeFileSync(tarballPath, buf);

    // Self-seed the downloaded CID
    try {
      await _ipfs.upvoteContent(artifact.cid);
    } catch (e) {
      console.warn("[ClusterUpdater] Self-pin of downloaded artifact failed:", e.message);
    }

    // Extract tarball using tar CLI
    const { execSync } = require("child_process");
    execSync(`tar -xzf "${tarballPath}" -C "${stagingDir}"`);

    const extractedRepoDir = path.join(stagingDir, "bucks-browser");
    if (!fs.existsSync(extractedRepoDir)) {
      throw new Error("Extracted archive did not contain 'bucks-browser' folder");
    }

    // Perform atomic directory swap
    const backupDir = `${repoDir}.bak-${Date.now()}`;
    try {
      fs.renameSync(repoDir, backupDir);
      fs.renameSync(extractedRepoDir, repoDir);
    } catch (swapErr) {
      if (fs.existsSync(backupDir) && !fs.existsSync(repoDir)) fs.renameSync(backupDir, repoDir);
      throw swapErr;
    }

    // Clean up backup directory asynchronously
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }

    // Run platform install script non-interactively
    console.log(`[ClusterUpdater] Running post-update installation script in ${repoDir}...`);
    if (process.platform === "win32") {
      execSync(`powershell.exe -ExecutionPolicy Bypass -File "${path.join(repoDir, "install.ps1")}"`, { cwd: repoDir, stdio: "inherit" });
    } else {
      execSync(`bash "${path.join(repoDir, "install.sh")}"`, { cwd: repoDir, stdio: "inherit" });
    }

    console.log(`[ClusterUpdater] Source update v${manifest.version} installed — relaunching.`);
    if (_mainWindow && _mainWindow.webContents) {
      _mainWindow.webContents.send("cluster-update-restarting", manifest);
    }
    app.relaunch();
    app.exit();
    return { ok: true, tier: "source" };

  } catch (e) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return { ok: false, error: `failed to apply source-tarball update: ${e.message}` };
  }
}

/** Walk a UnixFS directory CID and write it out to a real filesystem path. */
async function writeTreeToDisk(fsModule, cid, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for await (const entry of fsModule.ls(cid)) {
    const destPath = path.join(destDir, entry.name);
    if (entry.type === "directory") {
      await writeTreeToDisk(fsModule, entry.cid, destPath);
    } else {
      const chunks = [];
      for await (const chunk of fsModule.cat(entry.cid)) chunks.push(chunk);
      fs.writeFileSync(destPath, Buffer.concat(chunks));
    }
  }
}

/** Routine tier: fetch only the blocks not already held locally (Helia/
 * Bitswap skips blocks it already has — no bespoke diffing needed), stage
 * them into a fresh directory, then atomically swap them into the running
 * app's own directory and relaunch. No installer, no manual click.
 *
 * Needs real-world verification per-OS (noted in the plan): renaming a
 * directory out from under the currently-executing process is expected to
 * work on macOS/Linux, but Windows file-locking semantics for the app's own
 * directory should be specifically tested before relying on this in
 * production. If the swap fails for any reason, this rolls back and falls
 * through to reporting an error rather than leaving a half-updated app. */
async function applyRoutineUpdate(manifest) {
  const fsModule = _ipfs.getFsModule();
  if (!fsModule) return { ok: false, error: "IPFS node not initialized" };

  const appDir = path.dirname(require.main.filename);
  const stagingDir = path.join(os.tmpdir(), `bucks-update-staging-${manifest.version}-${Date.now()}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  try {
    // BUG FIX: fsModule.ls() requires a CID object, not a plain string.
    // Passing a raw string throws TypeError: Expected CID.
    const { CID } = await import("multiformats/cid");
    const rootCid = CID.parse(manifest.appTree.rootCid);
    await writeTreeToDisk(fsModule, rootCid, stagingDir);
  } catch (e) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    return { ok: false, error: `failed to fetch update tree: ${e.message}` };
  }

  const backupDir = `${appDir}.bak-${Date.now()}`;
  try {
    fs.renameSync(appDir, backupDir);
    fs.renameSync(stagingDir, appDir);
  } catch (e) {
    // Best-effort rollback so a failed swap doesn't leave the app unable to start.
    if (fs.existsSync(backupDir) && !fs.existsSync(appDir)) fs.renameSync(backupDir, appDir);
    return { ok: false, error: `failed to swap in update: ${e.message}` };
  }
  fs.rmSync(backupDir, { recursive: true, force: true });

  console.log(`[ClusterUpdater] Routine update v${manifest.version} staged — relaunching.`);
  if (_mainWindow && _mainWindow.webContents) {
    _mainWindow.webContents.send("cluster-update-restarting", manifest);
  }
  app.relaunch();
  app.exit();
  return { ok: true, tier: "routine" };
}

/** Runtime tier (Electron/native dep changed, or no appTree available for
 * this release): download the platform installer, verify its checksum,
 * self-pin it (this node becomes a source for the next downloader), and
 * hand off to the OS installer — unchanged from the original behavior,
 * still requires the user to click through manually. */
async function applyRuntimeUpdate(manifest) {
  const artifact = pickArtifact(manifest);
  if (!artifact) return { ok: false, error: `no artifact for ${process.platform}/${process.arch}` };

  const bytes = await _ipfs.getContent(artifact.cid);
  const buf = Buffer.from(bytes);

  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha !== artifact.sha256) {
    return { ok: false, error: `checksum mismatch (expected ${artifact.sha256}, got ${sha})` };
  }

  const outDir = path.join(os.tmpdir(), "bucks-cluster-update");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, artifact.filename);
  fs.writeFileSync(outPath, buf);

  // Self-seed: pin the verified artifact so this node can serve it to the
  // next member who updates — the "act as a distribution node" requirement.
  try {
    await _ipfs.upvoteContent(artifact.cid);
  } catch (e) {
    console.warn("[ClusterUpdater] Self-pin of downloaded artifact failed (update still valid):", e.message);
  }

  await shell.openPath(outPath);
  return { ok: true, tier: "runtime", path: outPath };
}

function getPendingUpdate() {
  return pendingUpdate;
}

async function start(ipfsModule, mainWindow) {
  _ipfs = ipfsModule;
  _mainWindow = mainWindow;

  const IPFS_DATA_DIR = path.join(app.getPath("userData"), "ipfs-data");
  fs.mkdirSync(IPFS_DATA_DIR, { recursive: true });
  _dataFile = path.join(IPFS_DATA_DIR, "releases.json");
  loadHistory();

  const gossip = _ipfs.getGossip();
  if (!gossip) {
    console.warn("[ClusterUpdater] Gossip not ready — updater inactive this session.");
    return;
  }
  gossip.addEventListener("message", (evt) => {
    if (evt.detail.topic === RELEASE_TOPIC) handleReleaseMessage(evt.detail);
  });
  gossip.subscribe(RELEASE_TOPIC);

  if (publishedRelease) _scheduleReannounce();

  console.log(`[ClusterUpdater] Active. Topic: ${RELEASE_TOPIC}${RELEASE_PUBLISHER_PUBKEY ? "" : " (no publisher key configured — updates disabled)"}`);
}

function stop() {
  if (_reannounceTimer) {
    clearInterval(_reannounceTimer);
    _reannounceTimer = null;
  }
}

module.exports = {
  start,
  stop,
  announceRelease,
  applyPendingUpdate,
  getPendingUpdate,
  RELEASE_TOPIC,
};

// bucks browser/scripts/test-ipfs.mjs
// IPFS infrastructure experiment for Bucks — Chain 8192
// Standalone Helia/libp2p stress test, independent of Electron.
// Run: node scripts/test-ipfs.mjs

import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { bitswap } from '@helia/block-brokers';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { mplex } from '@libp2p/mplex';
import { bootstrap } from '@libp2p/bootstrap';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { mdns } from '@libp2p/mdns';
import { fromString, toString } from 'uint8arrays';

const BOOTSTRAP_LIST = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
}

async function createNode(port, { withBootstrap = false } = {}) {
  const peerDiscovery = [mdns({ interval: 2000 })];
  if (withBootstrap) {
    peerDiscovery.push(bootstrap({ list: BOOTSTRAP_LIST, timeout: 5000 }));
  }

  const libp2p = await createLibp2p({
    addresses: { listen: [`/ip4/0.0.0.0/tcp/${port}`, `/ip4/0.0.0.0/tcp/${port + 1}/ws`] },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux(), mplex()],
    peerDiscovery,
    services: {
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
    },
  });

  const helia = await createHelia({
    libp2p,
    blockBrokers: [bitswap()],
  });
  return helia;
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Bucks IPFS Infrastructure Experiment  ║');
  console.log('║  Chain 8192 — Helia + libp2p test      ║');
  console.log('╚════════════════════════════════════════╝\n');

  // ── Test 1: Single node startup ─────────────────────────────────────────────
  console.log('TEST 1: Node startup...');
  const t1 = Date.now();
  let nodeA;
  try {
    nodeA = await Promise.race([
      createNode(4010),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
    ]);
    const ms = Date.now() - t1;
    console.log(`✅ Node A started in ${ms}ms`);
    console.log(`   PeerID: ${nodeA.libp2p.peerId.toString()}`);
    console.log(`   Listening on: ${nodeA.libp2p.getMultiaddrs().map((a) => a.toString()).join(', ')}`);
    record('Node startup', true, `${ms}ms`);
  } catch (e) {
    console.log(`❌ Node startup failed: ${e.message}`);
    record('Node startup', false, e.message);
    process.exit(1);
  }

  // ── Test 2: Add and retrieve a string (via unixfs, no @helia/strings) ───────
  console.log('\nTEST 2: Add + retrieve string content...');
  try {
    const fsA = unixfs(nodeA);
    const testContent = `Bucks Chain 8192 — Soul Engine IPFS test at ${new Date().toISOString()}`;
    const cid = await fsA.addBytes(fromString(testContent));
    console.log(`✅ Added string. CID: ${cid.toString()}`);
    const chunks = [];
    for await (const chunk of fsA.cat(cid)) chunks.push(chunk);
    const retrieved = toString(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const match = retrieved === testContent;
    console.log(`✅ Retrieved: "${retrieved.slice(0, 60)}..."`);
    console.log(`   Content match: ${match ? '✅ PASS' : '❌ FAIL'}`);
    record('String add/get', match, cid.toString());
  } catch (e) {
    console.log(`❌ String add/get failed: ${e.message}`);
    record('String add/get', false, e.message);
  }

  // ── Test 3: Add and retrieve JSON (Soul Profile format) ─────────────────────
  console.log('\nTEST 3: Add + retrieve JSON Soul Profile...');
  try {
    const fsA = unixfs(nodeA);
    const profile = {
      type: 'SoulProfile',
      version: '1.0.0',
      chain: 8192,
      address: '0x' + 'a'.repeat(40),
      displayName: 'SoulUser_Test',
      createdAt: new Date().toISOString(),
      capabilities: ['messaging', 'inference', 'mining'],
    };
    const cid = await fsA.addBytes(fromString(JSON.stringify(profile)));
    console.log(`✅ Soul Profile added. CID: ${cid.toString()}`);
    const chunks = [];
    for await (const chunk of fsA.cat(cid)) chunks.push(chunk);
    const retrieved = JSON.parse(toString(Buffer.concat(chunks.map((c) => Buffer.from(c)))));
    console.log(`✅ Retrieved profile for: ${retrieved.displayName}`);
    console.log(`   Chain: ${retrieved.chain}, Capabilities: ${retrieved.capabilities.join(', ')}`);
    record('JSON add/get', retrieved.chain === 8192, cid.toString());
  } catch (e) {
    console.log(`❌ JSON add/get failed: ${e.message}`);
    record('JSON add/get', false, e.message);
  }

  // ── Test 4: Add a file (UnixFS) ─────────────────────────────────────────────
  console.log('\nTEST 4: Add + retrieve file via UnixFS...');
  try {
    const fs = unixfs(nodeA);
    const fileContent = new TextEncoder().encode(
      'Bucks Network — Soul Engine GGUF model manifest\nChain: 8192\nToken: BUCKS\n',
    );
    const cid = await fs.addBytes(fileContent);
    console.log(`✅ File added. CID: ${cid.toString()}`);
    const chunks = [];
    for await (const chunk of fs.cat(cid)) chunks.push(chunk);
    const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    console.log(`✅ Retrieved file:\n   ${text.split('\n').join('\n   ')}`);
    record('UnixFS add/cat', true, cid.toString());
  } catch (e) {
    console.log(`❌ UnixFS add/cat failed: ${e.message}`);
    record('UnixFS add/cat', false, e.message);
  }

  // ── Test 5: Two-node local transfer (bitswap) ───────────────────────────────
  console.log('\nTEST 5: Two-node local content transfer (bitswap)...');
  let nodeB;
  try {
    nodeB = await createNode(4020);
    console.log(`✅ Node B started. PeerID: ${nodeB.libp2p.peerId.toString().slice(0, 20)}...`);

    const addrB = nodeB.libp2p.getMultiaddrs().find((a) => a.toString().includes('/tcp/') && !a.toString().includes('/ws'));
    await nodeA.libp2p.dial(addrB);
    console.log(`✅ Nodes connected (dialed ${addrB.toString()})`);

    const fsA = unixfs(nodeA);
    const fsB = unixfs(nodeB);
    const msg = `Cross-node message: ${Date.now()}`;
    const cid = await fsA.addBytes(fromString(msg));
    console.log(`   Added on Node A: ${cid.toString()}`);

    const chunks = [];
    await Promise.race([
      (async () => {
        for await (const chunk of fsB.cat(cid)) chunks.push(chunk);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 10s')), 10000)),
    ]);
    const retrieved = toString(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    console.log(`✅ Retrieved on Node B: "${retrieved}"`);
    const match = retrieved === msg;
    console.log(`   Bitswap transfer: ${match ? 'PASS ✅' : 'FAIL ❌'}`);
    record('Two-node bitswap transfer', match, cid.toString());
  } catch (e) {
    console.log(`❌ Two-node transfer failed: ${e.message}`);
    record('Two-node bitswap transfer', false, e.message);
  }

  // ── Test 6: Bootstrap peer connectivity ─────────────────────────────────────
  // Deliberately an ISOLATED third node, not nodeA/nodeB: the production
  // design (electron/ipfs-node.js) never joins the public IPFS bootstrap
  // network (mDNS + optional BUCKS_BOOTSTRAP_PEERS only). Testing that here
  // on nodeA polluted its connection manager with ~40 public peers and its
  // kad-dht with server-mode random-walk churn, which broke the LOCAL
  // bitswap/gossipsub/UnixFS tests that follow (see report for details) —
  // so this check runs against a disposable node instead.
  console.log('\nTEST 6: Bootstrap peer discovery (informational, 5s)...');
  let nodeC;
  try {
    nodeC = await createNode(4030, { withBootstrap: true });
    await new Promise((r) => setTimeout(r, 5000));
    const peers = nodeC.libp2p.getPeers();
    console.log(`   Connected peers: ${peers.length}`);
    if (peers.length > 0) {
      console.log(`✅ Peers found: ${peers.slice(0, 3).map((p) => p.toString().slice(0, 20) + '...').join(', ')}`);
      record('Bootstrap peer discovery', true, `${peers.length} peers (informational — public net, not used in prod)`);
    } else {
      console.log(`⚠️  No bootstrap peers (may need internet or longer wait)`);
      record('Bootstrap peer discovery', false, 'no peers connected (informational — not required for LAN-only design)');
    }
  } catch (e) {
    console.log(`⚠️  Peer discovery check failed: ${e.message}`);
    record('Bootstrap peer discovery', false, e.message);
  } finally {
    if (nodeC) await nodeC.stop();
  }

  // ── Test 7: GossipSub pubsub ────────────────────────────────────────────────
  console.log('\nTEST 7: GossipSub pubsub messaging...');
  try {
    const TOPIC = 'bucks/chain8192/messages/v1';

    let received = null;
    nodeB?.libp2p.services.pubsub.subscribe(TOPIC);
    nodeB?.libp2p.services.pubsub.addEventListener('message', (evt) => {
      if (evt.detail.topic === TOPIC) received = toString(evt.detail.data);
    });
    nodeA.libp2p.services.pubsub.subscribe(TOPIC);
    await new Promise((r) => setTimeout(r, 1500)); // mesh settle

    const testMsg = `Chain 8192 pubsub test — ${Date.now()}`;
    await nodeA.libp2p.services.pubsub.publish(TOPIC, fromString(testMsg));
    await new Promise((r) => setTimeout(r, 1500));

    if (received) {
      console.log(`✅ GossipSub delivery confirmed`);
      console.log(`   Sent: ${testMsg}`);
      console.log(`   Recv: ${received}`);
      record('GossipSub pubsub', received === testMsg, 'delivered');
    } else {
      console.log(`⚠️  Message not received (mesh may need more time with 2 peers)`);
      record('GossipSub pubsub', false, 'not received within 1.5s window');
    }
  } catch (e) {
    console.log(`⚠️  GossipSub test: ${e.message}`);
    record('GossipSub pubsub', false, e.message);
  }

  // ── Test 8: Large-ish file chunking (1MB) ───────────────────────────────────
  console.log('\nTEST 8: Large file (1MB) add/cat + cross-node fetch...');
  try {
    const fsA = unixfs(nodeA);
    const fsB = unixfs(nodeB);
    const big = new Uint8Array(1024 * 1024);
    crypto.getRandomValues(big.subarray(0, 65536)); // seed some entropy, rest zero is fine for a byte-match test
    for (let i = 65536; i < big.length; i++) big[i] = big[i % 65536];
    const t0 = Date.now();
    const cid = await fsA.addBytes(big);
    const addMs = Date.now() - t0;
    console.log(`✅ 1MB added in ${addMs}ms. CID: ${cid.toString()}`);

    const t1b = Date.now();
    const chunks = [];
    await Promise.race([
      (async () => {
        for await (const chunk of fsB.cat(cid)) chunks.push(chunk);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 15s')), 15000)),
    ]);
    const fetchMs = Date.now() - t1b;
    const total = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const match = total.length === big.length && Buffer.compare(total, Buffer.from(big)) === 0;
    console.log(`✅ Fetched cross-node in ${fetchMs}ms. Byte match: ${match ? 'PASS ✅' : 'FAIL ❌'}`);
    record('1MB file add + cross-node fetch', match, `add=${addMs}ms fetch=${fetchMs}ms`);
  } catch (e) {
    console.log(`❌ Large file test failed: ${e.message}`);
    record('1MB file add + cross-node fetch', false, e.message);
  }

  // ── Test 9: Directory with index.html (dweb-style resolution) ──────────────
  console.log('\nTEST 9: UnixFS directory + index.html resolution...');
  try {
    const fsA = unixfs(nodeA);
    const files = [
      { path: 'site/index.html', content: '<html><body>Bucks dWeb test page — Chain 8192</body></html>' },
      { path: 'site/style.css', content: 'body { background: #000; }' },
    ];
    let rootCid;
    for await (const entry of fsA.addAll(
      files.map((f) => ({ path: f.path, content: fromString(f.content) })),
    )) {
      if (entry.path === 'site') rootCid = entry.cid;
    }
    if (!rootCid) throw new Error('root directory CID not returned by addAll');
    console.log(`✅ Directory added. Root CID: ${rootCid.toString()}`);

    let indexCid = null;
    for await (const entry of fsA.ls(rootCid)) {
      if (entry.name === 'index.html') indexCid = entry.cid;
    }
    if (!indexCid) throw new Error('index.html not found via ls()');
    const chunks = [];
    for await (const chunk of fsA.cat(indexCid)) chunks.push(chunk);
    const html = toString(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    console.log(`✅ Resolved index.html: "${html.slice(0, 50)}..."`);
    record('Directory + index.html resolution', html.includes('Chain 8192'), rootCid.toString());
  } catch (e) {
    console.log(`❌ Directory resolution failed: ${e.message}`);
    record('Directory + index.html resolution', false, e.message);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  console.log('\n─── Cleanup ────────────────────────────────────────────────');
  await nodeA.stop();
  if (nodeB) await nodeB.stop();
  console.log('✅ Nodes stopped');

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name} — ${r.detail}`);
  }
  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${results.length} tests passed.`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Write machine-readable results for the report step
  const fs = await import('fs');
  fs.writeFileSync(
    new URL('./test-ipfs-results.json', import.meta.url),
    JSON.stringify(results, null, 2),
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

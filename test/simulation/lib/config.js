'use strict';
const path = require('path');
const os = require('os');

const CORE_ROOT = path.resolve(__dirname, '..', '..', '..');
const BROWSER_ELECTRON_DIR = path.join(CORE_ROOT, 'bucks browser', 'electron');
const AGENT_DIR = path.join(CORE_ROOT, 'bucks browser', 'agent');
const NODE_DIR = path.join(CORE_ROOT, 'node');
const MINER_DIR = path.join(CORE_ROOT, 'miner');

const RUN_ROOT = path.join(os.tmpdir(), 'bucks-sim-' + process.pid + '-' + Date.now());

module.exports = {
  CORE_ROOT,
  BROWSER_ELECTRON_DIR,
  AGENT_DIR,
  NODE_DIR,
  MINER_DIR,
  RUN_ROOT,
  // NOT 8192/8194: a real, already-running Bucks-App production instance on
  // this machine (Bucks-App/electron, PID confirmed via `ps aux`, running
  // since before this session) already binds bucks-go's RPC on 8192. Using
  // a distinct port keeps this test run fully isolated from that live
  // instance's real chain data — never talk to it, never race it for the
  // port. eth_chainId itself (the protocol-level eth_chainId of 8192, see
  // node/config/config.go) is unrelated to this and is unaffected.
  NODE_RPC_PORT: 18192,
  MINER_DASHBOARD_PORT: 18194,
  CHAIN_ID: 8192,
  SOUL_ENGINE_BASE_PORT: 8865, // deliberately off :8765 so it never collides with a real running dev instance
  SOUL_ENGINE_POOL_SIZE: parseInt(process.env.SIM_SOUL_POOL || '2', 10),
  SOUL_ENGINE_MODEL: process.env.SIM_SLM_MODEL || 'llama3.2:1b',
  CLUSTER_SECRET: 'bucks-sim-cluster-' + Date.now(), // isolates this run's gossipsub/mDNS mesh from any real running Bucks instance
  // Real-format-but-unreachable libp2p bootstrap entry: RFC 5737 TEST-NET-3
  // (203.0.113.0/24) is reserved for documentation and never routed, so this
  // never actually connects anywhere. It exists only to work around a real
  // bug found in ipfs-node.js: when BUCKS_TESTING=1 and no
  // BUCKS_BOOTSTRAP_PEERS are set, `bootstrapList` is `[]` and
  // `bootstrap({ list: [] })` throws "Bootstrap requires a list of peer
  // addresses" (@libp2p/bootstrap rejects an empty list), crashing
  // startNode() entirely — so BUCKS_TESTING's whole purpose (skip public
  // bootstrap nodes during tests) currently cannot work standalone. See the
  // simulation report for the full writeup; not fixed here since
  // bucks browser/ is off-limits (concurrent work in progress).
  PLACEHOLDER_BOOTSTRAP_PEER: '/ip4/203.0.113.1/tcp/4001/p2p/12D3KooWR3AsVzvcN3QuTTtbsadtQrTC9vZNqcYkX6Fjbgq2ZiU4',
};

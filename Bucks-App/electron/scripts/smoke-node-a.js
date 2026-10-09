const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function main() {
  app.setPath('userData', path.join(os.tmpdir(), 'bucks-smoke-real-a'));
  await app.whenReady();
  const ipfs = require('../ipfs-node.js');
  await ipfs.startNode();
  console.log('[A] peerId:', ipfs.getNodeInfo().peerId);

  // wait for peer connections to settle (mDNS + real Kubo daemon on this box)
  await new Promise(r => setTimeout(r, 3000));
  console.log('[A] peers:', ipfs.getNodeInfo().peers);

  const post = await ipfs.publishContent('Cross-process real ipfs-node.js test — Chain 8192 — ' + Date.now(), {
    name: 'cross-process.txt', type: 'text',
  });
  console.log('[A] published:', post.cid);
  fs.writeFileSync(path.join(os.tmpdir(), 'bucks-smoke-cid.txt'), post.cid);

  // stay alive so B can bitswap-fetch from us
  await new Promise(r => setTimeout(r, 12000));
  await ipfs.stopNode();
  console.log('[A] done');
  process.exit(0);
}
main().catch(e => { console.error('[A] FATAL', e.stack); process.exit(1); });

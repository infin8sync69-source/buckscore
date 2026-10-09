const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function main() {
  app.setPath('userData', path.join(os.tmpdir(), 'bucks-smoke-real-b'));
  await app.whenReady();
  const ipfs = require('../ipfs-node.js');
  await ipfs.startNode();
  console.log('[B] peerId:', ipfs.getNodeInfo().peerId);

  const cid = fs.readFileSync(path.join(os.tmpdir(), 'bucks-smoke-cid.txt'), 'utf8').trim();
  console.log('[B] fetching CID published by A:', cid);

  await new Promise(r => setTimeout(r, 2000));
  console.log('[B] peers before fetch:', ipfs.getNodeInfo().peers);

  const bytes = await ipfs.getContent(cid);
  const text = Buffer.from(bytes).toString('utf8');
  console.log('[B] retrieved:', text);
  console.log('[B] MATCH:', text.includes('Chain 8192') ? 'PASS' : 'FAIL');

  await ipfs.stopNode();
  console.log('[B] done');
  process.exit(text.includes('Chain 8192') ? 0 : 1);
}
main().catch(e => { console.error('[B] FATAL', e.stack); process.exit(1); });

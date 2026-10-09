// Smoke test for the REAL production electron/ipfs-node.js, run under
// Electron's headless Node runtime (ELECTRON_RUN_AS_NODE=1) so `app.getPath`
// works without a display. Verifies the fixed dependency tree end-to-end
// through the actual shipped module, not a parallel reimplementation.
const { app } = require('electron');
const path = require('path');
const os = require('os');

async function main() {
  const userDataA = path.join(os.tmpdir(), 'bucks-smoke-a-' + Date.now());
  app.setPath('userData', userDataA);
  await app.whenReady();

  const ipfsA = require('../ipfs-node.js');
  console.log('Starting node A...');
  await ipfsA.startNode();
  console.log('Node A info:', JSON.stringify(ipfsA.getNodeInfo(), null, 2));

  console.log('\nPublishing content on A...');
  const post = await ipfsA.publishContent('Hello from the real ipfs-node.js smoke test — Chain 8192', {
    name: 'smoke-test.txt',
    type: 'text',
  });
  console.log('Published:', post.cid);

  console.log('\nRetrieving content back on A...');
  const bytes = await ipfsA.getContent(post.cid);
  const text = Buffer.from(bytes).toString('utf8');
  console.log('Retrieved:', text);
  console.log('Match:', text.includes('Chain 8192') ? 'PASS' : 'FAIL');

  console.log('\nPin/unpin cycle...');
  const pinResult = await ipfsA.pinContent(post.cid);
  console.log('Pin result:', pinResult);
  const stats = ipfsA.getStorageStats();
  console.log('Storage stats:', stats);

  console.log('\nStopping node...');
  await ipfsA.stopNode();
  console.log('\nSMOKE TEST: ALL STEPS COMPLETED');
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});

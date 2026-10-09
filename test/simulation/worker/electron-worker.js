'use strict';
// Runs under `electron` with ELECTRON_RUN_AS_NODE=1 (no window/display —
// same pattern as bucks browser/electron/scripts/smoke-*.js, which already
// proves this works for the real production ipfs-node.js/chat-engine.js).
// Talks to the parent harness process over stdio via newline-delimited JSON
// {id, cmd, args} requests -> {id, ok, result} | {id, ok:false, error} replies,
// plus unsolicited {event: 'message', ...} pushes for incoming chat messages.
//
// Read-only with respect to bucks browser/electron: this script only
// `require()`s ipfs-node.js / chat-engine.js, it never edits them.

const { app } = require('electron');
const readline = require('readline');
const path = require('path');

const userDataDir = process.argv[2];
if (!userDataDir) {
  console.error('usage: electron-worker.js <userDataDir>');
  process.exit(1);
}
app.setPath('userData', userDataDir);

let ipfs, chatEngine;
const incomingMessages = [];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(cmd, args) {
  switch (cmd) {
    case 'init': {
      await app.whenReady();
      ipfs = require(path.join(args.electronDir, 'ipfs-node.js'));
      chatEngine = require(path.join(args.electronDir, 'chat-engine.js'));
      await ipfs.startNode();
      await chatEngine.initChat(ipfs.getHeliaNode(), ipfs.getGossip(), ipfs.getFsModule());
      chatEngine.setOnMessageCallback((peerId, message) => {
        incomingMessages.push({ peerId, message, receivedAt: Date.now() });
      });
      const info = ipfs.getNodeInfo();
      return { peerId: info.peerId };
    }
    case 'getNodeInfo':
      return ipfs.getNodeInfo();
    case 'getPeers':
      return { peers: ipfs.getPeers() };
    case 'sendMessage':
      return chatEngine.sendMessage(args.peerId, args.text, args.attachmentCid || null);
    case 'sendFile': {
      const bytes = Buffer.from(args.fileDataBase64, 'base64');
      return chatEngine.sendFile(args.peerId, new Uint8Array(bytes), args.filename);
    }
    case 'getChatHistory':
      return { messages: chatEngine.getChatHistory(args.peerId) };
    case 'getConversations':
      return { conversations: chatEngine.getConversations() };
    case 'getIncoming':
      return { incoming: incomingMessages.splice(0) };
    case 'hasPeerBundle':
      return { has: chatEngine.hasPeerBundle(args.peerId) };
    case 'publishContent':
      return ipfs.publishContent(args.content, args.metadata || {});
    case 'getContent': {
      const bytes = await ipfs.getContent(args.cid);
      return { dataBase64: Buffer.from(bytes).toString('base64') };
    }
    case 'pinContent':
      return ipfs.pinContent(args.cid);
    case 'shutdown':
      await ipfs.stopNode().catch(() => {});
      setTimeout(() => process.exit(0), 50);
      return { ok: true };
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    return send({ id: null, ok: false, error: 'invalid JSON request: ' + e.message });
  }
  handle(req.cmd, req.args || {})
    .then((result) => send({ id: req.id, ok: true, result }))
    .catch((err) => send({ id: req.id, ok: false, error: err && err.stack ? err.stack : String(err) }));
});

process.on('uncaughtException', (err) => {
  send({ event: 'fatal', error: err && err.stack ? err.stack : String(err) });
});

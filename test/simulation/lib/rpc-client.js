'use strict';

let reqId = 1;

async function rpcCall(url, method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(`RPC ${method} failed: ${json.error.message || JSON.stringify(json.error)}`);
    err.rpcError = json.error;
    throw err;
  }
  return json.result;
}

class RpcClient {
  constructor(url) {
    this.url = url;
  }
  call(method, params) {
    return rpcCall(this.url, method, params);
  }
  chainId() { return this.call('eth_chainId'); }
  blockNumber() { return this.call('eth_blockNumber'); }
  getBalance(address) { return this.call('eth_getBalance', [address, 'latest']); }
  getTransactionCount(address) { return this.call('eth_getTransactionCount', [address, 'latest']); }
  gasPrice() { return this.call('eth_gasPrice'); }
  sendRawTransaction(rawHex) { return this.call('eth_sendRawTransaction', [rawHex]); }
  getTransactionByHash(hash) { return this.call('eth_getTransactionByHash', [hash]); }
  bucksGetWork() { return this.call('bucks_getWork'); }
}

module.exports = { RpcClient, rpcCall };

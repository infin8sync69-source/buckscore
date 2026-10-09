'use strict';
// Real secp256k1 keygen + real EIP-155 signing, independent of wallet/'s
// signing code (investigation found wallet/src/background/wallet.ts's
// _hashTransaction()/_rlpEncodeSignedTx() are stubs that hash JSON instead of
// RLP — not real EIP-155). We use the standard @ethereumjs libraries here so
// the harness sends a genuinely well-formed signed transaction, which makes
// the node's handling of it (or lack thereof) an honest test of the node,
// not an artifact of a hand-rolled encoder.
const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');
const { randomBytes } = require('@noble/hashes/utils');
const { Common } = require('@ethereumjs/common');
const { LegacyTransaction } = require('@ethereumjs/tx');
const { bytesToHex, hexToBytes, Address } = require('@ethereumjs/util');
const { CHAIN_ID } = require('./config');

function generateWallet() {
  const privateKey = randomBytes(32);
  const publicKey = secp256k1.getPublicKey(privateKey, false); // uncompressed, 65 bytes
  const addressBytes = keccak_256(publicKey.slice(1)).slice(-20);
  const address = '0x' + Buffer.from(addressBytes).toString('hex');
  return {
    privateKey: bytesToHex(privateKey),
    address,
  };
}

const common = Common.custom({ chainId: CHAIN_ID, defaultHardfork: 'london' }, { baseChain: 1 });

function buildAndSignTx({ privateKey, to, valueWei, nonce, gasPrice, gasLimit }) {
  const txData = {
    nonce: nonce || 0,
    gasPrice: gasPrice || '0x3b9aca00', // 1 gwei
    gasLimit: gasLimit || '0x5208', // 21000
    to,
    value: valueWei || '0x0',
    data: '0x',
  };
  const tx = LegacyTransaction.fromTxData(txData, { common });
  const signed = tx.sign(hexToBytes(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey));
  return {
    rawHex: bytesToHex(signed.serialize()),
    hash: bytesToHex(signed.hash()),
  };
}

module.exports = { generateWallet, buildAndSignTx };

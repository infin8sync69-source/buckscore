/**
 * Shared Ed25519 verify helper. Raw pubkey hex (as used throughout this
 * codebase for soulId / release-publisher keys) is reconstructed as a JWK —
 * this verifies byte-for-byte against Python `cryptography`'s raw Ed25519
 * signatures (both implement RFC 8032), so no cross-language quirks.
 */
const crypto = require("crypto");

function verifyEd25519(pubKeyHex, payload, signatureHex) {
  try {
    const jwk = {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(pubKeyHex, "hex").toString("base64url"),
    };
    const pubKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    return crypto.verify(null, Buffer.from(payload), pubKey, Buffer.from(signatureHex, "hex"));
  } catch (e) {
    return false;
  }
}

module.exports = { verifyEd25519 };

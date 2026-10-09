# ADR 0005: Bucks ID = UUID derived from a self-certifying identity log

**Status:** proposed · **Date:** 2026-10-09

## Context
Four unlinked identity schemes exist; two of them hand users' private keys to a server. The requirement is one global ID per user, issued by nobody, stable across devices and key loss, and compatible with existing `uuid` columns and QR flows.

## Decision
See `03-identity.md`. Unsigned inception body (deterministic CBOR) → blake3 → 128-bit UUID (version 8). The signature is excluded from the hash because ECDSA is malleable. Rotation keys P-256/secp256k1, device keys P-256 hardware-backed, pre-rotation, 72-hour override window, client-side social recovery, attestations as signed log entries. Directory replicated by Bucks nodes, no single operator; optional OpenTimestamps anchoring.

## Alternatives rejected
- Random UUID issued by a node: an issuer owns the users.
- `did:key` alone: no rotation; losing the key loses the identity (the Bucks-global failure mode).
- `did:plc` as is: single directory operator (Bluesky); borrowed the operation/rotation design instead.
- Ed25519 root keys: not hardware-backed on iOS, patchy on Android.

## Consequences
Every app and node needs the same verifier, hence Rust core + test vectors. Existing mobile users migrate transparently (their device key already exists); Bucks-global and Electron users re-create identities.

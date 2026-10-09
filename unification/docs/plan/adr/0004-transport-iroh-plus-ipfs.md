# ADR 0004: iroh for connections, IPFS for content

**Status:** proposed · **Date:** 2026-10-09

## Context
Today: Helia with public bootstrap and shared default topics (Electron), managed Kubo (Tauri), Supabase realtime (mobile), nothing P2P on mobile. Requirement: phones, desktops and nodes interconnected, offline-tolerant, no corporate dependency.

## Decision
- iroh (1.0, June 2026; Rust; Android/iOS bindings) for all device↔device and device↔node streams: dial by key, NAT traversal, relays run by Bucks nodes.
- IPFS (Kubo on nodes/desktop) for immutable content; CIDv1, UnixFS raw-leaves everywhere via `bucks-core` so CIDs match across implementations. Mobile fetches through its home node and verifies locally; no full node on phones.
- Gossip topics are per-locality and per-user, as in the phased plan; the signed Bucks bootstrap list replaces `bootstrap.libp2p.io`.

## Alternatives rejected
- libp2p everywhere including phones: heavy on mobile, battery, and the Electron code showed the discovery pitfalls.
- Nostr/AT Protocol relays: good directory ideas (borrowed in ADR 0005) but the data model does not fit rides/orders.

## Consequences
One more Rust dependency; relays are infrastructure you must run (cheap, stateless). Messaging and sync get the same transport.

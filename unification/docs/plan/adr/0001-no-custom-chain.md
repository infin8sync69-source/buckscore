# ADR 0001: Freeze the C++ chain; no Bucks L1 for now

**Status:** proposed · **Date:** 2026-10-09

## Context
The C++ chain cannot enforce its coinbase amount, accepts duplicate inputs, picks forks by height, does not relay transactions, has an unauthenticated signing oracle, and its wallet most likely derives the same key for every user (see `01-current-state.md §1.4`). A Go node exists only as an arm64 binary with no source in git. The product needs: proof that an event happened at a time, portable trust, and (maybe later) escrow.

## Decision
- Archive the C++ chain. Remove chain UI from the desktop app.
- Use signed events + OpenTimestamps anchoring of the identity-directory root for integrity.
- Payments stay on UPI and cash.
- Re-open only with a concrete requirement a signed receipt cannot meet; then evaluate Cosmos SDK or an existing L2, never resume the custom chain.

## Consequences
Removes the single largest source of false "production ready" claims and the largest security surface. Loses nothing users rely on today. [Certain: no user-facing feature depends on the chain beyond the demo wallet.]

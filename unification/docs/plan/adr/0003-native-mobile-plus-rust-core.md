# ADR 0003: Keep native Android/iOS; share logic through a Rust core via UniFFI

**Status:** proposed · **Date:** 2026-10-09

## Context
Mobile is the most complete code base (16k lines Kotlin, 28k Swift, working CI). It needs hardware-backed keys, foreground location services, biometrics and store-compliant push, all of which are first-class in native and second-class in Tauri mobile (the Tauri team itself said mobile parity lags desktop at 2.0 and has been closing it in minor releases).

## Decision
Native UI stays. Identity, events, store, sync, CID and policy move into `bucks-core` (Rust) exposed through UniFFI. The current `BucksRepository` interface is not the seam (cloud mode bypasses it; 281 direct `Backend*` calls); the seam is the core's API plus a node client generated from the same protocol definitions.

## Alternatives rejected
- Tauri 2 mobile for one codebase: would discard the best code and fight platform APIs.
- Flutter/React Native rewrite: same objection.

## Consequences
Two UIs remain hand-ported (as now, tracked in `docs/PARITY.md`); logic duplication disappears. Adds a Rust toolchain to both mobile builds (cargo-ndk, Xcode framework) once.

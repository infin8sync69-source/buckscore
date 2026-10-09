# ADR 0002: Tauri 2 is the desktop shell; Electron "Bucks Core" features are ported, not shipped

**Status:** proposed · **Date:** 2026-10-09

## Context
Two desktops: Tauri+Svelte in git (clean, small, Rust side already manages Kubo) and Electron "Bucks Core" (richer, 73 MB, macOS arm64 only, source outside git, unauthenticated local services, secrets inside). The Python Soul Engine was first written against the Tauri backend ("so the Tauri backend needs zero changes").

## Decision
Tauri 2 + Svelte 5 + a Rust core. Electron features are ported module by module in the order in `06-roadmap.md` phase 2. The Electron tree is committed to `archive/` as reference only.

## Alternatives rejected
- Ship Electron: cross-platform builds, signing and the security fixes would cost as much as the port and leave two desktops.
- Qt native browser (`legacy_v1/bucks-native-browser`): abandoned, build junk committed, no team capacity for C++ UI.

## Consequences
Short-term feature regression on desktop while ports land; phase 2 ordering puts chat-with-local-model first to minimise it. One Rust core shared with mobile is the payoff.

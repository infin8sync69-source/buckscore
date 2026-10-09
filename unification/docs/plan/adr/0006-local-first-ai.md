# ADR 0006: Local AI by default; cloud providers opt-in and never silent

**Status:** proposed · **Date:** 2026-10-09

## Context
The shipped desktop app defaults to NVIDIA NIM and instructs the model to hide which model is used; the mobile app ships a Gemini key in the APK. Both contradict the stated privacy and sovereignty goals, and both are single-vendor dependencies.

## Decision
- Desktop default: llama.cpp with a blessed small model mirrored on IPFS; Ollama if present.
- Mobile: deterministic rules first (as now), then an on-device GGUF model; Gemini removed.
- Bucks inference nodes advertise an OpenAI-compatible endpoint; users choose one explicitly.
- Any remote provider shows its name in the UI and requires the user's own key.

## Consequences
Quality on weak hardware drops versus a 70B cloud model; the routing bandit already in the agent (`rl/`) can pick a user-chosen node when available. Model mirrors become a node role.

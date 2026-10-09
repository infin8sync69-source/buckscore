# Bucks unification plan and identity core

Added on branch `claude/unification-plan-and-core`. Nothing outside this folder was changed.

- `docs/plan/` the audit, target architecture, identity spec, sovereignty map, roadmap, security triage and ADRs. Start with `docs/plan/07-security-triage.md`.
- `core/bucks-core/` Rust identity core: self-certifying Bucks ID, identity log, signed events. `cd core && cargo test` runs 14 tests.
- `protocol/test-vectors/` cross-implementation vectors. A change there is a protocol break.

This folder is the seed of the future monorepo (see `docs/plan/05-repo-consolidation.md`). It lives here for now so it is backed up on GitHub; move it when the monorepo name is decided.

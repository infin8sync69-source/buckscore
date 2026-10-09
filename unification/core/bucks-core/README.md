# bucks-core

Identity core for Bucks: self-certifying Bucks ID, identity log, device delegation.
Spec: `docs/plan/03-identity.md`. Vectors: `protocol/test-vectors/identity-v1.json`.

```
cargo test                          # from core/
UPDATE_VECTORS=1 cargo test vectors # only when you intend to change the protocol
```

Any change to the vectors file is a protocol break. Other implementations (Kotlin, Swift, node) must reproduce it byte for byte.

Also implemented: signed events (`src/event.rs`), per-device stream verification.

Not done yet: override window for rotation, attestations, recovery, directory, FFI, hardware signers. See section 3.2a of the spec.

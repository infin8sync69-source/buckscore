//! Bucks identity core.
//!
//! A Bucks ID is a 128-bit UUID derived from the BLAKE3 hash of the user's first signed
//! identity operation (the *inception*, without its signature). Nobody issues it, it
//! survives key rotation, and anyone holding the identity log can verify it offline.
//! See `docs/plan/03-identity.md` and `protocol/test-vectors/identity-v1.json`.

pub mod cbor;
mod event;
mod id;
mod log;

pub use id::{BucksId, PubKey};
pub use event::{verify_stream, Event, EventDraft};
pub use log::{replay, verify_log, Device, Op, OpBody, OpSigner, State};

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("encoding: {0}")]
    Encoding(&'static str),
    #[error("invalid key")]
    BadKey,
    #[error("invalid signature")]
    BadSignature,
    #[error("log: {0}")]
    Log(&'static str),
    #[error("invalid id")]
    BadId,
}

//! Signed events: the unit of data in Bucks (a ride request, an order, a post, a message).
//!
//! An event is authored by a Bucks ID, signed by one of that identity's *device* keys, and
//! chained per device (`seq`, `prev`) so a node can detect gaps, reordering and forks.
//! `ctx` is the identity-log sequence number the signer had seen when signing.

use crate::cbor::Value;
use crate::log::{OpSigner, State};
use crate::{BucksId, Error, PubKey};
use p256::ecdsa::{signature::Verifier, Signature};

pub const MAX_PAYLOAD: usize = 64 * 1024;
pub const MAX_TYPE: usize = 64;

/// Everything an event contains except its signature.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventDraft {
    pub kind: String,
    pub author: BucksId,
    pub device: [u8; 16],
    pub seq: u64,
    pub prev: Option<[u8; 32]>,
    pub ctx: u64,
    pub ts: u64,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    /// Namespaced type, e.g. `bucks.ride.request`.
    pub kind: String,
    pub author: BucksId,
    /// Id of the signing device inside the author's identity log.
    pub device: [u8; 16],
    /// Per-device counter starting at 0.
    pub seq: u64,
    /// Hash of this device's previous event, `None` for seq 0.
    pub prev: Option<[u8; 32]>,
    /// Identity-log sequence number the signer had seen.
    pub ctx: u64,
    /// Milliseconds since the Unix epoch, as claimed by the signer. Not trusted for ordering.
    pub ts: u64,
    /// Opaque application bytes (or a CID the application resolves).
    pub payload: Vec<u8>,
    pub sig: [u8; 64],
}

fn b(x: &[u8]) -> Value {
    Value::Bytes(x.to_vec())
}

impl Event {
    fn fields(&self) -> Vec<(String, Value)> {
        vec![
            ("v".into(), Value::Uint(1)),
            ("kind".into(), Value::Text(self.kind.clone())),
            ("author".into(), b(&self.author.0)),
            ("device".into(), b(&self.device)),
            ("seq".into(), Value::Uint(self.seq)),
            ("prev".into(), self.prev.map_or(Value::Null, |p| b(&p))),
            ("ctx".into(), Value::Uint(self.ctx)),
            ("ts".into(), Value::Uint(self.ts)),
            ("payload".into(), b(&self.payload)),
        ]
    }

    pub fn unsigned_bytes(&self) -> Vec<u8> {
        Value::Map(self.fields()).encode()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut f = self.fields();
        f.push(("sig".into(), b(&self.sig)));
        Value::Map(f).encode()
    }

    /// Content id of the event; also the next event's `prev` within the same device stream.
    pub fn hash(&self) -> [u8; 32] {
        *blake3::hash(&self.to_bytes()).as_bytes()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Event, Error> {
        let v = Value::decode(bytes)?;
        let Value::Map(f) = &v else { return Err(Error::Encoding("event must be a map")) };
        if f.len() != 10 || !matches!(v.get("v"), Some(Value::Uint(1))) {
            return Err(Error::Encoding("event fields"));
        }
        let bad = Error::Encoding("event field");
        let (Some(Value::Text(kind)), Some(Value::Bytes(author)), Some(Value::Bytes(device))) =
            (v.get("kind"), v.get("author"), v.get("device"))
        else {
            return Err(bad);
        };
        let (Some(Value::Uint(seq)), Some(Value::Uint(ctx)), Some(Value::Uint(ts))) =
            (v.get("seq"), v.get("ctx"), v.get("ts"))
        else {
            return Err(bad);
        };
        let (Some(Value::Bytes(payload)), Some(Value::Bytes(sig))) = (v.get("payload"), v.get("sig")) else {
            return Err(bad);
        };
        let prev = match v.get("prev") {
            Some(Value::Null) => None,
            Some(Value::Bytes(p)) => Some(<[u8; 32]>::try_from(p.as_slice()).map_err(|_| bad.clone())?),
            _ => return Err(bad),
        };
        let ev = Event {
            kind: kind.clone(),
            author: BucksId(<[u8; 16]>::try_from(author.as_slice()).map_err(|_| bad.clone())?),
            device: <[u8; 16]>::try_from(device.as_slice()).map_err(|_| bad.clone())?,
            seq: *seq,
            prev,
            ctx: *ctx,
            ts: *ts,
            payload: payload.clone(),
            sig: <[u8; 64]>::try_from(sig.as_slice()).map_err(|_| bad)?,
        };
        ev.check_limits()?;
        Ok(ev)
    }

    fn check_limits(&self) -> Result<(), Error> {
        if self.kind.is_empty() || self.kind.len() > MAX_TYPE || self.payload.len() > MAX_PAYLOAD {
            return Err(Error::Encoding("event size limits"));
        }
        Ok(())
    }

    pub fn sign(d: EventDraft, signer: &dyn OpSigner) -> Result<Event, Error> {
        let mut ev = Event {
            kind: d.kind,
            author: d.author,
            device: d.device,
            seq: d.seq,
            prev: d.prev,
            ctx: d.ctx,
            ts: d.ts,
            payload: d.payload,
            sig: [0; 64],
        };
        ev.check_limits()?;
        ev.sig = signer.sign(&ev.unsigned_bytes());
        Ok(ev)
    }

    /// Verify against the author's identity history (`crate::replay` output).
    ///
    /// Accepts only if: the author matches the history's id; `ctx` refers to a state that
    /// exists; the signing device was authorised at `ctx` **and is still authorised in the
    /// latest state**; and the signature (low-S ECDSA P-256) verifies under that device key.
    ///
    /// Open policy question, deliberately strict for now: events from a device that was
    /// later removed stop verifying. A stolen-then-removed device must not be able to
    /// backdate events, and without trusted timestamps we cannot tell old from backdated.
    pub fn verify(&self, history: &[State]) -> Result<(), Error> {
        let latest = history.last().ok_or(Error::Log("empty history"))?;
        if self.author != latest.id {
            return Err(Error::Log("author mismatch"));
        }
        let at_ctx = history.get(self.ctx as usize).ok_or(Error::Log("ctx beyond history"))?;
        let key_at = |s: &State| s.devices.iter().find(|d| d.id == self.device).map(|d| d.key);
        let (k_ctx, k_now) = (key_at(at_ctx), key_at(latest));
        let key: PubKey = match (k_ctx, k_now) {
            (Some(a), Some(c)) if a == c => a,
            _ => return Err(Error::Log("device not authorised")),
        };
        let sig = Signature::from_slice(&self.sig).map_err(|_| Error::BadSignature)?;
        if sig.normalize_s().is_some() {
            return Err(Error::BadSignature);
        }
        key.verifying_key()?
            .verify(&self.unsigned_bytes(), &sig)
            .map_err(|_| Error::BadSignature)
    }
}

/// Verify one device's stream in order: every event verifies, `seq` is contiguous from
/// `start_seq`, and each `prev` is the hash of the event before it.
pub fn verify_stream(events: &[Event], history: &[State], start_seq: u64, start_prev: Option<[u8; 32]>) -> Result<(), Error> {
    let (mut seq, mut prev) = (start_seq, start_prev);
    let device = events.first().map(|e| e.device);
    for e in events {
        if Some(e.device) != device || e.seq != seq || e.prev != prev {
            return Err(Error::Log("broken device stream"));
        }
        e.verify(history)?;
        seq += 1;
        prev = Some(e.hash());
    }
    Ok(())
}

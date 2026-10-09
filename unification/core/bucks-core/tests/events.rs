use bucks_core::*;
use p256::ecdsa::SigningKey;

fn key(l: &str) -> SigningKey {
    SigningKey::from_slice(blake3::hash(l.as_bytes()).as_bytes()).unwrap()
}
fn dev(l: &str, n: u8) -> Device {
    Device { id: [n; 16], key: key(l).public_key(), name: l.into() }
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[allow(clippy::too_many_arguments)]
fn sign(kind: &str, author: BucksId, device: [u8; 16], seq: u64, prev: Option<[u8; 32]>, ctx: u64, ts: u64, payload: Vec<u8>, s: &SigningKey) -> Result<Event, Error> {
    Event::sign(EventDraft { kind: kind.into(), author, device, seq, prev, ctx, ts, payload }, s)
}

struct World { ops: Vec<Op>, history: Vec<State>, id: BucksId, root: SigningKey, phone: SigningKey }

fn world() -> World {
    let (root, phone) = (key("root-primary"), key("phone"));
    let inc = Op::sign(0, None, OpBody::Inception { rotation_keys: vec![root.public_key()], devices: vec![dev("phone", 1)], home: vec![] }, &root);
    let id = inc.bucks_id().unwrap();
    let history = replay(&[inc.clone()]).unwrap();
    World { ops: vec![inc], history, id, root, phone }
}
fn ev(w: &World, seq: u64, prev: Option<[u8; 32]>, payload: &[u8]) -> Event {
    sign("bucks.post.create", w.id, [1; 16], seq, prev, 0, 1_760_000_000_000 + seq, payload.to_vec(), &w.phone).unwrap()
}

#[test]
fn valid_event_and_wire_roundtrip() {
    let w = world();
    let e = ev(&w, 0, None, b"hello");
    e.verify(&w.history).unwrap();
    assert_eq!(Event::from_bytes(&e.to_bytes()).unwrap(), e);
}

#[test]
fn rejects_tamper_wrong_author_unknown_device_and_bad_ctx() {
    let w = world();
    let mut t = ev(&w, 0, None, b"hello");
    t.payload = b"hellp".to_vec();
    assert_eq!(t.verify(&w.history).unwrap_err(), Error::BadSignature);

    let other = BucksId::parse("3f9a6c2e-1b47-8d3c-9e21-7a4b0c5d8e1f").unwrap();
    let e = sign("bucks.x", other, [1; 16], 0, None, 0, 1, vec![], &w.phone).unwrap();
    assert!(e.verify(&w.history).is_err());

    let e = sign("bucks.x", w.id, [9; 16], 0, None, 0, 1, vec![], &w.phone).unwrap();
    assert!(e.verify(&w.history).is_err(), "unknown device id");

    let e = sign("bucks.x", w.id, [1; 16], 0, None, 5, 1, vec![], &w.phone).unwrap();
    assert!(e.verify(&w.history).is_err(), "ctx beyond history");

    let e = sign("bucks.x", w.id, [1; 16], 0, None, 0, 1, vec![], &key("stolen")).unwrap();
    assert_eq!(e.verify(&w.history).unwrap_err(), Error::BadSignature, "wrong key for that device id");
}

#[test]
fn removed_device_stops_verifying_and_cannot_backdate() {
    let mut w = world();
    let tablet = dev("tablet", 2);
    let add = Op::sign(1, Some(w.ops[0].hash()), OpBody::AddDevice { device: tablet }, &w.root);
    let rm = Op::sign(2, Some(add.hash()), OpBody::RemoveDevice { device_id: [1; 16] }, &w.root);
    w.ops.extend([add, rm]);
    let h = replay(&w.ops).unwrap();
    let old = ev(&w, 0, None, b"signed before removal");
    assert_eq!(old.verify(&h).unwrap_err(), Error::Log("device not authorised"));
    // an attacker holding the removed phone key claims ctx 0 to look valid: still rejected
    let backdated = sign("bucks.x", w.id, [1; 16], 7, None, 0, 1, vec![], &w.phone).unwrap();
    assert!(backdated.verify(&h).is_err());
}

#[test]
fn stream_chain_detects_gaps_reorder_and_forks() {
    let w = world();
    let e0 = ev(&w, 0, None, b"a");
    let e1 = ev(&w, 1, Some(e0.hash()), b"b");
    let e2 = ev(&w, 2, Some(e1.hash()), b"c");
    verify_stream(&[e0.clone(), e1.clone(), e2.clone()], &w.history, 0, None).unwrap();
    assert!(verify_stream(&[e0.clone(), e2.clone()], &w.history, 0, None).is_err(), "gap");
    assert!(verify_stream(&[e1.clone(), e0.clone()], &w.history, 0, None).is_err(), "reorder");
    let fork = ev(&w, 1, Some(e0.hash()), b"B");
    assert_ne!(fork.hash(), e1.hash());
    assert!(verify_stream(&[e0.clone(), e1, fork], &w.history, 0, None).is_err(), "fork");
    verify_stream(&[e2], &w.history, 2, Some(ev(&w, 1, Some(e0.hash()), b"b").hash())).unwrap();
}

#[test]
fn limits_enforced() {
    let w = world();
    assert!(sign("", w.id, [1; 16], 0, None, 0, 0, vec![], &w.phone).is_err());
    assert!(sign("bucks.x", w.id, [1; 16], 0, None, 0, 0, vec![0; 64 * 1024 + 1], &w.phone).is_err());
}

#[test]
fn vectors() {
    let w = world();
    let e0 = ev(&w, 0, None, b"hello bucks");
    let e1 = ev(&w, 1, Some(e0.hash()), b"second");
    let doc = serde_json::json!({
        "spec": "docs/plan/03-identity.md and core/bucks-core/src/event.rs",
        "note": "identity log = inception from identity-v1.json (root-primary, device phone id 0x01*16); events signed by device key 'phone'",
        "author": w.id.to_string(),
        "inception_hex": hex(&w.ops[0].to_bytes()),
        "events_hex": [hex(&e0.to_bytes()), hex(&e1.to_bytes())],
        "event_hashes": [hex(&e0.hash()), hex(&e1.hash())],
    });
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../protocol/test-vectors/events-v1.json");
    let text = serde_json::to_string_pretty(&doc).unwrap() + "\n";
    if std::env::var("UPDATE_VECTORS").is_ok() {
        std::fs::write(path, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(path).expect("run with UPDATE_VECTORS=1 once"), text, "protocol break");
}

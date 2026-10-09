use bucks_core::cbor::Value;
use bucks_core::*;
use p256::ecdsa::SigningKey;

fn key(label: &str) -> SigningKey {
    SigningKey::from_slice(blake3::hash(label.as_bytes()).as_bytes()).unwrap()
}
fn dev(label: &str, n: u8) -> Device {
    Device { id: [n; 16], key: key(label).public_key(), name: label.into() }
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Inception with two rotation keys (primary + paper backup) and one phone.
fn incept() -> (Op, SigningKey, SigningKey) {
    let (r1, r2) = (key("root-primary"), key("root-backup"));
    let op = Op::sign(
        0,
        None,
        OpBody::Inception {
            rotation_keys: vec![r1.public_key(), r2.public_key()],
            devices: vec![dev("phone", 1)],
            home: vec!["https://node.bucks.global".into()],
        },
        &r1,
    );
    (op, r1, r2)
}

#[test]
fn id_shape_and_roundtrip() {
    let (op, _, _) = incept();
    let id = op.bucks_id().unwrap();
    let s = id.to_string();
    assert_eq!(s.len(), 36);
    assert_eq!(&s[14..15], "8", "version nibble");
    assert!(matches!(&s[19..20], "8" | "9" | "a" | "b"), "variant bits");
    assert_eq!(BucksId::parse(&s).unwrap(), id);
    assert_eq!(BucksId::parse(&id.did()).unwrap(), id);
    assert_eq!(id.short_code().len(), 8);
    assert!(BucksId::parse("3f9a6c2e-1b47-4d3c-9e21-7a4b0c5d8e1f").is_err(), "v4 uuid is not a bucks id");
}

#[test]
fn did_key_form_for_p256() {
    assert!(key("phone").public_key().did_key().starts_with("did:key:zDn"));
}

#[test]
fn wire_roundtrip_and_canonical() {
    let (op, _, _) = incept();
    let b = op.to_bytes();
    assert_eq!(Op::from_bytes(&b).unwrap(), op);
    let mut trailing = b.clone();
    trailing.push(0);
    assert!(Op::from_bytes(&trailing).is_err());
    // re-encode with non-shortest integer form must be rejected
    let mut noncanon = b.clone();
    let pos = noncanon.windows(2).position(|w| w == [0x61, b'v']).unwrap(); // text(1) "v"
    noncanon.splice(pos + 2..pos + 3, [0x18, 0x01]); // uint 1 as 0x18 0x01
    assert!(Op::from_bytes(&noncanon).is_err());
}

#[test]
fn id_is_independent_of_signature_and_stable_across_rotation() {
    let (op, r1, r2) = incept();
    let id = op.bucks_id().unwrap();
    let mut other = op.clone();
    other.sig = [7; 64];
    assert_eq!(other.bucks_id().unwrap(), id);

    let tablet = dev("tablet", 2);
    let add = Op::sign(1, Some(op.hash()), OpBody::AddDevice { device: tablet.clone() }, &r1);
    let new_root = key("root-new");
    let rot = Op::sign(2, Some(add.hash()), OpBody::RotateKeys { rotation_keys: vec![new_root.public_key(), r2.public_key()] }, &r2);
    let st = verify_log(&[op.clone(), add, rot.clone()]).unwrap();
    assert_eq!(st.id, id, "rotation must not change the id");
    assert!(st.devices.contains(&tablet));
    assert_eq!(st.seq, 2);

    // the old primary key no longer authorises anything
    let late = Op::sign(3, Some(rot.hash()), OpBody::RemoveDevice { device_id: [2; 16] }, &r1);
    let log = [op, Op::sign(1, Some(incept().0.hash()), OpBody::AddDevice { device: tablet }, &r1), rot, late];
    assert_eq!(verify_log(&log).unwrap_err(), Error::Log("signer is not a current rotation key"));
}

#[test]
fn rejects_tampering_and_bad_chains() {
    let (op, r1, _) = incept();
    let add = Op::sign(1, Some(op.hash()), OpBody::AddDevice { device: dev("tablet", 2) }, &r1);

    let mut forged = add.clone();
    forged.body = OpBody::AddDevice { device: dev("attacker", 9) };
    assert_eq!(verify_log(&[op.clone(), forged]).unwrap_err(), Error::BadSignature);

    let wrong_prev = Op::sign(1, Some([0; 32]), OpBody::AddDevice { device: dev("tablet", 2) }, &r1);
    assert!(verify_log(&[op.clone(), wrong_prev]).is_err());

    let stranger = key("stranger");
    let by_stranger = Op::sign(1, Some(op.hash()), OpBody::AddDevice { device: dev("tablet", 2) }, &stranger);
    assert!(verify_log(&[op.clone(), by_stranger]).is_err());

    let dup = Op::sign(1, Some(op.hash()), OpBody::AddDevice { device: dev("phone", 1) }, &r1);
    assert!(verify_log(&[op.clone(), dup]).is_err());

    let rm_last = Op::sign(1, Some(op.hash()), OpBody::RemoveDevice { device_id: [1; 16] }, &r1);
    assert!(verify_log(&[op.clone(), rm_last]).is_err(), "cannot remove the only device");

    let second_inception = Op::sign(1, Some(op.hash()), op.body.clone(), &r1);
    assert!(verify_log(&[op, second_inception]).is_err());
    assert!(verify_log(&[]).is_err());
}

#[test]
fn rejects_high_s_signature() {
    let (mut op, _, _) = incept();
    // n - s of a valid low-S signature is a different valid signature with high S.
    use p256::ecdsa::Signature;
    let sig = Signature::from_slice(&op.sig).unwrap();
    let (r, s) = sig.split_scalars();
    let high = Signature::from_scalars(r, -*s).unwrap();
    op.sig = high.to_bytes().into();
    assert_eq!(verify_log(&[op]).unwrap_err(), Error::BadSignature);
}

#[test]
fn cbor_map_order_is_canonical() {
    let a = Value::Map(vec![("bb".into(), Value::Uint(1)), ("a".into(), Value::Uint(2)), ("ccc".into(), Value::Null)]);
    let b = Value::Map(vec![("ccc".into(), Value::Null), ("a".into(), Value::Uint(2)), ("bb".into(), Value::Uint(1))]);
    assert_eq!(a.encode(), b.encode());
    // length-first: "a" < "bb" < "ccc"
    assert_eq!(a.encode(), vec![0xa3, 0x61, b'a', 0x02, 0x62, b'b', b'b', 0x01, 0x63, b'c', b'c', b'c', 0xf6]);
}

/// Cross-implementation test vectors. Regenerate with `UPDATE_VECTORS=1 cargo test vectors`.
#[test]
fn vectors() {
    let (op, r1, r2) = incept();
    let add = Op::sign(1, Some(op.hash()), OpBody::AddDevice { device: dev("laptop", 2) }, &r1);
    let rot = Op::sign(2, Some(add.hash()), OpBody::RotateKeys { rotation_keys: vec![key("root-new").public_key(), r2.public_key()] }, &r2);
    let st = verify_log(&[op.clone(), add.clone(), rot.clone()]).unwrap();
    let doc = serde_json::json!({
        "spec": "docs/plan/03-identity.md",
        "note": "keys are P-256 secrets = blake3(label); signatures are RFC 6979 deterministic, low-S",
        "labels": { "root-primary": hex(key("root-primary").to_bytes().as_slice()),
                    "root-backup": hex(key("root-backup").to_bytes().as_slice()),
                    "phone": hex(key("phone").to_bytes().as_slice()) },
        "bucks_id": st.id.to_string(),
        "did": st.id.did(),
        "short_code": st.id.short_code(),
        "inception_unsigned_hex": hex(&op.unsigned_bytes()),
        "log_hex": [hex(&op.to_bytes()), hex(&add.to_bytes()), hex(&rot.to_bytes())],
        "final": { "seq": st.seq, "head": hex(&st.head),
                   "rotation_keys": st.rotation_keys.iter().map(|k| k.did_key()).collect::<Vec<_>>(),
                   "devices": st.devices.iter().map(|d| d.name.clone()).collect::<Vec<_>>() },
    });
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../protocol/test-vectors/identity-v1.json");
    let text = serde_json::to_string_pretty(&doc).unwrap() + "\n";
    if std::env::var("UPDATE_VECTORS").is_ok() {
        std::fs::write(path, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(path).expect("run with UPDATE_VECTORS=1 once"), text, "vectors changed: this is a protocol break");
}

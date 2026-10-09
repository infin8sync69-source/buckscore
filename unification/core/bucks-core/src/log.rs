use crate::cbor::Value;
use crate::{BucksId, Error, PubKey};
use p256::ecdsa::{signature::Signer, signature::Verifier, Signature, SigningKey};

pub const MAX_ROTATION_KEYS: usize = 3;
pub const MAX_DEVICES: usize = 32;
pub const MAX_HOME: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    pub id: [u8; 16],
    pub key: PubKey,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpBody {
    Inception { rotation_keys: Vec<PubKey>, devices: Vec<Device>, home: Vec<String> },
    AddDevice { device: Device },
    RemoveDevice { device_id: [u8; 16] },
    RotateKeys { rotation_keys: Vec<PubKey> },
}

/// One signed entry of an identity log.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Op {
    pub seq: u64,
    /// BLAKE3 of the previous signed op's canonical bytes; `None` only for inception.
    pub prev: Option<[u8; 32]>,
    pub body: OpBody,
    /// The rotation key that signed this op.
    pub by: PubKey,
    /// Raw 64-byte r||s ECDSA P-256 signature, low-S, over `unsigned_bytes()`.
    pub sig: [u8; 64],
}

/// Anything that can sign with a P-256 key: a software key, or a Keystore/Secure Enclave handle.
pub trait OpSigner {
    fn public_key(&self) -> PubKey;
    fn sign(&self, msg: &[u8]) -> [u8; 64];
}

impl OpSigner for SigningKey {
    fn public_key(&self) -> PubKey {
        let p = self.verifying_key().to_encoded_point(true);
        let mut k = [0u8; 33];
        k.copy_from_slice(p.as_bytes());
        PubKey(k)
    }
    fn sign(&self, msg: &[u8]) -> [u8; 64] {
        let s: Signature = Signer::sign(self, msg);
        let s = s.normalize_s().unwrap_or(s);
        s.to_bytes().into()
    }
}

fn bytes(b: &[u8]) -> Value {
    Value::Bytes(b.to_vec())
}

fn device_value(d: &Device) -> Value {
    Value::Map(vec![
        ("id".into(), bytes(&d.id)),
        ("key".into(), bytes(&d.key.0)),
        ("name".into(), Value::Text(d.name.clone())),
    ])
}

fn keys_value(k: &[PubKey]) -> Value {
    Value::Array(k.iter().map(|k| bytes(&k.0)).collect())
}

impl Op {
    fn type_name(&self) -> &'static str {
        match self.body {
            OpBody::Inception { .. } => "inception",
            OpBody::AddDevice { .. } => "add_device",
            OpBody::RemoveDevice { .. } => "remove_device",
            OpBody::RotateKeys { .. } => "rotate_keys",
        }
    }

    fn unsigned_fields(&self) -> Vec<(String, Value)> {
        let mut m = vec![
            ("v".to_string(), Value::Uint(1)),
            ("type".into(), Value::Text(self.type_name().into())),
            ("seq".into(), Value::Uint(self.seq)),
            ("prev".into(), self.prev.map_or(Value::Null, |p| bytes(&p))),
        ];
        match &self.body {
            OpBody::Inception { rotation_keys, devices, home } => {
                m.push(("rotation_keys".into(), keys_value(rotation_keys)));
                m.push(("devices".into(), Value::Array(devices.iter().map(device_value).collect())));
                m.push(("home".into(), Value::Array(home.iter().map(|h| Value::Text(h.clone())).collect())));
            }
            OpBody::AddDevice { device } => m.push(("device".into(), device_value(device))),
            OpBody::RemoveDevice { device_id } => m.push(("device_id".into(), bytes(device_id))),
            OpBody::RotateKeys { rotation_keys } => m.push(("rotation_keys".into(), keys_value(rotation_keys))),
        }
        m
    }

    /// The bytes that are signed. For an inception these bytes also define the Bucks ID.
    pub fn unsigned_bytes(&self) -> Vec<u8> {
        Value::Map(self.unsigned_fields()).encode()
    }

    /// Canonical wire form: unsigned fields plus `by` and `sig`.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut m = self.unsigned_fields();
        m.push(("by".into(), bytes(&self.by.0)));
        m.push(("sig".into(), bytes(&self.sig)));
        Value::Map(m).encode()
    }

    /// BLAKE3 of the wire form; the next op's `prev`.
    pub fn hash(&self) -> [u8; 32] {
        *blake3::hash(&self.to_bytes()).as_bytes()
    }

    pub fn from_bytes(b: &[u8]) -> Result<Op, Error> {
        let v = Value::decode(b)?;
        let Value::Map(fields) = &v else { return Err(Error::Encoding("op must be a map")) };
        let get = |k: &str| v.get(k).ok_or(Error::Encoding("missing field"));
        if !matches!(get("v")?, Value::Uint(1)) {
            return Err(Error::Encoding("unsupported version"));
        }
        let Value::Text(ty) = get("type")? else { return Err(Error::Encoding("type")) };
        let Value::Uint(seq) = get("seq")? else { return Err(Error::Encoding("seq")) };
        let prev = match get("prev")? {
            Value::Null => None,
            Value::Bytes(p) => Some(<[u8; 32]>::try_from(p.as_slice()).map_err(|_| Error::Encoding("prev"))?),
            _ => return Err(Error::Encoding("prev")),
        };
        let (body, expected) = match ty.as_str() {
            "inception" => {
                let rotation_keys = parse_keys(get("rotation_keys")?)?;
                let Value::Array(ds) = get("devices")? else { return Err(Error::Encoding("devices")) };
                let devices = ds.iter().map(parse_device).collect::<Result<Vec<_>, _>>()?;
                let Value::Array(hs) = get("home")? else { return Err(Error::Encoding("home")) };
                let home = hs
                    .iter()
                    .map(|h| match h {
                        Value::Text(s) => Ok(s.clone()),
                        _ => Err(Error::Encoding("home")),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                (OpBody::Inception { rotation_keys, devices, home }, 9)
            }
            "add_device" => (OpBody::AddDevice { device: parse_device(get("device")?)? }, 7),
            "remove_device" => {
                let Value::Bytes(d) = get("device_id")? else { return Err(Error::Encoding("device_id")) };
                let device_id = <[u8; 16]>::try_from(d.as_slice()).map_err(|_| Error::Encoding("device_id"))?;
                (OpBody::RemoveDevice { device_id }, 7)
            }
            "rotate_keys" => (OpBody::RotateKeys { rotation_keys: parse_keys(get("rotation_keys")?)? }, 7),
            _ => return Err(Error::Encoding("unknown op type")),
        };
        if fields.len() != expected {
            return Err(Error::Encoding("unexpected fields"));
        }
        let Value::Bytes(by) = get("by")? else { return Err(Error::Encoding("by")) };
        let by = PubKey::from_sec1(by)?;
        let Value::Bytes(sig) = get("sig")? else { return Err(Error::Encoding("sig")) };
        let sig = <[u8; 64]>::try_from(sig.as_slice()).map_err(|_| Error::Encoding("sig"))?;
        Ok(Op { seq: *seq, prev, body, by, sig })
    }

    /// Build and sign an op. `by` is taken from the signer.
    pub fn sign(seq: u64, prev: Option<[u8; 32]>, body: OpBody, signer: &dyn OpSigner) -> Op {
        let mut op = Op { seq, prev, body, by: signer.public_key(), sig: [0; 64] };
        op.sig = signer.sign(&op.unsigned_bytes());
        op
    }

    fn verify_signature(&self) -> Result<(), Error> {
        let sig = Signature::from_slice(&self.sig).map_err(|_| Error::BadSignature)?;
        if sig.normalize_s().is_some() {
            return Err(Error::BadSignature); // high-S: reject to keep signatures non-malleable
        }
        self.by
            .verifying_key()?
            .verify(&self.unsigned_bytes(), &sig)
            .map_err(|_| Error::BadSignature)
    }

    /// The Bucks ID defined by an inception op: hash of its *unsigned* bytes, so the ID does
    /// not depend on the signature.
    pub fn bucks_id(&self) -> Result<BucksId, Error> {
        match self.body {
            OpBody::Inception { .. } => Ok(BucksId::from_digest(blake3::hash(&self.unsigned_bytes()).as_bytes())),
            _ => Err(Error::Log("only an inception defines an id")),
        }
    }
}

fn parse_keys(v: &Value) -> Result<Vec<PubKey>, Error> {
    let Value::Array(a) = v else { return Err(Error::Encoding("keys")) };
    a.iter()
        .map(|k| match k {
            Value::Bytes(b) => PubKey::from_sec1(b),
            _ => Err(Error::Encoding("key")),
        })
        .collect()
}

fn parse_device(v: &Value) -> Result<Device, Error> {
    let Value::Map(f) = v else { return Err(Error::Encoding("device")) };
    if f.len() != 3 {
        return Err(Error::Encoding("device fields"));
    }
    let (Some(Value::Bytes(id)), Some(Value::Bytes(key)), Some(Value::Text(name))) =
        (v.get("id"), v.get("key"), v.get("name"))
    else {
        return Err(Error::Encoding("device"));
    };
    Ok(Device {
        id: <[u8; 16]>::try_from(id.as_slice()).map_err(|_| Error::Encoding("device id"))?,
        key: PubKey::from_sec1(key)?,
        name: name.clone(),
    })
}

/// The identity as of the end of a verified log.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub id: BucksId,
    pub rotation_keys: Vec<PubKey>,
    pub devices: Vec<Device>,
    pub home: Vec<String>,
    pub head: [u8; 32],
    pub seq: u64,
}

impl State {
    /// True if `key` is a currently authorised device key.
    pub fn has_device_key(&self, key: &PubKey) -> bool {
        self.devices.iter().any(|d| &d.key == key)
    }
}

fn check_keys(k: &[PubKey]) -> Result<(), Error> {
    if k.is_empty() || k.len() > MAX_ROTATION_KEYS {
        return Err(Error::Log("rotation key count must be 1..=3"));
    }
    for (i, a) in k.iter().enumerate() {
        a.verifying_key()?;
        if k[..i].contains(a) {
            return Err(Error::Log("duplicate rotation key"));
        }
    }
    Ok(())
}

fn check_device(d: &Device) -> Result<(), Error> {
    d.key.verifying_key()?;
    if d.name.len() > 64 {
        return Err(Error::Log("device name too long"));
    }
    Ok(())
}

/// Verify a whole log from inception and return the resulting state.
///
/// Rules: sequence numbers are 0,1,2,...; each `prev` is the hash of the previous signed op;
/// every op is signed (low-S ECDSA P-256) by a rotation key that is current *before* the op
/// is applied; 1 to 3 distinct rotation keys; 1 to 32 devices with unique ids and keys.
pub fn verify_log(ops: &[Op]) -> Result<State, Error> {
    replay(ops)?.pop().ok_or(Error::Log("empty log"))
}

/// Like [`verify_log`] but returns the state after every op (`result[i]` is the state at seq `i`).
pub fn replay(ops: &[Op]) -> Result<Vec<State>, Error> {
    let first = ops.first().ok_or(Error::Log("empty log"))?;
    let OpBody::Inception { rotation_keys, devices, home } = &first.body else {
        return Err(Error::Log("first op must be an inception"));
    };
    if first.seq != 0 || first.prev.is_some() {
        return Err(Error::Log("bad inception header"));
    }
    check_keys(rotation_keys)?;
    if !rotation_keys.contains(&first.by) {
        return Err(Error::Log("inception not signed by one of its rotation keys"));
    }
    if devices.is_empty() || devices.len() > MAX_DEVICES || home.len() > MAX_HOME {
        return Err(Error::Log("device or home count out of range"));
    }
    for (i, d) in devices.iter().enumerate() {
        check_device(d)?;
        if devices[..i].iter().any(|e| e.id == d.id || e.key == d.key) {
            return Err(Error::Log("duplicate device"));
        }
    }
    first.verify_signature()?;
    let mut st = State {
        id: first.bucks_id()?,
        rotation_keys: rotation_keys.clone(),
        devices: devices.clone(),
        home: home.clone(),
        head: first.hash(),
        seq: 0,
    };
    let mut history = vec![st.clone()];
    for op in &ops[1..] {
        if op.seq != st.seq + 1 || op.prev != Some(st.head) {
            return Err(Error::Log("broken chain"));
        }
        if !st.rotation_keys.contains(&op.by) {
            return Err(Error::Log("signer is not a current rotation key"));
        }
        op.verify_signature()?;
        match &op.body {
            OpBody::Inception { .. } => return Err(Error::Log("second inception")),
            OpBody::AddDevice { device } => {
                check_device(device)?;
                if st.devices.len() >= MAX_DEVICES
                    || st.devices.iter().any(|e| e.id == device.id || e.key == device.key)
                {
                    return Err(Error::Log("cannot add device"));
                }
                st.devices.push(device.clone());
            }
            OpBody::RemoveDevice { device_id } => {
                let before = st.devices.len();
                st.devices.retain(|d| &d.id != device_id);
                if st.devices.len() == before || st.devices.is_empty() {
                    return Err(Error::Log("cannot remove device"));
                }
            }
            OpBody::RotateKeys { rotation_keys } => {
                check_keys(rotation_keys)?;
                st.rotation_keys = rotation_keys.clone();
            }
        }
        st.head = op.hash();
        st.seq = op.seq;
        history.push(st.clone());
    }
    Ok(history)
}

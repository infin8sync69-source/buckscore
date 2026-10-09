//! Minimal canonical CBOR (DAG-CBOR subset) for Bucks identity operations.
//!
//! Supported: unsigned ints, byte strings, text strings, arrays, text-keyed maps, null.
//! Maps are encoded with keys sorted by their encoded bytes (length first, then bytewise),
//! which is the DAG-CBOR / RFC 8949 deterministic ordering. Integers use the shortest form.
//! The decoder rejects anything the encoder would not have produced, so every accepted
//! byte string has exactly one valid encoding.

use crate::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Null,
    Uint(u64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Value>),
    Map(Vec<(String, Value)>),
}

fn head(out: &mut Vec<u8>, major: u8, n: u64) {
    let m = major << 5;
    if n < 24 {
        out.push(m | n as u8);
    } else if n <= 0xff {
        out.extend([m | 24, n as u8]);
    } else if n <= 0xffff {
        out.push(m | 25);
        out.extend((n as u16).to_be_bytes());
    } else if n <= 0xffff_ffff {
        out.push(m | 26);
        out.extend((n as u32).to_be_bytes());
    } else {
        out.push(m | 27);
        out.extend(n.to_be_bytes());
    }
}

impl Value {
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut Vec<u8>) {
        match self {
            Value::Null => out.push(0xf6),
            Value::Uint(n) => head(out, 0, *n),
            Value::Bytes(b) => {
                head(out, 2, b.len() as u64);
                out.extend(b);
            }
            Value::Text(s) => {
                head(out, 3, s.len() as u64);
                out.extend(s.as_bytes());
            }
            Value::Array(a) => {
                head(out, 4, a.len() as u64);
                for v in a {
                    v.write(out);
                }
            }
            Value::Map(m) => {
                let mut entries: Vec<(Vec<u8>, &Value)> = m
                    .iter()
                    .map(|(k, v)| {
                        let mut kb = Vec::new();
                        head(&mut kb, 3, k.len() as u64);
                        kb.extend(k.as_bytes());
                        (kb, v)
                    })
                    .collect();
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                head(out, 5, entries.len() as u64);
                for (kb, v) in entries {
                    out.extend(kb);
                    v.write(out);
                }
            }
        }
    }

    /// Decode a single value; the input must be exactly one canonical value.
    pub fn decode(bytes: &[u8]) -> Result<Value, Error> {
        let mut pos = 0;
        let v = read(bytes, &mut pos, 0)?;
        if pos != bytes.len() {
            return Err(Error::Encoding("trailing bytes"));
        }
        if v.encode() != bytes {
            return Err(Error::Encoding("not canonical"));
        }
        Ok(v)
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Map(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

fn arg(bytes: &[u8], pos: &mut usize, info: u8) -> Result<u64, Error> {
    let take = |pos: &mut usize, n: usize| -> Result<&[u8], Error> {
        let s = bytes.get(*pos..*pos + n).ok_or(Error::Encoding("truncated"))?;
        *pos += n;
        Ok(s)
    };
    Ok(match info {
        0..=23 => info as u64,
        24 => take(pos, 1)?[0] as u64,
        25 => u16::from_be_bytes(take(pos, 2)?.try_into().unwrap()) as u64,
        26 => u32::from_be_bytes(take(pos, 4)?.try_into().unwrap()) as u64,
        27 => u64::from_be_bytes(take(pos, 8)?.try_into().unwrap()),
        _ => return Err(Error::Encoding("unsupported length form")),
    })
}

fn read(bytes: &[u8], pos: &mut usize, depth: usize) -> Result<Value, Error> {
    if depth > 16 {
        return Err(Error::Encoding("too deep"));
    }
    let b = *bytes.get(*pos).ok_or(Error::Encoding("truncated"))?;
    *pos += 1;
    let (major, info) = (b >> 5, b & 0x1f);
    if b == 0xf6 {
        return Ok(Value::Null);
    }
    let n = arg(bytes, pos, info)?;
    let n_usize = usize::try_from(n).map_err(|_| Error::Encoding("length"))?;
    match major {
        0 => Ok(Value::Uint(n)),
        2 | 3 => {
            let end = pos.checked_add(n_usize).ok_or(Error::Encoding("length"))?;
            let s = bytes.get(*pos..end).ok_or(Error::Encoding("truncated"))?;
            *pos = end;
            if major == 2 {
                Ok(Value::Bytes(s.to_vec()))
            } else {
                Ok(Value::Text(
                    String::from_utf8(s.to_vec()).map_err(|_| Error::Encoding("utf8"))?,
                ))
            }
        }
        4 => {
            if n_usize > bytes.len() {
                return Err(Error::Encoding("length"));
            }
            let mut a = Vec::with_capacity(n_usize);
            for _ in 0..n_usize {
                a.push(read(bytes, pos, depth + 1)?);
            }
            Ok(Value::Array(a))
        }
        5 => {
            if n_usize > bytes.len() {
                return Err(Error::Encoding("length"));
            }
            let mut m = Vec::with_capacity(n_usize);
            for _ in 0..n_usize {
                let k = match read(bytes, pos, depth + 1)? {
                    Value::Text(s) => s,
                    _ => return Err(Error::Encoding("map key must be text")),
                };
                if m.iter().any(|(e, _): &(String, Value)| *e == k) {
                    return Err(Error::Encoding("duplicate key"));
                }
                m.push((k, read(bytes, pos, depth + 1)?));
            }
            Ok(Value::Map(m))
        }
        _ => Err(Error::Encoding("unsupported type")),
    }
}

use crate::Error;
use p256::ecdsa::VerifyingKey;
use std::fmt;

/// A P-256 public key in 33-byte compressed SEC1 form.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PubKey(pub [u8; 33]);

impl PubKey {
    pub fn from_sec1(bytes: &[u8]) -> Result<Self, Error> {
        let vk = VerifyingKey::from_sec1_bytes(bytes).map_err(|_| Error::BadKey)?;
        let point = vk.to_encoded_point(true);
        let mut out = [0u8; 33];
        out.copy_from_slice(point.as_bytes());
        Ok(PubKey(out))
    }

    pub(crate) fn verifying_key(&self) -> Result<VerifyingKey, Error> {
        VerifyingKey::from_sec1_bytes(&self.0).map_err(|_| Error::BadKey)
    }

    /// `did:key` form: multibase base58btc of multicodec p256-pub (0x1200) + key.
    pub fn did_key(&self) -> String {
        let mut buf = vec![0x80, 0x24];
        buf.extend(self.0);
        format!("did:key:z{}", bs58::encode(buf).into_string())
    }
}

impl fmt::Debug for PubKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.did_key())
    }
}

/// A self-certifying Bucks ID (UUID, version nibble 8, RFC 9562 variant).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct BucksId(pub [u8; 16]);

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

impl BucksId {
    /// Derive from the BLAKE3 digest of the unsigned inception encoding.
    pub(crate) fn from_digest(digest: &[u8; 32]) -> Self {
        let mut b = [0u8; 16];
        b.copy_from_slice(&digest[..16]);
        b[6] = (b[6] & 0x0f) | 0x80;
        b[8] = (b[8] & 0x3f) | 0x80;
        BucksId(b)
    }

    pub fn did(&self) -> String {
        format!("did:bucks:{self}")
    }

    /// 8-character Crockford base32 code for QR/voice use: first 40 bits of BLAKE3(id).
    pub fn short_code(&self) -> String {
        let h = blake3::hash(&self.0);
        let b = &h.as_bytes()[..5];
        let mut n: u64 = 0;
        for x in b {
            n = (n << 8) | *x as u64;
        }
        (0..8)
            .rev()
            .map(|i| CROCKFORD[((n >> (i * 5)) & 31) as usize] as char)
            .collect()
    }

    pub fn parse(s: &str) -> Result<Self, Error> {
        let s = s.strip_prefix("did:bucks:").unwrap_or(s);
        let hex: String = s.chars().filter(|c| *c != '-').collect();
        if hex.len() != 32 || s.len() != 36 {
            return Err(Error::BadId);
        }
        let mut b = [0u8; 16];
        for i in 0..16 {
            b[i] = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).map_err(|_| Error::BadId)?;
        }
        if b[6] >> 4 != 8 || b[8] >> 6 != 2 {
            return Err(Error::BadId);
        }
        Ok(BucksId(b))
    }
}

impl fmt::Display for BucksId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let b = &self.0;
        write!(
            f,
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
        )
    }
}

impl fmt::Debug for BucksId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self}")
    }
}

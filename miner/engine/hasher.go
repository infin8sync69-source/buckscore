// Package engine implements the Bucks Proof-of-Work mining engine.
//
// Hash algorithm: double-Keccak-256
//
//	H = Keccak256( Keccak256( header_bytes || nonce_big_endian_8 ) )
//
// A block is valid when H (interpreted as a big-endian 256-bit integer) is
// strictly less than the current target derived from the block difficulty.
package engine

import (
	"encoding/binary"
	"math/big"

	"golang.org/x/crypto/sha3"
)

// ---------------------------------------------------------------------------
// Hash types
// ---------------------------------------------------------------------------

// Hash32 is a 32-byte Keccak-256 digest.
type Hash32 [32]byte

// BigInt converts the hash to a big.Int for target comparison.
func (h Hash32) BigInt() *big.Int {
	return new(big.Int).SetBytes(h[:])
}

// Hex returns a lowercase hex string without 0x prefix.
func (h Hash32) Hex() string {
	const hextable = "0123456789abcdef"
	buf := make([]byte, 64)
	for i, b := range h {
		buf[i*2] = hextable[b>>4]
		buf[i*2+1] = hextable[b&0x0f]
	}
	return string(buf)
}

// ---------------------------------------------------------------------------
// Double-Keccak-256
// ---------------------------------------------------------------------------

// DoubleKeccak256 computes Keccak256(Keccak256(data)).
// This is the core hash primitive used for Bucks PoW block validation.
func DoubleKeccak256(data []byte) Hash32 {
	// First pass.
	h1 := sha3.NewLegacyKeccak256()
	h1.Write(data)
	inner := h1.Sum(nil)

	// Second pass.
	h2 := sha3.NewLegacyKeccak256()
	h2.Write(inner)

	var out Hash32
	copy(out[:], h2.Sum(nil))
	return out
}

// ---------------------------------------------------------------------------
// Seal hash — header + nonce encoding
// ---------------------------------------------------------------------------

// SealInput builds the byte slice that is fed into DoubleKeccak256 during mining.
//
// Layout: header_bytes (variable) || nonce (8 bytes, big-endian)
//
// The header bytes are a serialised form of all consensus-relevant fields
// except the nonce itself (height, parentHash, stateRoot, txRoot, difficulty,
// timestamp, coinbase, extraData).
func SealInput(headerBytes []byte, nonce uint64) []byte {
	buf := make([]byte, len(headerBytes)+8)
	copy(buf, headerBytes)
	binary.BigEndian.PutUint64(buf[len(headerBytes):], nonce)
	return buf
}

// SealHash computes the PoW candidate hash for a given header + nonce pair.
func SealHash(headerBytes []byte, nonce uint64) Hash32 {
	return DoubleKeccak256(SealInput(headerBytes, nonce))
}

// SealHashInto computes the same value as SealHash(buf[:headerLen], nonce),
// but writes the nonce into a caller-owned buffer instead of allocating a
// fresh one on every call. buf must have length headerLen+8, with
// buf[:headerLen] already holding the header bytes (copied once by the
// caller, outside the hot loop) — only the trailing 8 nonce bytes change
// between calls. Used by the mining hot loop (engine/worker.go) to avoid a
// per-hash-attempt allocation; the hash output is identical to SealHash.
func SealHashInto(buf []byte, headerLen int, nonce uint64) Hash32 {
	binary.BigEndian.PutUint64(buf[headerLen:], nonce)
	return DoubleKeccak256(buf)
}

// ---------------------------------------------------------------------------
// Target calculation
// ---------------------------------------------------------------------------

// maxTarget is 2^256 - 1.
var maxTarget = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))

// DifficultyToTarget converts a difficulty value to a 256-bit mining target.
//
//	target = maxTarget / difficulty
//
// A block is valid when hash < target.
func DifficultyToTarget(difficulty *big.Int) *big.Int {
	if difficulty == nil || difficulty.Sign() <= 0 {
		return new(big.Int).Set(maxTarget)
	}
	return new(big.Int).Div(maxTarget, difficulty)
}

// TargetToBytes converts a target big.Int to a 32-byte big-endian representation
// suitable for comparison with a Hash32.
func TargetToBytes(target *big.Int) [32]byte {
	var out [32]byte
	b := target.Bytes()
	if len(b) > 32 {
		b = b[len(b)-32:]
	}
	copy(out[32-len(b):], b)
	return out
}

// HashMeetsTarget returns true if hash < target (i.e. the block is valid).
func HashMeetsTarget(hash Hash32, target [32]byte) bool {
	for i := 0; i < 32; i++ {
		if hash[i] < target[i] {
			return true
		}
		if hash[i] > target[i] {
			return false
		}
	}
	return false // equal is not < target
}

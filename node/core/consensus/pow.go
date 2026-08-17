// Package consensus implements the Bucks Proof-of-Work engine.
//
// Algorithm: double-Keccak-256
//   candidate = Keccak256( Keccak256( RLP(header_without_nonce) || nonce_bytes ) )
//   valid     = candidate < target
//
// Difficulty adjustment runs every DifficultyAdjustmentWindow blocks and
// clamps the change to ±25 % to prevent wild oscillation.
package consensus

import (
	"encoding/binary"
	"math/big"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bucks-core/node/core/types"
	"golang.org/x/crypto/sha3"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// maxTarget is 2^256 - 1 expressed as a big.Int.
// target = maxTarget / difficulty
var maxTarget = new(big.Int).Sub(
	new(big.Int).Lsh(big.NewInt(1), 256),
	big.NewInt(1),
)

// ---------------------------------------------------------------------------
// PoW Engine
// ---------------------------------------------------------------------------

// Engine is the Bucks Proof-of-Work consensus engine.
type Engine struct {
	// threads is the number of parallel mining goroutines.
	threads int

	// mining guards concurrent access to the active mining job.
	mu sync.Mutex

	// abort channel signals all workers to stop.
	abort chan struct{}

	// running is 1 if mining is active, 0 otherwise.
	running int32
}

// NewEngine creates a PoW engine that will use the specified number of threads.
// Pass threads = 0 to default to runtime.NumCPU().
func NewEngine(threads int) *Engine {
	return &Engine{
		threads: threads,
		abort:   make(chan struct{}),
	}
}

// ---------------------------------------------------------------------------
// Block verification
// ---------------------------------------------------------------------------

// VerifyHeader checks that header satisfies the PoW requirement and
// that its difficulty matches the expected value given its parent.
func (e *Engine) VerifyHeader(header, parent *types.BlockHeader) error {
	if header.Height == 0 {
		return nil // genesis block: no PoW required
	}

	expected := CalcDifficulty(header.Timestamp, parent)
	if header.Difficulty.Cmp(expected) != 0 {
		return ErrInvalidDifficulty
	}

	target := targetFromDifficulty(header.Difficulty)
	hash := sealHash(header, header.Nonce)
	hashInt := new(big.Int).SetBytes(hash[:])

	if hashInt.Cmp(target) >= 0 {
		return ErrInvalidPoW
	}
	return nil
}

// ---------------------------------------------------------------------------
// Difficulty calculation
// ---------------------------------------------------------------------------

// CalcDifficulty returns the difficulty a new block should have given its
// parent header and its own timestamp.
//
// Adjustment only fires every DifficultyAdjustmentWindow blocks.
// Between windows, difficulty carries forward unchanged.
func CalcDifficulty(newTimestamp int64, parent *types.BlockHeader) *big.Int {
	parentDiff := new(big.Int).Set(parent.Difficulty)

	// No adjustment inside a window — carry parent difficulty.
	if (parent.Height+1)%types.DifficultyAdjustmentWindow != 0 {
		return parentDiff
	}

	// Adjustment block: use the ratio of actual vs expected elapsed time.
	// expected = TargetBlockTime * DifficultyAdjustmentWindow
	expected := int64(types.TargetBlockTime/time.Second) *
		int64(types.DifficultyAdjustmentWindow)
	actual := newTimestamp - parent.Timestamp

	if actual <= 0 {
		actual = 1
	}

	// new_difficulty = parent_difficulty * expected / actual
	newDiff := new(big.Int).Mul(parentDiff, big.NewInt(expected))
	newDiff.Div(newDiff, big.NewInt(actual))

	// Clamp: ±25 % (factor of 4 in either direction).
	// max = parentDiff * 5/4
	maxDiff := new(big.Int).Mul(parentDiff, big.NewInt(5))
	maxDiff.Div(maxDiff, big.NewInt(4))
	// min = parentDiff * 3/4
	minDiff := new(big.Int).Mul(parentDiff, big.NewInt(3))
	minDiff.Div(minDiff, big.NewInt(4))

	if newDiff.Cmp(maxDiff) > 0 {
		newDiff.Set(maxDiff)
	}
	if newDiff.Cmp(minDiff) < 0 {
		newDiff.Set(minDiff)
	}

	// Difficulty must be at least 1.
	if newDiff.Sign() <= 0 {
		newDiff.SetInt64(1)
	}
	return newDiff
}

// ---------------------------------------------------------------------------
// Mining (nonce search)
// ---------------------------------------------------------------------------

// MineResult carries the winning nonce back from a worker goroutine.
type MineResult struct {
	Nonce uint64
	Hash  types.Hash
}

// Mine searches for a nonce that makes the header hash satisfy the current
// difficulty target. It launches e.threads workers and returns as soon as
// any worker finds a valid nonce.
//
// If ctx is cancelled or abort is closed, Mine returns ErrMiningAborted.
func (e *Engine) Mine(header *types.BlockHeader, abort <-chan struct{}) (MineResult, error) {
	target := targetFromDifficulty(header.Difficulty)
	threads := e.threads
	if threads <= 0 {
		threads = 1
	}

	results := make(chan MineResult, 1)
	var wg sync.WaitGroup

	for t := 0; t < threads; t++ {
		wg.Add(1)
		startNonce := uint64(t) * (^uint64(0) / uint64(threads))
		go func(start uint64) {
			defer wg.Done()
			mineWorker(header, start, target, abort, results)
		}(startNonce)
	}

	// Wait for either a result or abort.
	go func() {
		wg.Wait()
		close(results)
	}()

	select {
	case res, ok := <-results:
		if !ok {
			return MineResult{}, ErrMiningAborted
		}
		return res, nil
	case <-abort:
		return MineResult{}, ErrMiningAborted
	}
}

// mineWorker is run in its own goroutine. It iterates nonces starting from
// start, checking each against target until a solution is found or abort fires.
func mineWorker(header *types.BlockHeader, start uint64, target *big.Int,
	abort <-chan struct{}, results chan<- MineResult) {

	nonce := start
	var attempts int64

	for {
		// Check abort every 1024 attempts to avoid excessive channel polling.
		if attempts&0x3FF == 0 {
			select {
			case <-abort:
				return
			default:
			}
		}

		hash := sealHash(header, nonce)
		hashInt := new(big.Int).SetBytes(hash[:])

		if hashInt.Cmp(target) < 0 {
			// Non-blocking send: first worker to find a solution wins.
			select {
			case results <- MineResult{Nonce: nonce, Hash: hash}:
			default:
			}
			return
		}

		nonce++
		atomic.AddInt64(&attempts, 1)
	}
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

// sealHash computes double-Keccak-256 of the header fields plus the nonce.
// This is the value compared against the PoW target.
//
//	H = Keccak256( Keccak256( headerBytes || nonce_big_endian_8 ) )
func sealHash(header *types.BlockHeader, nonce uint64) types.Hash {
	// Encode nonce as 8-byte big-endian.
	var nonceBuf [8]byte
	binary.BigEndian.PutUint64(nonceBuf[:], nonce)

	// First Keccak pass over header + nonce.
	inner := sha3.NewLegacyKeccak256()
	inner.Write(headerBytes(header))
	inner.Write(nonceBuf[:])
	firstHash := inner.Sum(nil)

	// Second Keccak pass (double-hash for extra pre-image resistance).
	outer := sha3.NewLegacyKeccak256()
	outer.Write(firstHash)
	var out types.Hash
	copy(out[:], outer.Sum(nil))
	return out
}

// headerBytes returns a deterministic byte encoding of the consensus-relevant
// header fields (everything except Nonce and MixHash).
//
// Full RLP encoding is wired up in the blockchain package; this placeholder
// uses a simple concatenation sufficient for the PoW scaffold.
func headerBytes(h *types.BlockHeader) []byte {
	var buf []byte

	var heightBuf [8]byte
	binary.BigEndian.PutUint64(heightBuf[:], h.Height)
	buf = append(buf, heightBuf[:]...)
	buf = append(buf, h.ParentHash[:]...)
	buf = append(buf, h.StateRoot[:]...)
	buf = append(buf, h.TxRoot[:]...)

	if h.Difficulty != nil {
		buf = append(buf, h.Difficulty.Bytes()...)
	}

	var tsBuf [8]byte
	binary.BigEndian.PutUint64(tsBuf[:], uint64(h.Timestamp))
	buf = append(buf, tsBuf[:]...)
	buf = append(buf, h.Coinbase[:]...)
	buf = append(buf, h.ExtraData...)

	return buf
}

// targetFromDifficulty converts a difficulty value to a 256-bit target.
//   target = maxTarget / difficulty
func targetFromDifficulty(difficulty *big.Int) *big.Int {
	if difficulty == nil || difficulty.Sign() == 0 {
		return new(big.Int).Set(maxTarget)
	}
	return new(big.Int).Div(maxTarget, difficulty)
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// Sentinel errors returned by the consensus engine.
type engineError string

func (e engineError) Error() string { return string(e) }

const (
	ErrInvalidDifficulty engineError = "invalid block difficulty"
	ErrInvalidPoW        engineError = "proof of work does not satisfy target"
	ErrMiningAborted     engineError = "mining aborted"
)

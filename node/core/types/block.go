// Package types defines the core data structures for the Bucks Blockchain.
// Native coin: BUCKS — 1 BUCKS = the classical gold standard weight (mithqal).
// Chain ID: 8192  |  PoW: double-Keccak-256
package types

import (
	"math/big"
	"time"

	"golang.org/x/crypto/sha3"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const (
	// ChainID is the EVM chain identifier for the Bucks network.
	ChainID uint64 = 8192

	// GrainPerBucksString is 1 BUCKS in grain (1e18).
	GrainPerBucksString = "1000000000000000000"

	// InitialBlockRewardBucks is base block reward (50 BUCKS).
	InitialBlockRewardBucks uint64 = 50

	// HalvingInterval is the number of blocks between block-reward halvings.
	HalvingInterval uint64 = 210_000

	// MaxSupplyBucks is the hard cap on total BUCKS supply.
	MaxSupplyBucks = 21_000_000

	// TargetBlockTime is the desired time between blocks.
	TargetBlockTime = 60 * time.Second

	// DifficultyAdjustmentWindow is how often (in blocks) difficulty recalculates.
	DifficultyAdjustmentWindow uint64 = 2016

	// MaxDifficultyChange limits the difficulty swing per adjustment window (25 %).
	MaxDifficultyChange = 4 // denominator: old_diff * n/MaxDifficultyChange

	// AddressLength is the byte length of a Bucks address (Ethereum-compatible).
	AddressLength = 20

	// HashLength is the byte length of a Keccak-256 hash.
	HashLength = 32
)

// ---------------------------------------------------------------------------
// Scalar types
// ---------------------------------------------------------------------------

// Address is a 20-byte account identifier (Ethereum-compatible).
type Address [AddressLength]byte

// Hash is a 32-byte Keccak-256 hash.
type Hash [HashLength]byte

// ---------------------------------------------------------------------------
// Block Header
// ---------------------------------------------------------------------------

// BlockHeader contains all consensus-critical metadata for a block.
type BlockHeader struct {
	// Chain linkage
	Height     uint64 `json:"height"`
	ParentHash Hash   `json:"parentHash"`

	// State commitments
	StateRoot Hash `json:"stateRoot"`  // Merkle Patricia Trie root of account state
	TxRoot    Hash `json:"txRoot"`     // Merkle root of transactions in this block
	LogsBloom []byte `json:"logsBloom"` // 256-byte Bloom filter for logs

	// Mining
	Difficulty *big.Int `json:"difficulty"`
	Nonce      uint64   `json:"nonce"`
	MixHash    Hash     `json:"mixHash"` // Reserved; used by future DAG variants

	// Metadata
	Timestamp   int64   `json:"timestamp"`   // Unix seconds
	Coinbase    Address `json:"coinbase"`     // Miner receiving the block reward
	GasLimit    uint64  `json:"gasLimit"`     // Maximum gas per block
	GasUsed     uint64  `json:"gasUsed"`      // Actual gas consumed
	ExtraData   []byte  `json:"extraData"`    // Up to 32 bytes; miner-supplied

	// EVM version marker
	BaseFee *big.Int `json:"baseFee,omitempty"` // EIP-1559 base fee (Phase 2+)
}

// Hash returns the Keccak-256 hash of the RLP-encoded header.
// This is the value that must satisfy the PoW target.
func (h *BlockHeader) Hash() Hash {
	enc := h.rlpEncode()
	return keccak256(enc)
}

// rlpEncode produces a deterministic byte representation of the header
// (minimal RLP used here; full RLP encoding is wired in blockchain.go).
func (h *BlockHeader) rlpEncode() []byte {
	// Placeholder: full RLP encoding is implemented in the blockchain package
	// using go-ethereum's rlp library.
	return []byte{}
}

// ---------------------------------------------------------------------------
// Block Body
// ---------------------------------------------------------------------------

// BlockBody holds the transactions included in a block.
type BlockBody struct {
	Transactions []*Transaction `json:"transactions"`
}

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

// Block is the atomic unit of the Bucks chain.
type Block struct {
	Header *BlockHeader `json:"header"`
	Body   *BlockBody   `json:"body"`

	// cached hash (set once, read many times)
	hash Hash
}

// NewBlock constructs a Block from a header and a list of transactions.
func NewBlock(header *BlockHeader, txs []*Transaction) *Block {
	b := &Block{
		Header: header,
		Body:   &BlockBody{Transactions: txs},
	}
	b.hash = header.Hash()
	return b
}

// Hash returns the cached block hash (block identity == header hash).
func (b *Block) Hash() Hash { return b.hash }

// Number returns the block height.
func (b *Block) Number() uint64 { return b.Header.Height }

// Reward calculates the block reward in grain for this block's height,
// applying the halving schedule.
func (b *Block) Reward() *big.Int {
	grain, _ := new(big.Int).SetString(GrainPerBucksString, 10)
	reward := new(big.Int).Mul(big.NewInt(int64(InitialBlockRewardBucks)), grain)
	halvings := b.Header.Height / HalvingInterval
	if halvings >= 64 {
		return big.NewInt(0) // Reward reaches zero after 64 halvings
	}
	reward.Rsh(reward, uint(halvings))
	return reward
}

// ---------------------------------------------------------------------------
// Helper — Keccak-256
// ---------------------------------------------------------------------------

// keccak256 returns the Keccak-256 (NOT standard SHA-3) hash of data.
// Used for address derivation and PoW block hashing.
func keccak256(data []byte) Hash {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	var out Hash
	copy(out[:], h.Sum(nil))
	return out
}

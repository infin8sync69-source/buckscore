// Package blockchain manages the canonical chain, block validation,
// and LevelDB-backed storage for the Bucks node.
package blockchain

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sync"

	"github.com/bucks-core/node/core/consensus"
	"github.com/bucks-core/node/core/types"
	"github.com/syndtr/goleveldb/leveldb"
)

// ---------------------------------------------------------------------------
// Key prefixes for LevelDB
// ---------------------------------------------------------------------------

var (
	prefixBlock     = []byte("b:") // b:<hash> → block JSON
	prefixHeader    = []byte("h:") // h:<hash> → header JSON
	prefixHeight    = []byte("n:") // n:<height> → canonical hash
	prefixTxIndex   = []byte("t:") // t:<txhash> → {blockHash, txIndex}
	keyChainHead    = []byte("chain:head")
	keyGenesis      = []byte("chain:genesis")
)

// ---------------------------------------------------------------------------
// Blockchain
// ---------------------------------------------------------------------------

// Blockchain manages the canonical chain and provides block access.
type Blockchain struct {
	db     *leveldb.DB
	engine *consensus.Engine
	config *GenesisConfig

	mu      sync.RWMutex
	head    *types.Block
	genesis *types.Block
}

// New opens (or initialises) a Bucks blockchain at the given dataDir.
// If the database is empty, the genesis block is written automatically.
func New(dataDir string, cfg *GenesisConfig, engine *consensus.Engine) (*Blockchain, error) {
	db, err := leveldb.OpenFile(dataDir, nil)
	if err != nil {
		return nil, fmt.Errorf("open leveldb at %s: %w", dataDir, err)
	}

	bc := &Blockchain{
		db:     db,
		engine: engine,
		config: cfg,
	}

	// Initialise genesis if the DB is empty.
	if err := bc.initGenesis(cfg); err != nil {
		db.Close()
		return nil, err
	}

	// Load current chain head.
	head, err := bc.loadHead()
	if err != nil {
		db.Close()
		return nil, err
	}
	bc.head = head
	bc.genesis, _ = bc.BlockByHeight(0)

	return bc, nil
}

// Close releases the database handle.
func (bc *Blockchain) Close() error {
	bc.mu.Lock()
	defer bc.mu.Unlock()
	return bc.db.Close()
}

// ---------------------------------------------------------------------------
// Genesis initialisation
// ---------------------------------------------------------------------------

func (bc *Blockchain) initGenesis(cfg *GenesisConfig) error {
	_, err := bc.db.Get(keyGenesis, nil)
	if err == nil {
		return nil // already initialised
	}
	if !errors.Is(err, leveldb.ErrNotFound) {
		return fmt.Errorf("genesis check: %w", err)
	}

	// Construct and write the genesis block.
	genesis := GenesisBlock(cfg)
	if err := bc.writeBlock(genesis); err != nil {
		return fmt.Errorf("write genesis: %w", err)
	}

	// Mark genesis and set as chain head.
	genesisHash := genesis.Hash()
	batch := new(leveldb.Batch)
	batch.Put(keyGenesis, genesisHash[:])
	batch.Put(keyChainHead, genesisHash[:])
	return bc.db.Write(batch, nil)
}

// ---------------------------------------------------------------------------
// Block insertion
// ---------------------------------------------------------------------------

// InsertBlock validates and appends a block to the canonical chain.
// The block must extend the current head.
func (bc *Blockchain) InsertBlock(block *types.Block) error {
	bc.mu.Lock()
	defer bc.mu.Unlock()

	if err := bc.validateBlock(block); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	if err := bc.writeBlock(block); err != nil {
		return fmt.Errorf("write block: %w", err)
	}

	// Update canonical head pointer.
	headHash := block.Hash()
	if err := bc.db.Put(keyChainHead, headHash[:], nil); err != nil {
		return err
	}
	bc.head = block
	return nil
}

// ---------------------------------------------------------------------------
// Block validation
// ---------------------------------------------------------------------------

func (bc *Blockchain) validateBlock(block *types.Block) error {
	if block.Header == nil {
		return errors.New("nil header")
	}

	// Must extend current head.
	if block.Header.ParentHash != bc.head.Hash() {
		return fmt.Errorf("parent mismatch: got %x, want %x",
			block.Header.ParentHash, bc.head.Hash())
	}
	if block.Number() != bc.head.Number()+1 {
		return fmt.Errorf("height mismatch: got %d, want %d",
			block.Number(), bc.head.Number()+1)
	}

	// Validate PoW.
	if err := bc.engine.VerifyHeader(block.Header, bc.head.Header); err != nil {
		return err
	}

	// Timestamp must be greater than parent.
	if block.Header.Timestamp <= bc.head.Header.Timestamp {
		return errors.New("timestamp not after parent")
	}

	return nil
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

func (bc *Blockchain) writeBlock(block *types.Block) error {
	data, err := json.Marshal(block)
	if err != nil {
		return err
	}

	hash := block.Hash()
	height := block.Number()

	// Height must fit in 8 bytes.
	heightKey := append(prefixHeight, encodeUint64(height)...)
	hashKey := append(prefixBlock, hash[:]...)

	batch := new(leveldb.Batch)
	batch.Put(hashKey, data)
	batch.Put(heightKey, hash[:])
	return bc.db.Write(batch, nil)
}

// ---------------------------------------------------------------------------
// Block queries
// ---------------------------------------------------------------------------

// Head returns the current canonical head block.
func (bc *Blockchain) Head() *types.Block {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	return bc.head
}

// BlockByHash retrieves a block by its hash.
func (bc *Blockchain) BlockByHash(hash types.Hash) (*types.Block, error) {
	key := append(prefixBlock, hash[:]...)
	data, err := bc.db.Get(key, nil)
	if err != nil {
		return nil, err
	}
	var block types.Block
	if err := json.Unmarshal(data, &block); err != nil {
		return nil, err
	}
	return &block, nil
}

// BlockByHeight retrieves the canonical block at the given height.
func (bc *Blockchain) BlockByHeight(height uint64) (*types.Block, error) {
	heightKey := append(prefixHeight, encodeUint64(height)...)
	hashBytes, err := bc.db.Get(heightKey, nil)
	if err != nil {
		return nil, err
	}
	var hash types.Hash
	copy(hash[:], hashBytes)
	return bc.BlockByHash(hash)
}

// TotalDifficulty returns the cumulative PoW difficulty of the canonical chain
// up to and including the current head.
func (bc *Blockchain) TotalDifficulty() *big.Int {
	bc.mu.RLock()
	defer bc.mu.RUnlock()

	td := new(big.Int)
	for h := uint64(0); h <= bc.head.Number(); h++ {
		block, err := bc.BlockByHeight(h)
		if err != nil {
			break
		}
		td.Add(td, block.Header.Difficulty)
	}
	return td
}

// ---------------------------------------------------------------------------
// Chain head loading
// ---------------------------------------------------------------------------

func (bc *Blockchain) loadHead() (*types.Block, error) {
	hashBytes, err := bc.db.Get(keyChainHead, nil)
	if err != nil {
		return nil, fmt.Errorf("load head hash: %w", err)
	}
	var hash types.Hash
	copy(hash[:], hashBytes)
	return bc.BlockByHash(hash)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

func encodeUint64(n uint64) []byte {
	b := make([]byte, 8)
	b[0] = byte(n >> 56)
	b[1] = byte(n >> 48)
	b[2] = byte(n >> 40)
	b[3] = byte(n >> 32)
	b[4] = byte(n >> 24)
	b[5] = byte(n >> 16)
	b[6] = byte(n >> 8)
	b[7] = byte(n)
	return b
}

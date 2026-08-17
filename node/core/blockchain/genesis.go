// Package blockchain manages the Bucks chain state and block processing.
package blockchain

import (
	"encoding/json"
	"math/big"
	"os"
	"time"

	"github.com/bucks-core/node/core/types"
)

// ---------------------------------------------------------------------------
// Genesis configuration
// ---------------------------------------------------------------------------

// GenesisAlloc maps an address to its initial BUCKS balance (in grain).
type GenesisAlloc map[types.Address]*big.Int

// GenesisConfig defines all parameters needed to construct the genesis block.
// The genesis block is block #0 — it has no parent and establishes the
// initial chain state. Its hash is hardcoded as a trust anchor.
type GenesisConfig struct {
	// ChainID identifies the Bucks network to EVM toolchains.
	ChainID uint64 `json:"chainId"`

	// NetworkName is a human-readable identifier.
	NetworkName string `json:"networkName"`

	// Timestamp is the Unix time of genesis (seconds). Defaults to now.
	Timestamp int64 `json:"timestamp"`

	// Difficulty is the initial PoW difficulty target.
	Difficulty *big.Int `json:"difficulty"`

	// GasLimit sets the initial per-block gas ceiling.
	GasLimit uint64 `json:"gasLimit"`

	// ExtraData is an arbitrary 32-byte field; typically encodes the network motto.
	ExtraData []byte `json:"extraData"`

	// Alloc is the pre-mine distribution (foundation, community treasury, etc.)
	// expressed in grain units (1 BUCKS = 1e18 grain).
	Alloc GenesisAlloc `json:"alloc"`

	// BootNodes is the list of multiaddr strings for initial peer discovery.
	BootNodes []string `json:"bootNodes"`
}

// DefaultGenesis returns the canonical genesis configuration for the
// Bucks mainnet. The denomination anchor: 1 BUCKS = the classical gold
// standard weight (mithqal).
func DefaultGenesis() *GenesisConfig {
	extraData := make([]byte, 32)
	copy(extraData, []byte("Bucks: the classical gold standard weight (mithqal)"))

	return &GenesisConfig{
		ChainID:     types.ChainID, // 8192
		NetworkName: "bucks-mainnet",
		Timestamp:   time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC).Unix(),
		Difficulty:  big.NewInt(1_000_000),
		GasLimit:    15_000_000,
		ExtraData:   extraData[:32],
		Alloc:       GenesisAlloc{},
		BootNodes: []string{
			// PRODUCTION BOOT NODES:
			// These must be replaced with real Ed25519-derived libp2p peer IDs before mainnet launch.
			// To generate a boot node key pair:
			//   1. Run: go run ./cmd/bucksnode genkey --output boot1.key
			//   2. The peer ID is derived from the public key and printed to stdout.
			//   3. Deploy the node, then update these multiaddrs.
			//
			// For local / devnet use, leave this list empty — the node will work
			// as a standalone instance without connecting to any peers.
			//
			// Uncomment and fill in when boot nodes are provisioned:
			// "/dns4/boot1.bucks.net/tcp/30300/p2p/<REAL_PEER_ID_1>",
			// "/dns4/boot2.bucks.net/tcp/30300/p2p/<REAL_PEER_ID_2>",
		},
	}
}

// TestnetGenesis returns a lower-difficulty genesis for local development / testnet.
func TestnetGenesis() *GenesisConfig {
	g := DefaultGenesis()
	g.NetworkName = "bucks-testnet"
	g.ChainID = 81920 // testnet uses chain ID 81920
	g.Difficulty = big.NewInt(1_000)

	// Prefund a development address with 1,000,000 BUCKS for testing.
	devAddr := types.Address{}
	copy(devAddr[:], []byte("BucksDevFaucetAddress00"))
	grain := new(big.Int)
	grain.SetString("1000000000000000000000000", 10) // 1,000,000 BUCKS in grain
	g.Alloc[devAddr] = grain

	g.BootNodes = []string{}
	return g
}

// ---------------------------------------------------------------------------
// Genesis block construction
// ---------------------------------------------------------------------------

// GenesisBlock constructs the block #0 from a GenesisConfig.
// The genesis block has:
//   - Height 0
//   - ParentHash = zero hash (no parent)
//   - No transactions
//   - Nonce = 0 (PoW not required for genesis)
func GenesisBlock(cfg *GenesisConfig) *types.Block {
	header := &types.BlockHeader{
		Height:     0,
		ParentHash: types.Hash{}, // zero hash
		StateRoot:  types.Hash{}, // populated after applying Alloc to state trie
		TxRoot:     emptyTxRoot(),
		Difficulty: cfg.Difficulty,
		Nonce:      0,
		Timestamp:  cfg.Timestamp,
		GasLimit:   cfg.GasLimit,
		GasUsed:    0,
		ExtraData:  cfg.ExtraData,
	}

	return types.NewBlock(header, nil)
}

// emptyTxRoot returns the Keccak-256 of an empty RLP list — the standard
// Ethereum empty-transaction root used when a block contains no transactions.
func emptyTxRoot() types.Hash {
	// Keccak256(RLP("")) = 0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421
	var h types.Hash
	// Hard-coded empty-trie root (Ethereum canonical value)
	emptyRoot := []byte{
		0x56, 0xe8, 0x1f, 0x17, 0x1b, 0xcc, 0x55, 0xa6,
		0xff, 0x83, 0x45, 0xe6, 0x92, 0xc0, 0xf8, 0x6e,
		0x5b, 0x48, 0xe0, 0x1b, 0x99, 0x6c, 0xad, 0xc0,
		0x01, 0x62, 0x2f, 0xb5, 0xe3, 0x63, 0xb4, 0x21,
	}
	copy(h[:], emptyRoot)
	return h
}

// ---------------------------------------------------------------------------
// Genesis persistence
// ---------------------------------------------------------------------------

// LoadGenesis reads a genesis config from a JSON file.
func LoadGenesis(path string) (*GenesisConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg GenesisConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SaveGenesis writes a genesis config to a JSON file.
func SaveGenesis(cfg *GenesisConfig, path string) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

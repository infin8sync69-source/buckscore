// Package config loads and validates Bucks node configuration from a TOML file
// and environment variables (via Viper).
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"

	"github.com/bucks-core/node/core/types"
)

// Config is the root configuration object for a Bucks node.
type Config struct {
	Node    NodeConfig    `mapstructure:"node"`
	P2P     P2PConfig     `mapstructure:"p2p"`
	RPC     RPCConfig     `mapstructure:"rpc"`
	Mining  MiningConfig  `mapstructure:"mining"`
	Logging LoggingConfig `mapstructure:"logging"`
}

// NodeConfig holds chain-level settings.
type NodeConfig struct {
	// DataDir is the root directory for all persistent data.
	DataDir string `mapstructure:"data_dir"`

	// Network is "mainnet", "testnet", or "devnet".
	Network string `mapstructure:"network"`

	// ChainID overrides the genesis chain ID (use only for private networks).
	ChainID uint64 `mapstructure:"chain_id"`
}

// P2PConfig holds peer-to-peer network settings.
type P2PConfig struct {
	// ListenAddrs are multiaddr strings this node listens on.
	ListenAddrs []string `mapstructure:"listen_addrs"`

	// BootNodes are the initial peers for DHT seeding.
	BootNodes []string `mapstructure:"boot_nodes"`

	// MaxPeers is the maximum number of concurrent connections.
	MaxPeers int `mapstructure:"max_peers"`

	// NodeKeyPath is the file containing the node's Ed25519 private key.
	NodeKeyPath string `mapstructure:"node_key_path"`
}

// RPCConfig holds JSON-RPC server settings.
type RPCConfig struct {
	// Enabled controls whether the HTTP JSON-RPC server starts.
	Enabled bool `mapstructure:"enabled"`

	// HTTPAddr is the bind address for the HTTP RPC server.
	HTTPAddr string `mapstructure:"http_addr"`

	// HTTPPort is the port for the HTTP RPC server (default 8192).
	HTTPPort int `mapstructure:"http_port"`

	// WSAddr is the bind address for the WebSocket RPC server.
	WSAddr string `mapstructure:"ws_addr"`

	// WSPort is the port for the WebSocket RPC server (default 8193).
	WSPort int `mapstructure:"ws_port"`

	// CORSAllowedOrigins is a list of allowed CORS origins for the HTTP server.
	CORSAllowedOrigins []string `mapstructure:"cors_allowed_origins"`
}

// MiningConfig holds settings for the built-in solo miner (optional).
type MiningConfig struct {
	// Enabled starts the built-in miner on node startup.
	Enabled bool `mapstructure:"enabled"`

	// Coinbase is the address that receives block rewards.
	Coinbase string `mapstructure:"coinbase"`

	// Threads is the number of CPU threads used for mining (0 = all cores).
	Threads int `mapstructure:"threads"`
}

// LoggingConfig controls log output.
type LoggingConfig struct {
	// Level is "debug", "info", "warn", or "error".
	Level string `mapstructure:"level"`

	// Format is "json" or "text".
	Format string `mapstructure:"format"`
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// DefaultConfig returns the recommended configuration for mainnet.
func DefaultConfig() *Config {
	home, _ := os.UserHomeDir()
	dataDir := filepath.Join(home, ".bucks", "data")

	return &Config{
		Node: NodeConfig{
			DataDir: dataDir,
			Network: "mainnet",
			ChainID: types.ChainID,
		},
		P2P: P2PConfig{
			ListenAddrs: []string{
				"/ip4/0.0.0.0/tcp/30300",
				"/ip6/::/tcp/30300",
			},
			BootNodes: []string{
				// Boot nodes are configured in genesis.go for mainnet.
				// For local / devnet, keep this empty.
				// Override via miner.toml [p2p] boot_nodes or BUCKS_P2P_BOOT_NODES env var.
			},
			MaxPeers:    50,
			NodeKeyPath: filepath.Join(home, ".bucks", "node.key"),
		},
		RPC: RPCConfig{
			Enabled:  true,
			HTTPAddr: "127.0.0.1",
			HTTPPort: 8192,
			WSAddr:   "127.0.0.1",
			WSPort:   8193,
			CORSAllowedOrigins: []string{
				"http://localhost:3000",
				"http://localhost:8080",
				"bucks://",
				"app://bucks",
			},
		},
		Mining: MiningConfig{
			Enabled: false,
			Threads: 0,
		},
		Logging: LoggingConfig{
			Level:  "info",
			Format: "text",
		},
	}
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// Load reads configuration from configPath (TOML), falls back to defaults,
// and applies environment variable overrides (prefix: BUCKS_).
func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetEnvPrefix("BUCKS")
	v.AutomaticEnv()

	// Set defaults from DefaultConfig.
	defaults := DefaultConfig()
	v.SetDefault("node.data_dir", defaults.Node.DataDir)
	v.SetDefault("node.network", defaults.Node.Network)
	v.SetDefault("node.chain_id", defaults.Node.ChainID)
	v.SetDefault("p2p.listen_addrs", defaults.P2P.ListenAddrs)
	v.SetDefault("p2p.boot_nodes", defaults.P2P.BootNodes)
	v.SetDefault("p2p.max_peers", defaults.P2P.MaxPeers)
	v.SetDefault("rpc.enabled", defaults.RPC.Enabled)
	v.SetDefault("rpc.http_addr", defaults.RPC.HTTPAddr)
	v.SetDefault("rpc.http_port", defaults.RPC.HTTPPort)
	v.SetDefault("rpc.ws_addr", defaults.RPC.WSAddr)
	v.SetDefault("rpc.ws_port", defaults.RPC.WSPort)
	v.SetDefault("mining.enabled", defaults.Mining.Enabled)
	v.SetDefault("mining.threads", defaults.Mining.Threads)
	v.SetDefault("logging.level", defaults.Logging.Level)
	v.SetDefault("logging.format", defaults.Logging.Format)

	// Load config file if provided.
	if configPath != "" {
		v.SetConfigFile(configPath)
		if err := v.ReadInConfig(); err != nil {
			return nil, fmt.Errorf("read config %s: %w", configPath, err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	// Ensure data directory exists.
	if err := os.MkdirAll(cfg.Node.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir %s: %w", cfg.Node.DataDir, err)
	}

	return &cfg, nil
}

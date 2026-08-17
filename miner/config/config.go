// Package config loads and validates bucksminer configuration.
// Configuration is read from a TOML file (default: ~/.bucks/miner.toml)
// and can be overridden by CLI flags.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/BurntSushi/toml"
)

// ---------------------------------------------------------------------------
// Config structs
// ---------------------------------------------------------------------------

// Config is the root configuration for bucksminer.
type Config struct {
	// Wallet is the receiving address for block rewards.
	Wallet WalletConfig `toml:"wallet"`

	// Node is the Bucks full-node connection (solo mining).
	Node NodeConfig `toml:"node"`

	// Pool is the Stratum v2 pool configuration.
	Pool PoolConfig `toml:"pool"`

	// Mining controls performance tuning.
	Mining MiningConfig `toml:"mining"`

	// API controls the local HTTP status server.
	API APIConfig `toml:"api"`

	// Log controls log verbosity and format.
	Log LogConfig `toml:"log"`
}

// WalletConfig holds the miner's payout address.
type WalletConfig struct {
	// Address is the Bucks address that receives block rewards (20-byte 0x-prefixed hex).
	Address string `toml:"address"`
}

// NodeConfig is used in solo-mining mode.
type NodeConfig struct {
	// RPCURL is the Bucks node JSON-RPC endpoint.
	// Default: http://127.0.0.1:8192
	RPCURL string `toml:"rpc_url"`
}

// PoolConfig is used in pool-mining mode.
type PoolConfig struct {
	// URL is the Stratum v2 pool endpoint (e.g. "stratum+tcp://pool.bucks.net:3333").
	URL string `toml:"url"`

	// Worker is an optional worker name suffix (appended to the wallet address).
	Worker string `toml:"worker"`
}

// MiningConfig controls CPU usage and algorithm parameters.
type MiningConfig struct {
	// Mode is "solo" or "pool".
	Mode string `toml:"mode"`

	// Threads is the number of CPU threads to use for mining.
	// 0 = use all available logical CPUs.
	Threads int `toml:"threads"`

	// WorkPollInterval is how often (ms) to fetch new work from the node in solo mode.
	WorkPollInterval int `toml:"work_poll_ms"`

	// SubmitStale controls whether to submit shares for stale jobs.
	SubmitStale bool `toml:"submit_stale"`
}

// APIConfig controls the local HTTP monitoring server.
type APIConfig struct {
	// Enabled starts the HTTP API server on startup.
	Enabled bool `toml:"enabled"`

	// Addr is the bind address (default: 127.0.0.1:8194).
	Addr string `toml:"addr"`
}

// LogConfig controls logging output.
type LogConfig struct {
	// Level: "debug", "info", "warn", "error".
	Level string `toml:"level"`
	// Format: "text" or "json".
	Format string `toml:"format"`
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// Default returns a Config populated with sensible defaults.
func Default() *Config {
	threads := runtime.NumCPU()
	return &Config{
		Wallet: WalletConfig{Address: ""},
		Node:   NodeConfig{RPCURL: "http://127.0.0.1:8192"},
		Pool:   PoolConfig{URL: "", Worker: "worker1"},
		Mining: MiningConfig{
			Mode:             "solo",
			Threads:          threads,
			WorkPollInterval: 2000,
			SubmitStale:      false,
		},
		API: APIConfig{
			Enabled: true,
			Addr:    "127.0.0.1:8194",
		},
		Log: LogConfig{Level: "info", Format: "text"},
	}
}

// ---------------------------------------------------------------------------
// Loading & saving
// ---------------------------------------------------------------------------

// DefaultPath returns the default config file path (~/.bucks/miner.toml).
func DefaultPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bucks", "miner.toml")
}

// Load reads a TOML config from path. Missing fields fall back to defaults.
func Load(path string) (*Config, error) {
	cfg := Default()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		// Config file not found — use defaults (first-run scenario).
		return cfg, nil
	}

	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}

	if cfg.Mining.Threads <= 0 {
		cfg.Mining.Threads = runtime.NumCPU()
	}

	return cfg, nil
}

// Save writes a Config to path as TOML.
func Save(cfg *Config, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(cfg)
}

// Validate returns an error if the config is missing required fields.
func Validate(cfg *Config) error {
	if cfg.Wallet.Address == "" {
		return fmt.Errorf("wallet.address is required — set your BUCKS receiving address")
	}
	if cfg.Mining.Mode != "solo" && cfg.Mining.Mode != "pool" {
		return fmt.Errorf("mining.mode must be \"solo\" or \"pool\", got %q", cfg.Mining.Mode)
	}
	if cfg.Mining.Mode == "pool" && cfg.Pool.URL == "" {
		return fmt.Errorf("pool.url is required when mining.mode = \"pool\"")
	}
	return nil
}

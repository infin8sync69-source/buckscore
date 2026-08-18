// Command bucksnode is the Bucks Blockchain full node.
//
// Usage:
//
//	bucksnode [--config path/to/config.toml] [--datadir ~/.bucks/data]
//	bucksnode init [--network mainnet|testnet|devnet]
//	bucksnode version
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"

	"github.com/bucks-core/node/api"
	"github.com/bucks-core/node/config"
	"github.com/bucks-core/node/core/blockchain"
	"github.com/bucks-core/node/core/consensus"
	"github.com/bucks-core/node/core/p2p"
	"github.com/bucks-core/node/core/types"
)

// ---------------------------------------------------------------------------
// Build-time variables (injected via ldflags)
// ---------------------------------------------------------------------------

var (
	Version   = "0.1.0"
	GitCommit = "dev"
	BuildDate = "unknown"
)

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

func main() {
	root := &cobra.Command{
		Use:   "bucksnode",
		Short: "Bucks Blockchain full node",
		Long: fmt.Sprintf(`bucksnode runs a full Bucks Blockchain node.

Native coin: BUCKS — 1 BUCKS = the classical gold standard weight (mithqal).
Chain ID: %d | Consensus: Proof-of-Work (double-Keccak-256)`, types.ChainID),
		RunE: runNode,
	}

	// Persistent flags available to all sub-commands.
	root.PersistentFlags().String("config", "", "Path to TOML config file")
	root.PersistentFlags().String("datadir", "", "Override data directory")
	root.PersistentFlags().String("network", "mainnet", "Network: mainnet | testnet | devnet")
	root.PersistentFlags().Bool("rpc", true, "Enable HTTP JSON-RPC server")
	root.PersistentFlags().Int("rpc-port", 8192, "HTTP JSON-RPC port")
	root.PersistentFlags().Bool("mine", false, "Enable built-in solo miner")
	root.PersistentFlags().String("coinbase", "", "Miner coinbase address")
	root.PersistentFlags().Int("threads", 0, "Mining threads (0 = all CPU cores)")

	// Sub-commands.
	root.AddCommand(initCmd())
	root.AddCommand(versionCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// ---------------------------------------------------------------------------
// Node start
// ---------------------------------------------------------------------------

func runNode(cmd *cobra.Command, _ []string) error {
	// ---- Config ----
	cfgPath, _ := cmd.Flags().GetString("config")
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// CLI overrides.
	if dd, _ := cmd.Flags().GetString("datadir"); dd != "" {
		cfg.Node.DataDir = dd
	}
	if net, _ := cmd.Flags().GetString("network"); net != "" {
		cfg.Node.Network = net
	}
	if mine, _ := cmd.Flags().GetBool("mine"); mine {
		cfg.Mining.Enabled = true
	}
	if cb, _ := cmd.Flags().GetString("coinbase"); cb != "" {
		cfg.Mining.Coinbase = cb
	}
	if t, _ := cmd.Flags().GetInt("threads"); t > 0 {
		cfg.Mining.Threads = t
	}

	// ---- Logging ----
	setupLogging(cfg.Logging.Level, cfg.Logging.Format)
	log.Info().
		Str("version", Version).
		Str("network", cfg.Node.Network).
		Str("datadir", cfg.Node.DataDir).
		Msg("Starting Bucks node")

	// ---- Genesis ----
	var genCfg *blockchain.GenesisConfig
	switch cfg.Node.Network {
	case "testnet", "devnet":
		genCfg = blockchain.TestnetGenesis()
	default:
		genCfg = blockchain.DefaultGenesis()
	}

	// ---- Consensus engine ----
	engine := consensus.NewEngine(cfg.Mining.Threads)

	// ---- Blockchain ----
	bc, err := blockchain.New(cfg.Node.DataDir+"/blocks", genCfg, engine)
	if err != nil {
		return fmt.Errorf("open blockchain: %w", err)
	}
	defer bc.Close()

	log.Info().
		Uint64("head", bc.Head().Number()).
		Str("headHash", fmt.Sprintf("%x", bc.Head().Hash())).
		Msg("Blockchain loaded")

	// ---- P2P ----
	p2pCfg := p2p.DefaultConfig()
	p2pCfg.ListenAddrs = cfg.P2P.ListenAddrs
	p2pCfg.BootNodes = cfg.P2P.BootNodes
	p2pCfg.MaxPeers = cfg.P2P.MaxPeers
	p2pCfg.ChainID = cfg.Node.ChainID

	p2pNode, err := p2p.NewNode(p2pCfg)
	if err != nil {
		return fmt.Errorf("create P2P node: %w", err)
	}
	if err := p2pNode.Start(); err != nil {
		return fmt.Errorf("start P2P: %w", err)
	}
	defer p2pNode.Stop()

	// ---- RPC ----
	var rpcServer *api.Server
	if cfg.RPC.Enabled {
		rpcServer = api.NewServer(bc, p2pNode)
		addr := fmt.Sprintf("%s:%d", cfg.RPC.HTTPAddr, cfg.RPC.HTTPPort)
		go func() {
			if err := rpcServer.Start(addr); err != nil {
				log.Error().Err(err).Msg("RPC server stopped")
			}
		}()
	}

	// ---- Graceful shutdown ----
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("Shutdown signal received — stopping gracefully…")
	if rpcServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = rpcServer.Stop(ctx)
	}

	log.Info().Msg("Bucks node stopped cleanly")
	return nil
}

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

func initCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Initialise a new node data directory and write genesis.json",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfgPath, _ := cmd.Flags().GetString("config")
			cfg, err := config.Load(cfgPath)
			if err != nil {
				return err
			}

			net, _ := cmd.Flags().GetString("network")
			var genCfg *blockchain.GenesisConfig
			if net == "testnet" {
				genCfg = blockchain.TestnetGenesis()
			} else {
				genCfg = blockchain.DefaultGenesis()
			}

			genesisPath := cfg.Node.DataDir + "/genesis.json"
			if err := blockchain.SaveGenesis(genCfg, genesisPath); err != nil {
				return fmt.Errorf("write genesis: %w", err)
			}
			fmt.Printf("Genesis written to: %s\n", genesisPath)
			fmt.Printf("Chain ID:          %d\n", genCfg.ChainID)
			fmt.Printf("Network:           %s\n", genCfg.NetworkName)
			fmt.Printf("Denomination:      the classical gold standard weight (mithqal)\n")
			return nil
		},
	}
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the node version",
		Run: func(_ *cobra.Command, _ []string) {
			fmt.Printf("Bucks Node v%s (commit %s, built %s)\n", Version, GitCommit, BuildDate)
			fmt.Printf("Chain ID: %d | Coin: BUCKS | Denomination: the classical gold standard weight (mithqal)\n", types.ChainID)
		},
	}
}

// ---------------------------------------------------------------------------
// Logging setup
// ---------------------------------------------------------------------------

func setupLogging(level, format string) {
	if format == "json" {
		log.Logger = zerolog.New(os.Stdout).With().Timestamp().Logger()
	} else {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout})
	}

	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)
}

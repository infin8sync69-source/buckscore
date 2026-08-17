// Command bucksminer — the Bucks Blockchain plug-in mining client.
//
// Usage:
//
//	bucksminer mine [--address 0x...] [--mode solo|pool] [--threads N]
//	bucksminer init              # Create default config at ~/.bucks/miner.toml
//	bucksminer status            # Print current stats from the running daemon
//	bucksminer version
//
// The miner exposes a local HTTP API on :8194 that the GUI uses for live
// dashboards. Start in headless mode (no GUI) with:
//
//	bucksminer mine --address 0xYOUR_BUCKS_ADDRESS
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"encoding/json"
	"io"

	"github.com/bucks-core/miner/api"
	"github.com/bucks-core/miner/config"
	"github.com/bucks-core/miner/engine"
	"github.com/bucks-core/miner/rpc"
	"github.com/bucks-core/miner/stats"
	"github.com/bucks-core/miner/stratum"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
)

// Build-time vars — injected by ldflags.
var (
	Version   = "0.1.0"
	GitCommit = "dev"
	BuildDate = "unknown"
)

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	root := buildRootCmd()
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// ---------------------------------------------------------------------------
// Root command
// ---------------------------------------------------------------------------

func buildRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "bucksminer",
		Short: "Bucks Blockchain mining client",
		Long: `bucksminer mines BUCKS using double-Keccak-256 Proof-of-Work.

Rewards are paid to your configured wallet address in BUCKS
(1 BUCKS = the classical gold standard weight (mithqal)).

Supports solo mining (direct node connection) and pool mining (Stratum v2).`,
	}

	root.AddCommand(mineCmd())
	root.AddCommand(initCmd())
	root.AddCommand(statusCmd())
	root.AddCommand(versionCmd())
	return root
}

// ---------------------------------------------------------------------------
// mine command
// ---------------------------------------------------------------------------

func mineCmd() *cobra.Command {
	var (
		cfgPath string
		address string
		mode    string
		threads int
		poolURL string
		nodeURL string
		apiAddr string
		noAPI   bool
	)

	cmd := &cobra.Command{
		Use:   "mine",
		Short: "Start mining BUCKS",
		RunE: func(cmd *cobra.Command, _ []string) error {
			// ---- Load config ----
			if cfgPath == "" {
				cfgPath = config.DefaultPath()
			}
			cfg, err := config.Load(cfgPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			// CLI overrides.
			if address != "" { cfg.Wallet.Address = address }
			if mode    != "" { cfg.Mining.Mode    = mode    }
			if threads >  0  { cfg.Mining.Threads = threads }
			if poolURL != "" { cfg.Pool.URL       = poolURL }
			if nodeURL != "" { cfg.Node.RPCURL    = nodeURL }
			if apiAddr != "" { cfg.API.Addr       = apiAddr }
			if noAPI         { cfg.API.Enabled    = false   }

			if err := config.Validate(cfg); err != nil {
				return err
			}

			// ---- Logging ----
			setupLogging(cfg.Log.Level, cfg.Log.Format)
			log.Info().
				Str("version",  Version).
				Str("address",  cfg.Wallet.Address).
				Str("mode",     cfg.Mining.Mode).
				Int("threads",  cfg.Mining.Threads).
				Int("cpus",     runtime.NumCPU()).
				Msg("bucksminer starting")

			// ---- Stats collector ----
			collector := stats.New(cfg.Mining.Threads)
			defer collector.Stop()

			// ---- Backend ----
			var backend engine.Backend
			switch cfg.Mining.Mode {
			case "pool":
				log.Info().Str("pool", cfg.Pool.URL).Msg("Connecting to Stratum pool")
				sb, err := stratum.NewStratumBackend(
					cfg.Pool.URL,
					cfg.Wallet.Address,
					cfg.Pool.Worker,
				)
				if err != nil {
					return fmt.Errorf("stratum connect: %w", err)
				}
				defer sb.Close()
				backend = sb

			default: // "solo"
				log.Info().Str("rpc", cfg.Node.RPCURL).Msg("Solo mining via Bucks node")
				backend = rpc.NewSoloBackend(
					cfg.Node.RPCURL,
					cfg.Wallet.Address,
					time.Duration(cfg.Mining.WorkPollInterval)*time.Millisecond,
				)
				defer backend.Close()
			}

			// ---- Engine ----
			miner := engine.New(backend, collector, cfg.Mining.Threads)

			// ---- Local API ----
			var apiServer *api.Server
			if cfg.API.Enabled {
				apiServer = api.New(cfg.API.Addr, miner, collector, cfg, cfgPath)
				go func() {
					if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
						log.Error().Err(err).Msg("API server error")
					}
				}()
			}

			// ---- Start mining ----
			if err := miner.Start(); err != nil {
				return err
			}

			// ---- Graceful shutdown ----
			quit := make(chan os.Signal, 1)
			signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
			<-quit

			log.Info().Msg("Shutdown signal — stopping miner")
			miner.Stop()

			if apiServer != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				_ = apiServer.Stop(ctx)
			}

			snap := collector.Snap(false)
			log.Info().
				Str("hashrate",        stats.FormatHashrate(snap.AvgHashrate)).
				Int64("sharesAccepted", snap.SharesAccepted).
				Int64("blocksFound",    snap.BlocksFound).
				Int64("uptime",         snap.Uptime).
				Msg("Final stats")

			return nil
		},
	}

	cmd.Flags().StringVar(&cfgPath, "config",   "",                      "Path to config file")
	cmd.Flags().StringVar(&address, "address",  "",                      "BUCKS wallet address (overrides config)")
	cmd.Flags().StringVar(&mode,    "mode",     "",                      "Mining mode: solo|pool (overrides config)")
	cmd.Flags().IntVar(  &threads,  "threads",  0,                       "CPU threads (0 = all cores)")
	cmd.Flags().StringVar(&poolURL, "pool",     "",                      "Stratum pool URL (pool mode)")
	cmd.Flags().StringVar(&nodeURL, "node",     "http://127.0.0.1:8192", "Bucks node RPC URL (solo mode)")
	cmd.Flags().StringVar(&apiAddr, "api-addr", "127.0.0.1:8194",        "Local API bind address")
	cmd.Flags().BoolVar(  &noAPI,   "no-api",   false,                   "Disable the local HTTP API")

	return cmd
}

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

func initCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Create a default config file at ~/.bucks/miner.toml",
		RunE: func(_ *cobra.Command, _ []string) error {
			path := config.DefaultPath()
			if _, err := os.Stat(path); err == nil {
				fmt.Printf("Config already exists: %s\n", path)
				return nil
			}
			cfg := config.Default()
			if err := config.Save(cfg, path); err != nil {
				return err
			}
			fmt.Printf("Config written to: %s\n", path)
			fmt.Println("Edit wallet.address before starting to mine.")
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Print stats from a running bucksminer daemon",
		RunE: func(_ *cobra.Command, _ []string) error {
			resp, err := http.Get("http://127.0.0.1:8194/api/status")
			if err != nil {
				return fmt.Errorf("could not reach bucksminer API at :8194 — is it running? (%w)", err)
			}
			defer resp.Body.Close()

			var snap stats.Snapshot
			if err := jsonDecode(resp.Body, &snap); err != nil {
				return err
			}

			fmt.Printf("Running:   %v\n",                        snap.Running)
			fmt.Printf("Uptime:    %ds\n",                       snap.Uptime)
			fmt.Printf("Hashrate:  %s\n",                        stats.FormatHashrate(snap.Hashrate))
			fmt.Printf("Avg:       %s\n",                        stats.FormatHashrate(snap.AvgHashrate))
			fmt.Printf("Accepted:  %d  Rejected: %d\n",          snap.SharesAccepted, snap.SharesRejected)
			fmt.Printf("Blocks:    %d\n",                        snap.BlocksFound)
			for _, w := range snap.Workers {
				fmt.Printf("  worker[%d]: %s\n", w.ID, stats.FormatHashrate(w.Hashrate))
			}
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// version command
// ---------------------------------------------------------------------------

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(_ *cobra.Command, _ []string) {
			fmt.Printf("bucksminer v%s (commit %s, built %s)\n", Version, GitCommit, BuildDate)
			fmt.Printf("Coin: BUCKS | PoW: double-Keccak-256 | Chain: 8192\n")
			fmt.Printf("1 BUCKS = the classical gold standard weight (mithqal)\n")
		},
	}
}

// ---------------------------------------------------------------------------
// Helpers
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

func jsonDecode(r io.Reader, v interface{}) error {
	return json.NewDecoder(r).Decode(v)
}

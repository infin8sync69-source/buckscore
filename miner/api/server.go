// Package api exposes a local HTTP API so the Electron GUI (and any other
// tooling) can monitor and control the bucksminer without spawning a subprocess.
//
// Endpoints:
//
//	GET  /api/status       → JSON snapshot (hashrate, shares, workers, history)
//	POST /api/start        → start mining (idempotent)
//	POST /api/stop         → stop mining (idempotent)
//	GET  /api/config       → current config
//	POST /api/config       → update config and persist to disk
//	GET  /api/events       → Server-Sent Events stream (1-second pushes)
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/bucks-core/miner/config"
	"github.com/bucks-core/miner/stats"
	"github.com/rs/zerolog/log"
)

// ---------------------------------------------------------------------------
// Controller interface (injected to avoid import cycles)
// ---------------------------------------------------------------------------

// MinerController is the interface the API uses to control mining.
// Implemented by the Miner + backend in cmd/bucksminer/main.go.
type MinerController interface {
	Start() error
	Stop()
	IsRunning() bool
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Server is the local HTTP monitoring and control API.
type Server struct {
	addr       string
	controller MinerController
	collector  *stats.Collector
	cfg        *config.Config
	cfgPath    string
	httpServer *http.Server
}

// New creates a Server. cfgPath is used to persist config updates.
func New(
	addr string,
	controller MinerController,
	collector *stats.Collector,
	cfg *config.Config,
	cfgPath string,
) *Server {
	s := &Server{
		addr:       addr,
		controller: controller,
		collector:  collector,
		cfg:        cfg,
		cfgPath:    cfgPath,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/start",  s.handleStart)
	mux.HandleFunc("/api/stop",   s.handleStop)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.HandleFunc("/",           s.handleHealth)

	s.httpServer = &http.Server{
		Addr:         addr,
		Handler:      withCORS(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 0, // SSE endpoint needs no write timeout
	}
	return s
}

// Start begins listening. Blocks until Stop() is called.
func (s *Server) Start() error {
	log.Info().Str("addr", s.addr).Msg("Miner API listening")
	return s.httpServer.ListenAndServe()
}

// Stop gracefully shuts down the HTTP server.
func (s *Server) Stop(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","service":"bucksminer"}`)
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	snap := s.collector.Snap(s.controller.IsRunning())
	writeJSON(w, snap)
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if s.controller.IsRunning() {
		writeJSON(w, map[string]interface{}{"running": true, "note": "already running"})
		return
	}
	if err := s.controller.Start(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"running": true})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	s.controller.Stop()
	writeJSON(w, map[string]interface{}{"running": false})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, s.cfg)

	case http.MethodPost:
		var updated config.Config
		if err := json.NewDecoder(r.Body).Decode(&updated); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := config.Validate(&updated); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := config.Save(&updated, s.cfgPath); err != nil {
			http.Error(w, "save config: "+err.Error(), http.StatusInternalServerError)
			return
		}
		s.cfg = &updated
		writeJSON(w, map[string]interface{}{"saved": true})

	default:
		http.Error(w, "GET or POST required", http.StatusMethodNotAllowed)
	}
}

// handleEvents streams stats as Server-Sent Events (SSE) every second.
// The Electron GUI subscribes to this endpoint for live dashboard updates.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type",  "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection",    "keep-alive")

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			snap := s.collector.Snap(s.controller.IsRunning())
			data, _ := json.Marshal(snap)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// ---------------------------------------------------------------------------
// Middleware & helpers
// ---------------------------------------------------------------------------

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin",  "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

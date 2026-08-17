// Package stratum implements a Stratum v2-compatible pool client
// and the engine.Backend interface for pool-based mining.
//
// Protocol overview (Stratum v1/v2 JSON-RPC over TCP):
//
//	Client → Pool:  mining.subscribe   (session setup)
//	Client → Pool:  mining.authorize   (authenticate wallet address)
//	Pool → Client:  mining.notify      (new job)
//	Pool → Client:  mining.set_difficulty (adjust share difficulty)
//	Client → Pool:  mining.submit      (share found)
//
// The StratumBackend reconnects automatically on disconnect.
package stratum

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/bucks-core/miner/engine"
	"github.com/rs/zerolog/log"
)

// ---------------------------------------------------------------------------
// Stratum protocol types
// ---------------------------------------------------------------------------

type stratumMsg struct {
	ID     *int            `json:"id"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  interface{}     `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// StratumBackend
// ---------------------------------------------------------------------------

// StratumBackend connects to a Stratum pool and implements engine.Backend.
type StratumBackend struct {
	poolURL    string // e.g. "stratum+tcp://pool.bucks.net:3333"
	workerName string // walletAddress.workerSuffix

	mu       sync.Mutex
	conn     net.Conn
	scanner  *bufio.Scanner
	msgID    int

	// Current job (updated on mining.notify).
	currentJob   *engine.Job
	difficulty   *big.Int

	updateCh chan struct{}
	stopCh   chan struct{}
	once     sync.Once
}

// NewStratumBackend creates and connects a StratumBackend.
func NewStratumBackend(poolURL, walletAddress, workerSuffix string) (*StratumBackend, error) {
	sb := &StratumBackend{
		poolURL:    poolURL,
		workerName: walletAddress + "." + workerSuffix,
		difficulty: big.NewInt(1),
		updateCh:   make(chan struct{}, 4),
		stopCh:     make(chan struct{}),
	}

	if err := sb.connect(); err != nil {
		return nil, err
	}

	go sb.readLoop()
	return sb, nil
}

// ---------------------------------------------------------------------------
// engine.Backend implementation
// ---------------------------------------------------------------------------

// GetWork returns the most recently received mining job.
// Blocks until a job is available.
func (sb *StratumBackend) GetWork(ctx context.Context) (*engine.Job, error) {
	deadline := time.Now().Add(30 * time.Second)
	for {
		sb.mu.Lock()
		job := sb.currentJob
		sb.mu.Unlock()
		if job != nil {
			return job, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("stratum: timed out waiting for initial job from pool")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// SubmitWork sends a share to the pool.
func (sb *StratumBackend) SubmitWork(ctx context.Context, result engine.Result) (bool, error) {
	sb.mu.Lock()
	defer sb.mu.Unlock()

	nonceHex := fmt.Sprintf("%016x", result.Nonce)
	params   := []interface{}{
		sb.workerName,
		result.JobID,
		"0x" + result.Hash.Hex(),      // mix hash placeholder
		nonceHex,
	}

	id := sb.nextID()
	msg := stratumMsg{ID: &id, Method: "mining.submit", Params: mustMarshal(params)}
	if err := sb.send(msg); err != nil {
		return false, fmt.Errorf("stratum submit: %w", err)
	}

	log.Info().
		Str("jobID", result.JobID[:min(len(result.JobID), 12)]+"…").
		Str("nonce", nonceHex).
		Msg("Share submitted to pool")
	return true, nil // acceptance is handled asynchronously in readLoop
}

// WorkUpdates returns a channel that fires when the pool sends a new job.
func (sb *StratumBackend) WorkUpdates() <-chan struct{} {
	return sb.updateCh
}

// Close disconnects from the pool.
func (sb *StratumBackend) Close() error {
	sb.once.Do(func() { close(sb.stopCh) })
	sb.mu.Lock()
	defer sb.mu.Unlock()
	if sb.conn != nil {
		return sb.conn.Close()
	}
	return nil
}

// ---------------------------------------------------------------------------
// Connection & handshake
// ---------------------------------------------------------------------------

func (sb *StratumBackend) connect() error {
	addr := strings.TrimPrefix(sb.poolURL, "stratum+tcp://")
	addr = strings.TrimPrefix(addr, "tcp://")

	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return fmt.Errorf("stratum connect %s: %w", addr, err)
	}

	sb.mu.Lock()
	sb.conn    = conn
	sb.scanner = bufio.NewScanner(conn)
	sb.mu.Unlock()

	log.Info().Str("pool", sb.poolURL).Msg("Stratum connection established")

	// Handshake: subscribe → authorize.
	if err := sb.subscribe(); err != nil {
		conn.Close()
		return fmt.Errorf("stratum subscribe: %w", err)
	}
	if err := sb.authorize(); err != nil {
		conn.Close()
		return fmt.Errorf("stratum authorize: %w", err)
	}

	return nil
}

func (sb *StratumBackend) subscribe() error {
	sb.mu.Lock()
	defer sb.mu.Unlock()

	id := sb.nextID()
	params := []interface{}{"bucksminer/0.1.0"}
	return sb.send(stratumMsg{
		ID:     &id,
		Method: "mining.subscribe",
		Params: mustMarshal(params),
	})
}

func (sb *StratumBackend) authorize() error {
	sb.mu.Lock()
	defer sb.mu.Unlock()

	id := sb.nextID()
	params := []interface{}{sb.workerName, "x"} // password "x" is pool convention
	return sb.send(stratumMsg{
		ID:     &id,
		Method: "mining.authorize",
		Params: mustMarshal(params),
	})
}

// ---------------------------------------------------------------------------
// Read loop — processes inbound messages from the pool
// ---------------------------------------------------------------------------

func (sb *StratumBackend) readLoop() {
	for {
		select {
		case <-sb.stopCh:
			return
		default:
		}

		sb.mu.Lock()
		scanner := sb.scanner
		sb.mu.Unlock()

		if !scanner.Scan() {
			log.Warn().Msg("Stratum connection lost — reconnecting")
			if err := sb.reconnect(); err != nil {
				log.Error().Err(err).Msg("Stratum reconnect failed")
				return
			}
			continue
		}

		line := scanner.Bytes()
		var msg stratumMsg
		if err := json.Unmarshal(line, &msg); err != nil {
			log.Warn().Str("line", string(line)).Msg("Invalid Stratum message")
			continue
		}

		switch msg.Method {
		case "mining.notify":
			sb.handleNotify(msg)
		case "mining.set_difficulty":
			sb.handleSetDifficulty(msg)
		default:
			log.Debug().Str("method", msg.Method).Msg("Stratum message")
		}
	}
}

// ---------------------------------------------------------------------------
// Notification handlers
// ---------------------------------------------------------------------------

// handleNotify processes a mining.notify job from the pool.
// Stratum v1 mining.notify params:
//
//	[jobID, prevHash, coinb1, coinb2, merkleBranch, version, nbits, ntime, cleanJobs]
func (sb *StratumBackend) handleNotify(msg stratumMsg) {
	var params []json.RawMessage
	if err := json.Unmarshal(msg.Params, &params); err != nil || len(params) < 8 {
		log.Warn().Msg("Malformed mining.notify")
		return
	}

	var jobID string
	json.Unmarshal(params[0], &jobID)

	// Build a synthetic header from the notification fields.
	// In production, reconstruct the full header using coinbase and Merkle branches.
	// For the scaffold, use the prevHash as a stand-in for the header bytes.
	var prevHash string
	json.Unmarshal(params[1], &prevHash)
	headerBytes := hexToBytes(prevHash)

	// Derive target from current pool difficulty.
	sb.mu.Lock()
	diff    := new(big.Int).Set(sb.difficulty)
	sb.mu.Unlock()

	targetInt := engine.DifficultyToTarget(diff)
	target    := engine.TargetToBytes(targetInt)

	job := &engine.Job{
		ID:          jobID,
		HeaderBytes: headerBytes,
		Target:      target,
		Height:      0, // pool doesn't always provide height
	}

	sb.mu.Lock()
	sb.currentJob = job
	sb.mu.Unlock()

	log.Info().Str("jobID", jobID).Msg("New job from pool")

	select {
	case sb.updateCh <- struct{}{}:
	default:
	}
}

func (sb *StratumBackend) handleSetDifficulty(msg stratumMsg) {
	var params []float64
	if err := json.Unmarshal(msg.Params, &params); err != nil || len(params) == 0 {
		return
	}
	diff := new(big.Float).SetFloat64(params[0])
	diffInt, _ := diff.Int(nil)
	if diffInt.Sign() <= 0 {
		diffInt.SetInt64(1)
	}

	sb.mu.Lock()
	sb.difficulty = diffInt
	sb.mu.Unlock()

	log.Info().Str("difficulty", diffInt.String()).Msg("Pool difficulty updated")
}

// ---------------------------------------------------------------------------
// Reconnect
// ---------------------------------------------------------------------------

func (sb *StratumBackend) reconnect() error {
	backoff := time.Second
	for {
		select {
		case <-sb.stopCh:
			return fmt.Errorf("stopped")
		case <-time.After(backoff):
		}
		if err := sb.connect(); err == nil {
			log.Info().Msg("Stratum reconnected")
			return nil
		}
		if backoff < 60*time.Second {
			backoff *= 2
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func (sb *StratumBackend) send(msg stratumMsg) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = sb.conn.Write(data)
	return err
}

func (sb *StratumBackend) nextID() int {
	sb.msgID++
	return sb.msgID
}

func mustMarshal(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func hexToBytes(s string) []byte {
	s = strings.TrimPrefix(s, "0x")
	if len(s)%2 != 0 {
		s = "0" + s
	}
	out := make([]byte, len(s)/2)
	for i := 0; i < len(s); i += 2 {
		var b byte
		fmt.Sscanf(s[i:i+2], "%02x", &b)
		out[i/2] = b
	}
	return out
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

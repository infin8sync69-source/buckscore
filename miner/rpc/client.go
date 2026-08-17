// Package rpc implements the SoloBackend: it connects to a local or remote
// Bucks node via Ethereum-compatible JSON-RPC and implements the engine.Backend
// interface for solo mining.
package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bucks-core/miner/engine"
	"github.com/rs/zerolog/log"
)

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

type rpcRequest struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      int           `json:"id"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

// Client is a thin JSON-RPC client for the Bucks node.
type Client struct {
	url    string
	http   *http.Client
	nextID atomic.Int64
}

// NewClient creates a Client targeting the given RPC URL.
func NewClient(url string) *Client {
	return &Client{
		url: url,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Call performs a JSON-RPC call and unmarshals the result into dest.
func (c *Client) Call(ctx context.Context, method string, result interface{}, params ...interface{}) error {
	id := int(c.nextID.Add(1))

	reqBody, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	})
	if err != nil {
		return fmt.Errorf("marshal RPC request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("RPC HTTP: %w", err)
	}
	defer resp.Body.Close()

	var rpcResp rpcResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return fmt.Errorf("decode RPC response: %w", err)
	}

	if rpcResp.Error != nil {
		return fmt.Errorf("RPC error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	if result != nil {
		return json.Unmarshal(rpcResp.Result, result)
	}
	return nil
}

// ---------------------------------------------------------------------------
// SoloBackend — implements engine.Backend via JSON-RPC
// ---------------------------------------------------------------------------

// SoloBackend connects to a Bucks node and drives solo block mining.
type SoloBackend struct {
	client      *Client
	coinbase    string           // miner's reward address
	pollInterval time.Duration

	mu         sync.Mutex
	updateCh   chan struct{}
	lastJobID  string
	stopCh     chan struct{}
}

// NewSoloBackend creates a SoloBackend targeting the given RPC URL.
func NewSoloBackend(rpcURL, coinbase string, pollInterval time.Duration) *SoloBackend {
	sb := &SoloBackend{
		client:       NewClient(rpcURL),
		coinbase:     coinbase,
		pollInterval: pollInterval,
		updateCh:     make(chan struct{}, 1),
		stopCh:       make(chan struct{}),
	}
	go sb.pollLoop()
	return sb
}

// GetWork fetches fresh work from the Bucks node.
// Uses the bucks_getWork RPC method which returns:
//   [0] headHash (hex)   — double-Keccak-256 of the block header bytes
//   [1] seedHash (hex)   — reserved
//   [2] target (hex)     — 256-bit mining target as 64-hex string
//   [3] height (decimal) — block number being mined
func (sb *SoloBackend) GetWork(ctx context.Context) (*engine.Job, error) {
	var result [4]string
	if err := sb.client.Call(ctx, "bucks_getWork", &result); err != nil {
		return nil, fmt.Errorf("bucks_getWork: %w", err)
	}

	// Parse header bytes from the head hash hex.
	headerHex := result[0]
	if len(headerHex) < 2 {
		return nil, fmt.Errorf("invalid headHash from bucks_getWork")
	}
	headerBytes := hexToBytes(headerHex)

	// Parse target.
	targetHex := result[2]
	targetInt := new(big.Int)
	targetInt.SetString(stripHex(targetHex), 16)
	target := engine.TargetToBytes(targetInt)

	// Parse height.
	var height uint64
	fmt.Sscanf(result[3], "%d", &height)

	jobID := result[0] // use headHash as job ID

	sb.mu.Lock()
	sb.lastJobID = jobID
	sb.mu.Unlock()

	log.Debug().
		Str("jobID", jobID[:min(len(jobID), 16)]+"…").
		Uint64("height", height).
		Msg("Got work from node")

	return &engine.Job{
		ID:          jobID,
		HeaderBytes: headerBytes,
		Target:      target,
		Height:      height,
	}, nil
}

// SubmitWork sends a found solution to the node.
// Uses bucks_submitWork: (nonce_hex, header_hash_hex, mix_hash_hex).
func (sb *SoloBackend) SubmitWork(ctx context.Context, result engine.Result) (bool, error) {
	nonceHex := fmt.Sprintf("0x%016x", result.Nonce)
	hashHex  := "0x" + result.Hash.Hex()
	mixHex   := "0x" + "0000000000000000000000000000000000000000000000000000000000000000"

	var accepted bool
	if err := sb.client.Call(ctx, "bucks_submitWork", &accepted,
		nonceHex, hashHex, mixHex,
	); err != nil {
		return false, fmt.Errorf("bucks_submitWork: %w", err)
	}

	log.Info().
		Str("nonce", nonceHex).
		Bool("accepted", accepted).
		Msg("Work submitted")
	return accepted, nil
}

// WorkUpdates returns a channel that receives a notification when new work
// is detected (the node's head block has changed).
func (sb *SoloBackend) WorkUpdates() <-chan struct{} {
	return sb.updateCh
}

// Close stops the poll loop.
func (sb *SoloBackend) Close() error {
	close(sb.stopCh)
	return nil
}

// pollLoop periodically checks whether the node has produced a new block.
// When it does, it signals WorkUpdates() so the miner fetches fresh work.
func (sb *SoloBackend) pollLoop() {
	ticker := time.NewTicker(sb.pollInterval)
	defer ticker.Stop()

	var lastHead string
	for {
		select {
		case <-sb.stopCh:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			var headHex string
			err := sb.client.Call(ctx, "eth_blockNumber", &headHex)
			cancel()

			if err != nil {
				log.Warn().Err(err).Msg("Node poll failed")
				continue
			}
			if headHex != lastHead {
				lastHead = headHex
				select {
				case sb.updateCh <- struct{}{}:
				default:
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func stripHex(s string) string {
	if len(s) >= 2 && s[:2] == "0x" {
		return s[2:]
	}
	return s
}

func hexToBytes(s string) []byte {
	s = stripHex(s)
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

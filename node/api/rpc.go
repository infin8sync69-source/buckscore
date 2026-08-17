// Package api exposes an Ethereum-compatible JSON-RPC interface for the Bucks node.
// Standard eth_*, net_*, and web3_* methods are supported so that MetaMask
// and other EVM tooling can connect without modification.
// Custom bucks_* methods expose chain-specific features.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/bucks-core/node/core/blockchain"
	"github.com/bucks-core/node/core/p2p"
	"github.com/bucks-core/node/core/types"
)

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

// Request is a JSON-RPC 2.0 request object.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

// Response is a JSON-RPC 2.0 response object.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError encodes a JSON-RPC error.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func errResponse(id json.RawMessage, code int, msg string) Response {
	return Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: msg},
	}
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Server is the Bucks JSON-RPC HTTP server.
type Server struct {
	bc      *blockchain.Blockchain
	p2pNode *p2p.Node
	server  *http.Server
}

// NewServer constructs a new RPC server backed by the given blockchain and P2P node.
func NewServer(bc *blockchain.Blockchain, p2pNode *p2p.Node) *Server {
	s := &Server{bc: bc, p2pNode: p2pNode}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRPC)
	mux.HandleFunc("/health", s.handleHealth)

	s.server = &http.Server{
		Handler:      withCORS(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
	return s
}

// Start begins listening on addr (e.g. "127.0.0.1:8192").
func (s *Server) Start(addr string) error {
	s.server.Addr = addr
	fmt.Printf("[rpc] HTTP JSON-RPC listening on http://%s\n", addr)
	return s.server.ListenAndServe()
}

// Stop gracefully shuts down the HTTP server.
func (s *Server) Stop(ctx context.Context) error {
	return s.server.Shutdown(ctx)
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, errResponse(nil, -32700, "parse error"))
		return
	}

	resp := s.dispatch(req)
	writeJSON(w, resp)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"status":"ok","chain":"bucks-mainnet"}`)
}

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

func (s *Server) dispatch(req Request) Response {
	switch req.Method {

	// ---- web3 ----
	case "web3_clientVersion":
		return s.ok(req.ID, "BucksNode/0.1.0/go")

	case "web3_sha3":
		return s.methodWeb3Sha3(req)

	// ---- net ----
	case "net_version":
		return s.ok(req.ID, fmt.Sprintf("%d", types.ChainID))

	case "net_listening":
		return s.ok(req.ID, true)

	case "net_peerCount":
		count := 0
		if s.p2pNode != nil {
			count = s.p2pNode.PeerCount()
		}
		return s.ok(req.ID, hexUint64(uint64(count)))

	// ---- eth ----
	case "eth_chainId":
		return s.ok(req.ID, hexUint64(types.ChainID))

	case "eth_blockNumber":
		head := s.bc.Head()
		return s.ok(req.ID, hexUint64(head.Number()))

	case "eth_getBlockByNumber":
		return s.methodGetBlockByNumber(req)

	case "eth_getBalance":
		return s.methodGetBalance(req)

	case "eth_gasPrice":
		// Base fee: 1 grain (minimal for the scaffold)
		return s.ok(req.ID, hexBig(big.NewInt(1)))

	case "eth_estimateGas":
		// Return a standard Ethereum transfer gas estimate
		return s.ok(req.ID, hexUint64(21_000))

	case "eth_call":
		// EVM call execution — stubbed for Phase 1; full EVM in Phase 2.
		return s.ok(req.ID, "0x")

	case "eth_sendRawTransaction":
		return s.methodSendRawTransaction(req)

	case "eth_getTransactionCount":
		// Nonce stub — returns 0; account state trie wired in Phase 2.
		return s.ok(req.ID, hexUint64(0))

	case "eth_getTransactionByHash":
		return s.ok(req.ID, nil)

	case "eth_getTransactionReceipt":
		return s.ok(req.ID, nil)

	// ---- bucks (custom namespace) ----
	case "bucks_getChainParams":
		return s.methodGetChainParams(req)

	case "bucks_getMithqalBalance":
		// Returns balance formatted as BUCKS (mithqal) float string.
		return s.methodGetMithqalBalance(req)

	case "bucks_getSoulEngineStatus":
		return s.ok(req.ID, map[string]interface{}{
			"connected": false,
			"layers":    114,
			"version":   "soul-engine/0.1.0",
		})

	case "bucks_getWork":
		return s.methodGetWork(req)

	case "bucks_submitWork":
		return s.methodSubmitWork(req)

	default:
		return errResponse(req.ID, -32601, "method not found: "+req.Method)
	}
}

// ---------------------------------------------------------------------------
// Method implementations
// ---------------------------------------------------------------------------

func (s *Server) methodWeb3Sha3(req Request) Response {
	var params []string
	if err := json.Unmarshal(req.Params, &params); err != nil || len(params) == 0 {
		return errResponse(req.ID, -32602, "invalid params")
	}
	// Keccak-256 of the hex-decoded input — stub returns zero hash for now.
	return s.ok(req.ID, "0x"+fmt.Sprintf("%064x", 0))
}

func (s *Server) methodGetBlockByNumber(req Request) Response {
	var params []json.RawMessage
	if err := json.Unmarshal(req.Params, &params); err != nil || len(params) == 0 {
		return errResponse(req.ID, -32602, "invalid params")
	}
	var tag string
	_ = json.Unmarshal(params[0], &tag)

	var block *types.Block
	switch tag {
	case "latest", "":
		block = s.bc.Head()
	default:
		// Parse hex block number.
		var n uint64
		fmt.Sscanf(tag, "0x%x", &n)
		var err error
		block, err = s.bc.BlockByHeight(n)
		if err != nil {
			return s.ok(req.ID, nil)
		}
	}
	return s.ok(req.ID, formatBlock(block))
}

func (s *Server) methodGetBalance(req Request) Response {
	// Account state trie is wired in Phase 2; return 0 for now.
	return s.ok(req.ID, hexBig(big.NewInt(0)))
}

func (s *Server) methodSendRawTransaction(req Request) Response {
	// Full mempool + EVM wired in Phase 2.
	// Return a placeholder tx hash.
	return s.ok(req.ID, "0x"+fmt.Sprintf("%064x", 0))
}

func (s *Server) methodGetChainParams(req Request) Response {
	return s.ok(req.ID, map[string]interface{}{
		"chainId":           types.ChainID,
		"networkName":       "bucks-mainnet",
		"denomination":      "the classical gold standard weight (mithqal)",
		"grainPerBucks":     "1000000000000000000",
		"blockRewardBucks":  "50",
		"halvingInterval":   types.HalvingInterval,
		"maxSupplyBucks":    types.MaxSupplyBucks,
		"targetBlockTimeMs": int64(types.TargetBlockTime.Milliseconds()),
		"seedPhraseStandard": "BIP-8192",
	})
}

func (s *Server) methodGetMithqalBalance(_ Request) Response {
	// Returns BUCKS balance as decimal string (grain / 1e18).
	// Full state lookup in Phase 2.
	return s.ok(nil, "0.000000000000000000")
}

func (s *Server) methodGetWork(req Request) Response {
	head := s.bc.Head()
	target := new(big.Int).Div(
		new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)),
		head.Header.Difficulty,
	)
	return s.ok(req.ID, []string{
		fmt.Sprintf("0x%x", head.Hash()),
		fmt.Sprintf("0x%064x", 0),             // seed hash (DAG variant placeholder)
		fmt.Sprintf("0x%064x", target.Bytes()), // target
	})
}

func (s *Server) methodSubmitWork(req Request) Response {
	// Nonce submission — full validation in Phase 2.
	return s.ok(req.ID, true)
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

func (s *Server) ok(id json.RawMessage, result interface{}) Response {
	return Response{JSONRPC: "2.0", ID: id, Result: result}
}

func hexUint64(n uint64) string { return fmt.Sprintf("0x%x", n) }

func hexBig(n *big.Int) string {
	if n == nil {
		return "0x0"
	}
	return fmt.Sprintf("0x%x", n)
}

func formatBlock(b *types.Block) map[string]interface{} {
	if b == nil {
		return nil
	}
	txCount := 0
	if b.Body != nil {
		txCount = len(b.Body.Transactions)
	}
	return map[string]interface{}{
		"number":           hexUint64(b.Number()),
		"hash":             fmt.Sprintf("0x%x", b.Hash()),
		"parentHash":       fmt.Sprintf("0x%x", b.Header.ParentHash),
		"timestamp":        hexUint64(uint64(b.Header.Timestamp)),
		"difficulty":       hexBig(b.Header.Difficulty),
		"gasLimit":         hexUint64(b.Header.GasLimit),
		"gasUsed":          hexUint64(b.Header.GasUsed),
		"miner":            fmt.Sprintf("0x%x", b.Header.Coinbase),
		"transactionCount": txCount,
		"extraData":        fmt.Sprintf("0x%x", b.Header.ExtraData),
	}
}

// ---------------------------------------------------------------------------
// CORS middleware
// ---------------------------------------------------------------------------

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
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

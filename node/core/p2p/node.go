// Package p2p provides libp2p-based peer discovery and block/transaction
// gossip for the Bucks node.
//
// Architecture:
//   - Kademlia DHT for peer discovery (boot nodes seed the table)
//   - GossipSub pubsub for block and transaction propagation
//   - Direct stream protocol for block sync requests
package p2p

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	libp2p "github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"

	"github.com/bucks-core/node/core/types"
)

// ---------------------------------------------------------------------------
// Protocol IDs
// ---------------------------------------------------------------------------

const (
	// ProtocolBucksHandshake is the initial handshake stream.
	ProtocolBucksHandshake = protocol.ID("/bucks/handshake/1.0.0")

	// ProtocolBlockSync is used to request blocks by height range.
	ProtocolBlockSync = protocol.ID("/bucks/blocksync/1.0.0")

	// TopicBlocks is the GossipSub topic for new block announcements.
	TopicBlocks = "bucks:blocks:v1"

	// TopicTransactions is the GossipSub topic for mempool transactions.
	TopicTransactions = "bucks:transactions:v1"

	// HandshakeTimeout is the maximum time allowed for the handshake.
	HandshakeTimeout = 10 * time.Second

	// MaxPeers is the target maximum number of connected peers.
	MaxPeers = 50
)

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

// Node wraps a libp2p host and manages peer connections, gossip, and
// block synchronisation for the Bucks network.
type Node struct {
	host host.Host
	dht  *dht.IpfsDHT

	config    *Config
	ctx       context.Context
	cancel    context.CancelFunc

	mu    sync.RWMutex
	peers map[peer.ID]*PeerInfo

	// Callbacks — wired up by the blockchain package.
	OnNewBlock       func(block *types.Block)
	OnNewTransaction func(tx *types.Transaction)
}

// PeerInfo holds metadata about a connected peer.
type PeerInfo struct {
	ID        peer.ID
	Addrs     []multiaddr.Multiaddr
	ChainID   uint64
	HeadHash  types.Hash
	HeadHeight uint64
	ConnectedAt time.Time
}

// Config holds P2P configuration.
type Config struct {
	// ListenAddrs are multiaddr strings the node listens on.
	// Defaults: ["/ip4/0.0.0.0/tcp/30300", "/ip6/::/tcp/30300"]
	ListenAddrs []string

	// BootNodes are initial peers used to seed the DHT.
	BootNodes []string

	// MaxPeers is the maximum number of concurrent peer connections.
	MaxPeers int

	// PrivateKeyPath is the path to the Ed25519 node identity key.
	// If empty, a new ephemeral key is generated (not recommended for production).
	PrivateKeyPath string

	// ChainID is this node's chain identifier (must be 8192 for mainnet).
	ChainID uint64
}

// DefaultConfig returns sensible defaults for the P2P layer.
func DefaultConfig() *Config {
	return &Config{
		ListenAddrs: []string{
			"/ip4/0.0.0.0/tcp/30300",
			"/ip6/::/tcp/30300",
		},
		BootNodes:      []string{},
		MaxPeers:       MaxPeers,
		PrivateKeyPath: "",
		ChainID:        types.ChainID,
	}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// NewNode constructs but does not start a P2P node.
func NewNode(cfg *Config) (*Node, error) {
	ctx, cancel := context.WithCancel(context.Background())

	// Build listen multiaddrs.
	var listenMAs []multiaddr.Multiaddr
	for _, addr := range cfg.ListenAddrs {
		ma, err := multiaddr.NewMultiaddr(addr)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("invalid listen addr %q: %w", addr, err)
		}
		listenMAs = append(listenMAs, ma)
	}

	// Create libp2p host.
	h, err := libp2p.New(
		libp2p.ListenAddrs(listenMAs...),
		libp2p.NATPortMap(),
		libp2p.EnableRelay(),
	)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("create libp2p host: %w", err)
	}

	// Create Kademlia DHT in server mode.
	kadDHT, err := dht.New(ctx, h, dht.Mode(dht.ModeServer))
	if err != nil {
		h.Close()
		cancel()
		return nil, fmt.Errorf("create DHT: %w", err)
	}

	node := &Node{
		host:   h,
		dht:    kadDHT,
		config: cfg,
		ctx:    ctx,
		cancel: cancel,
		peers:  make(map[peer.ID]*PeerInfo),
	}

	// Register stream handlers.
	h.SetStreamHandler(ProtocolBucksHandshake, node.handleHandshake)
	h.SetStreamHandler(ProtocolBlockSync, node.handleBlockSync)

	return node, nil
}

// Start bootstraps the DHT and begins peer discovery.
func (n *Node) Start() error {
	// Bootstrap DHT.
	if err := n.dht.Bootstrap(n.ctx); err != nil {
		return fmt.Errorf("DHT bootstrap: %w", err)
	}

	// Connect to boot nodes.
	for _, bnStr := range n.config.BootNodes {
		go n.connectBootNode(bnStr)
	}

	// Peer discovery loop.
	go n.discoverPeers()

	fmt.Printf("[p2p] Node started. PeerID: %s\n", n.host.ID())
	for _, addr := range n.host.Addrs() {
		fmt.Printf("[p2p] Listening on: %s/p2p/%s\n", addr, n.host.ID())
	}

	return nil
}

// Stop gracefully shuts down the P2P node.
func (n *Node) Stop() error {
	n.cancel()
	if err := n.dht.Close(); err != nil {
		return err
	}
	return n.host.Close()
}

// PeerCount returns the number of currently connected peers.
func (n *Node) PeerCount() int {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return len(n.peers)
}

// ---------------------------------------------------------------------------
// Boot node connection
// ---------------------------------------------------------------------------

func (n *Node) connectBootNode(addrStr string) {
	ma, err := multiaddr.NewMultiaddr(addrStr)
	if err != nil {
		fmt.Printf("[p2p] Invalid boot node addr %q: %v\n", addrStr, err)
		return
	}

	ai, err := peer.AddrInfoFromP2pAddr(ma)
	if err != nil {
		fmt.Printf("[p2p] Could not parse boot node addr %q: %v\n", addrStr, err)
		return
	}

	ctx, cancel := context.WithTimeout(n.ctx, 30*time.Second)
	defer cancel()

	if err := n.host.Connect(ctx, *ai); err != nil {
		fmt.Printf("[p2p] Failed to connect to boot node %s: %v\n", ai.ID, err)
		return
	}
	fmt.Printf("[p2p] Connected to boot node: %s\n", ai.ID)
}

// ---------------------------------------------------------------------------
// Peer discovery
// ---------------------------------------------------------------------------

func (n *Node) discoverPeers() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-n.ctx.Done():
			return
		case <-ticker.C:
			// Standalone / bootnode discovery loop
			continue
		}
	}
}

// ---------------------------------------------------------------------------
// Handshake protocol
// ---------------------------------------------------------------------------

// HandshakeMsg is exchanged when two Bucks peers first connect.
type HandshakeMsg struct {
	Version     string     `json:"version"`
	ChainID     uint64     `json:"chainId"`
	HeadHash    types.Hash `json:"headHash"`
	HeadHeight  uint64     `json:"headHeight"`
	UserAgent   string     `json:"userAgent"`
}

func (n *Node) handleHandshake(s network.Stream) {
	defer s.Close()
	s.SetDeadline(time.Now().Add(HandshakeTimeout))

	dec := json.NewDecoder(s)
	var msg HandshakeMsg
	if err := dec.Decode(&msg); err != nil {
		s.Reset()
		return
	}

	// Reject peers on a different chain.
	if msg.ChainID != n.config.ChainID {
		s.Reset()
		return
	}

	// Record peer info.
	n.mu.Lock()
	n.peers[s.Conn().RemotePeer()] = &PeerInfo{
		ID:          s.Conn().RemotePeer(),
		HeadHash:    msg.HeadHash,
		HeadHeight:  msg.HeadHeight,
		ConnectedAt: time.Now(),
	}
	n.mu.Unlock()

	// Send our own handshake back.
	enc := json.NewEncoder(s)
	_ = enc.Encode(HandshakeMsg{
		Version:   "bucks/1.0.0",
		ChainID:   n.config.ChainID,
		UserAgent: "BucksNode/0.1.0",
	})
}

// ---------------------------------------------------------------------------
// Block sync protocol
// ---------------------------------------------------------------------------

// BlockSyncRequest asks a peer for blocks in [FromHeight, ToHeight].
type BlockSyncRequest struct {
	FromHeight uint64 `json:"from"`
	ToHeight   uint64 `json:"to"`
}

func (n *Node) handleBlockSync(s network.Stream) {
	defer s.Close()

	dec := json.NewDecoder(s)
	var req BlockSyncRequest
	if err := dec.Decode(&req); err != nil {
		s.Reset()
		return
	}

	// TODO (Phase 1 followup): serve blocks from the blockchain store.
	// For now, send an empty response to acknowledge the request.
	enc := json.NewEncoder(s)
	_ = enc.Encode([]*types.Block{})
}

// ---------------------------------------------------------------------------
// Gossip — broadcast helpers
// ---------------------------------------------------------------------------

// BroadcastBlock serialises a block and sends it to all connected peers
// via the block sync protocol.
// Full GossipSub integration is wired in Phase 2.
func (n *Node) BroadcastBlock(block *types.Block) {
	data, err := json.Marshal(block)
	if err != nil {
		return
	}

	n.mu.RLock()
	peers := make([]peer.ID, 0, len(n.peers))
	for id := range n.peers {
		peers = append(peers, id)
	}
	n.mu.RUnlock()

	for _, pid := range peers {
		go func(id peer.ID) {
			ctx, cancel := context.WithTimeout(n.ctx, 5*time.Second)
			defer cancel()
			s, err := n.host.NewStream(ctx, id, ProtocolBlockSync)
			if err != nil {
				return
			}
			defer s.Close()
			_, _ = s.Write(data)
		}(pid)
	}
}

// BroadcastTransaction sends a signed transaction to all connected peers.
func (n *Node) BroadcastTransaction(tx *types.Transaction) {
	data, err := json.Marshal(tx)
	if err != nil {
		return
	}
	_ = data
	// Full pubsub broadcast wired in Phase 2.
}

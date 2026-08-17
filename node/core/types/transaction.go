// Package types — Transaction and Receipt definitions for the Bucks Blockchain.
package types

import (
	"math/big"
)

// ---------------------------------------------------------------------------
// Transaction types (EVM-compatible)
// ---------------------------------------------------------------------------

const (
	TxTypeLegacy     = 0x00 // Pre-EIP-2718 legacy transaction
	TxTypeAccessList = 0x01 // EIP-2930
	TxTypeDynamicFee = 0x02 // EIP-1559
)

// Transaction represents a signed Bucks network transaction.
// Fields mirror the Ethereum transaction model for EVM compatibility.
type Transaction struct {
	// Type determines how the transaction is interpreted and signed.
	Type uint8 `json:"type"`

	// Nonce prevents replay attacks; must equal sender's current nonce.
	Nonce uint64 `json:"nonce"`

	// GasPrice is the fee per gas unit (legacy) in grain.
	GasPrice *big.Int `json:"gasPrice,omitempty"`

	// Gas is the maximum gas units the sender is willing to consume.
	Gas uint64 `json:"gas"`

	// To is the recipient address; nil for contract-creation transactions.
	To *Address `json:"to"`

	// Value is the amount of grain (BUCKS × 10⁻¹⁸) transferred.
	Value *big.Int `json:"value"`

	// Data is arbitrary input data (ABI-encoded call for smart contracts).
	Data []byte `json:"input"`

	// Signature fields (secp256k1 ECDSA, Ethereum-style)
	V *big.Int `json:"v"`
	R *big.Int `json:"r"`
	S *big.Int `json:"s"`

	// EIP-1559 fields (TxTypeDynamicFee only)
	MaxFeePerGas         *big.Int `json:"maxFeePerGas,omitempty"`
	MaxPriorityFeePerGas *big.Int `json:"maxPriorityFeePerGas,omitempty"`

	// ChainID is embedded in the signature per EIP-155.
	ChainID *big.Int `json:"chainId,omitempty"`

	// cached hash
	hash Hash
	from Address
}

// Hash returns the Keccak-256 hash of the RLP-encoded transaction.
func (tx *Transaction) Hash() Hash { return tx.hash }

// From returns the recovered sender address (set during signature verification).
func (tx *Transaction) From() Address { return tx.from }

// IsContractCreation returns true if this transaction deploys a new contract.
func (tx *Transaction) IsContractCreation() bool { return tx.To == nil }

// Cost returns the maximum grain this transaction can consume (Value + Gas*GasPrice).
func (tx *Transaction) Cost() *big.Int {
	gp := tx.GasPrice
	if gp == nil {
		gp = tx.MaxFeePerGas
	}
	if gp == nil {
		gp = big.NewInt(0)
	}
	gasCost := new(big.Int).Mul(new(big.Int).SetUint64(tx.Gas), gp)
	total := new(big.Int).Add(tx.Value, gasCost)
	return total
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

// Status codes for transaction receipts.
const (
	ReceiptStatusFailed  = uint64(0)
	ReceiptStatusSuccess = uint64(1)
)

// Receipt is the result of executing a transaction on the EVM.
type Receipt struct {
	// Status is 1 for success, 0 for revert/failure.
	Status uint64 `json:"status"`

	// CumulativeGasUsed is total gas used in the block up to and including this tx.
	CumulativeGasUsed uint64 `json:"cumulativeGasUsed"`

	// Bloom is the 256-byte Bloom filter for the logs emitted by this tx.
	Bloom []byte `json:"logsBloom"`

	// Logs are the EVM events emitted during execution.
	Logs []*Log `json:"logs"`

	// TxHash identifies the transaction this receipt belongs to.
	TxHash Hash `json:"transactionHash"`

	// ContractAddress is populated when the transaction created a new contract.
	ContractAddress *Address `json:"contractAddress,omitempty"`

	// GasUsed is the gas consumed by this transaction alone.
	GasUsed uint64 `json:"gasUsed"`

	// BlockHash is the hash of the block containing this transaction.
	BlockHash Hash `json:"blockHash"`

	// BlockNumber is the height of the block containing this transaction.
	BlockNumber uint64 `json:"blockNumber"`

	// TransactionIndex is the position of this transaction within the block.
	TransactionIndex uint `json:"transactionIndex"`
}

// ---------------------------------------------------------------------------
// Log (EVM event)
// ---------------------------------------------------------------------------

// Log represents an EVM event emitted by a smart contract.
type Log struct {
	// Address of the contract that emitted the event.
	Address Address `json:"address"`

	// Topics are the indexed event parameters (first topic = event signature hash).
	Topics []Hash `json:"topics"`

	// Data holds the non-indexed event parameters (ABI-encoded).
	Data []byte `json:"data"`

	// Position in the chain
	BlockNumber uint64 `json:"blockNumber"`
	TxHash      Hash   `json:"transactionHash"`
	TxIndex     uint   `json:"transactionIndex"`
	BlockHash   Hash   `json:"blockHash"`
	Index       uint   `json:"logIndex"`
	Removed     bool   `json:"removed"` // true if the log was reverted
}

// ---------------------------------------------------------------------------
// Transaction pool helpers
// ---------------------------------------------------------------------------

// Transactions is a sortable slice of Transaction pointers.
type Transactions []*Transaction

func (t Transactions) Len() int      { return len(t) }
func (t Transactions) Swap(i, j int) { t[i], t[j] = t[j], t[i] }

// LessByNonce orders transactions by nonce ascending (useful for execution ordering).
func (t Transactions) LessByNonce(i, j int) bool {
	return t[i].Nonce < t[j].Nonce
}

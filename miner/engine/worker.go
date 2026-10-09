// worker.go — per-CPU-core nonce search goroutine.
//
// Each worker receives a Job and searches an exclusive slice of the nonce space.
// The nonce space is partitioned by stride: worker i starts at i and increments
// by totalWorkers, ensuring no two workers duplicate work.
//
// When a valid nonce is found, it is sent to the results channel and the worker
// exits. If the abort channel is closed, the worker exits immediately.
package engine

import (
	"sync/atomic"
)

// ---------------------------------------------------------------------------
// Job & Result
// ---------------------------------------------------------------------------

// Job describes the work a worker must perform.
type Job struct {
	// ID is the job identifier (from the node or pool); used to detect stale jobs.
	ID string

	// HeaderBytes is the serialised block header (without nonce) to mine on.
	HeaderBytes []byte

	// Target is the 32-byte big-endian mining target.
	// A hash is valid when hash < Target.
	Target [32]byte

	// Height is the block number being mined (for display purposes).
	Height uint64
}

// Result carries a winning nonce and its hash back to the coordinator.
type Result struct {
	JobID  string
	Nonce  uint64
	Hash   Hash32
	Worker int
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

// Worker is a single CPU-thread mining goroutine.
type Worker struct {
	id           int
	totalWorkers int

	// hashCounter is updated atomically by the hot loop and read by stats.
	hashCounter atomic.Int64

	// abortFlag is set to 1 by the coordinator to signal the worker to stop
	// without closing a channel (allows fast abort without channel overhead).
	abortFlag atomic.Int32
}

// NewWorker creates a Worker with the given id out of totalWorkers.
func NewWorker(id, totalWorkers int) *Worker {
	return &Worker{id: id, totalWorkers: totalWorkers}
}

// DrainHashCount atomically retrieves and resets the worker's hash counter.
// Called by the stats collector on each 1-second tick.
func (w *Worker) DrainHashCount() int64 {
	return w.hashCounter.Swap(0)
}

// Abort signals this worker to stop searching.
func (w *Worker) Abort() {
	w.abortFlag.Store(1)
}

// Run executes the nonce search loop.
//
// Parameters:
//   - job:     The current mining job.
//   - results: Channel to send the winning Result to (buffered, capacity 1).
//   - abort:   Channel closed by coordinator to abort all workers at once.
//
// The worker starts its nonce at w.id and increments by w.totalWorkers on each
// iteration, ensuring each nonce is searched by exactly one worker.
func (w *Worker) Run(job *Job, results chan<- Result, abort <-chan struct{}) {
	w.abortFlag.Store(0)

	nonce    := uint64(w.id)
	stride   := uint64(w.totalWorkers)
	target   := job.Target
	header   := job.HeaderBytes
	jobID    := job.ID

	// Pre-allocate the seal input buffer once and reuse it for every hash
	// attempt below — SealHashInto only overwrites the trailing nonce bytes,
	// so this loop no longer allocates per hash (see hasher.go).
	headerLen := len(header)
	buf := make([]byte, headerLen+8)
	copy(buf, header)

	const batchSize = 1024 // check abort / abortFlag every batchSize hashes

	for {
		for i := 0; i < batchSize; i++ {
			hash := SealHashInto(buf, headerLen, nonce)
			w.hashCounter.Add(1)

			if HashMeetsTarget(hash, target) {
				// Non-blocking send — first worker to find a solution wins.
				select {
				case results <- Result{
					JobID:  jobID,
					Nonce:  nonce,
					Hash:   hash,
					Worker: w.id,
				}:
				default:
				}
				return
			}

			nonce += stride
		}

		// Check abort signals every batch.
		if w.abortFlag.Load() != 0 {
			return
		}
		select {
		case <-abort:
			return
		default:
		}
	}
}

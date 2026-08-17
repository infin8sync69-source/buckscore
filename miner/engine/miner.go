// miner.go — work coordinator: fetches jobs, dispatches workers, submits results.
//
// The Miner drives the full mining loop:
//
//  1. Fetch work from the node (solo) or pool (Stratum v2).
//  2. Distribute the job across N worker goroutines.
//  3. When a worker finds a valid nonce, abort the rest and submit.
//  4. Repeat immediately with fresh work.
//
// Two modes are supported via the Backend interface:
//   - SoloBackend:  polls bucks_getWork / bucks_submitWork on the Bucks node.
//   - StratumBackend: connects to a Stratum v2 pool via TCP.
package engine

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/bucks-core/miner/stats"
	"github.com/rs/zerolog/log"
)

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

// Backend abstracts the work source and submission target.
// Two concrete implementations exist: SoloBackend (rpc/) and StratumBackend (stratum/).
type Backend interface {
	// GetWork fetches the current job to mine on.
	// Returns the job and the block height, or an error.
	GetWork(ctx context.Context) (*Job, error)

	// SubmitWork sends a found solution to the node or pool.
	// Returns true if the solution was accepted.
	SubmitWork(ctx context.Context, result Result) (bool, error)

	// WorkUpdates returns a channel that is closed/sent on when the backend
	// has fresh work available (e.g. a new block arrived on the node, or
	// the pool sent a mining.notify).
	WorkUpdates() <-chan struct{}

	// Close shuts down the backend connection.
	Close() error
}

// ---------------------------------------------------------------------------
// Miner
// ---------------------------------------------------------------------------

// Miner coordinates workers and interacts with the backend.
type Miner struct {
	backend     Backend
	collector   *stats.Collector
	numWorkers  int
	pollInterval time.Duration

	mu      sync.Mutex
	running bool
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// New creates a Miner with the given backend, stats collector, and thread count.
// threads = 0 defaults to runtime.NumCPU().
func New(backend Backend, collector *stats.Collector, threads int) *Miner {
	if threads <= 0 {
		threads = runtime.NumCPU()
	}
	return &Miner{
		backend:      backend,
		collector:    collector,
		numWorkers:   threads,
		pollInterval: 2 * time.Second,
	}
}

// SetPollInterval overrides the work-poll interval (solo mode only).
func (m *Miner) SetPollInterval(d time.Duration) {
	m.pollInterval = d
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

// Start begins the mining loop. Safe to call only once; call Stop first to restart.
func (m *Miner) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running {
		return fmt.Errorf("miner is already running")
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.cancel  = cancel
	m.running = true

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		m.loop(ctx)
	}()

	log.Info().
		Int("threads", m.numWorkers).
		Msg("Miner started")
	return nil
}

// Stop halts all worker goroutines and waits for them to finish.
func (m *Miner) Stop() {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	m.cancel()
	m.running = false
	m.mu.Unlock()

	m.wg.Wait()
	log.Info().Msg("Miner stopped")
}

// IsRunning reports whether the miner is currently active.
func (m *Miner) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// ---------------------------------------------------------------------------
// Main mining loop
// ---------------------------------------------------------------------------

func (m *Miner) loop(ctx context.Context) {
	var currentJob *Job
	workerAbort := make(chan struct{})
	results     := make(chan Result, 1)

	workers := make([]*Worker, m.numWorkers)
	for i := range workers {
		workers[i] = NewWorker(i, m.numWorkers)
	}

	// Stats drain: collect per-worker hash counts into the stats collector.
	drainTicker := time.NewTicker(time.Second)
	defer drainTicker.Stop()

	startWorkers := func(job *Job) {
		// Signal all workers to abort before starting new ones.
		select {
		case <-workerAbort:
			// Already closed — re-create.
		default:
			close(workerAbort)
		}
		workerAbort = make(chan struct{})
		// Drain stale results.
		select { case <-results: default: }

		for _, w := range workers {
			w.Abort()
		}

		currentJob = job
		for _, w := range workers {
			go w.Run(job, results, workerAbort)
		}
		log.Info().
			Uint64("height", job.Height).
			Str("jobID", job.ID).
			Int("threads", m.numWorkers).
			Msg("New job dispatched")
	}

	// Fetch initial job.
	job, err := m.fetchJobWithRetry(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch initial work")
		return
	}
	startWorkers(job)

	workUpdateCh := m.backend.WorkUpdates()
	pollTimer    := time.NewTimer(m.pollInterval)
	defer pollTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			close(workerAbort)
			return

		case <-drainTicker.C:
			// Accumulate hash counts into the stats collector.
			for i, w := range workers {
				m.collector.AddHashes(i, int(w.DrainHashCount()))
			}

		case <-workUpdateCh:
			// New block arrived — interrupt workers immediately.
			newJob, err := m.fetchJobWithRetry(ctx)
			if err == nil {
				startWorkers(newJob)
			}
			pollTimer.Reset(m.pollInterval)

		case <-pollTimer.C:
			// Periodic poll for new work (solo mode).
			newJob, err := m.backend.GetWork(ctx)
			if err != nil {
				log.Warn().Err(err).Msg("getWork failed — retrying")
				pollTimer.Reset(m.pollInterval)
				continue
			}
			if currentJob == nil || newJob.ID != currentJob.ID {
				startWorkers(newJob)
			}
			pollTimer.Reset(m.pollInterval)

		case res := <-results:
			// A worker found a valid nonce!
			if currentJob == nil || res.JobID != currentJob.ID {
				log.Warn().Msg("Stale result — discarding")
				continue
			}

			log.Info().
				Uint64("nonce", res.Nonce).
				Str("hash", res.Hash.Hex()).
				Int("worker", res.Worker).
				Msg("Solution found — submitting")

			accepted, submitErr := m.backend.SubmitWork(ctx, res)
			if submitErr != nil {
				log.Error().Err(submitErr).Msg("submitWork RPC failed")
			}
			m.collector.RecordShare(accepted)

			if accepted {
				m.collector.RecordBlock(int64(currentJob.Height), "0x"+res.Hash.Hex())
				log.Info().
					Uint64("height", currentJob.Height).
					Msg("Block accepted!")
			} else {
				log.Warn().Msg("Block rejected by node")
			}

			// Fetch new work immediately.
			newJob, err := m.fetchJobWithRetry(ctx)
			if err == nil {
				startWorkers(newJob)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func (m *Miner) fetchJobWithRetry(ctx context.Context) (*Job, error) {
	backoff := 500 * time.Millisecond
	for {
		job, err := m.backend.GetWork(ctx)
		if err == nil {
			return job, nil
		}
		log.Warn().Err(err).Dur("retry", backoff).Msg("getWork failed")
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}
}

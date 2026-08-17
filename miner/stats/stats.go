// Package stats tracks real-time and historical mining performance metrics.
//
// Hashrate is computed using an exponential moving average (EMA) over a
// configurable window, with a 1-second resolution ticker.
package stats

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const (
	// emaAlpha controls the smoothing factor for the exponential moving average.
	// Lower = smoother; higher = more reactive to bursts.
	emaAlpha = 0.15

	// historyLen is the number of 1-second samples kept for the dashboard chart.
	historyLen = 120 // 2 minutes of rolling history

	// reportInterval is how often the collector updates per-worker EMAs.
	reportInterval = time.Second
)

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

// Collector gathers per-worker hash counts and derives aggregate statistics.
type Collector struct {
	mu sync.RWMutex

	startTime time.Time
	stopCh    chan struct{}

	// Atomic per-worker hash counters (indexed by worker ID).
	// Swapped to zero each tick to get per-interval delta.
	workerHashes []atomic.Int64

	// EMA-smoothed hashrate (hashes/sec) per worker.
	workerRate []float64

	// Aggregate EMA hashrate (sum of all worker EMAs).
	totalRate float64

	// Rolling history for the dashboard chart.
	history []float64

	// Share / block accounting.
	sharesAccepted atomic.Int64
	sharesRejected atomic.Int64
	blocksFound    atomic.Int64

	// Current job info (updated on each getWork / mining.notify).
	currentHeight atomic.Int64
	currentHash   atomic.Value // stores string
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// New creates a Collector for nWorkers worker goroutines and starts
// the background EMA-update ticker.
func New(nWorkers int) *Collector {
	c := &Collector{
		workerHashes: make([]atomic.Int64, nWorkers),
		workerRate:   make([]float64, nWorkers),
		history:      make([]float64, 0, historyLen),
		stopCh:       make(chan struct{}),
		startTime:    time.Now(),
	}
	c.currentHash.Store("")
	go c.tick()
	return c
}

// Stop halts the background collection goroutine.
func (c *Collector) Stop() {
	select {
	case <-c.stopCh:
	default:
		close(c.stopCh)
	}
}

// ---------------------------------------------------------------------------
// Instrumentation — called by worker goroutines (hot path)
// ---------------------------------------------------------------------------

// AddHashes increments the hash counter for the given worker id by n.
func (c *Collector) AddHashes(id, n int) {
	if id >= 0 && id < len(c.workerHashes) {
		c.workerHashes[id].Add(int64(n))
	}
}

// RecordShare records a submitted share result.
func (c *Collector) RecordShare(accepted bool) {
	if accepted {
		c.sharesAccepted.Add(1)
	} else {
		c.sharesRejected.Add(1)
	}
}

// RecordBlock records a found block (solo mode).
func (c *Collector) RecordBlock(height int64, hash string) {
	c.blocksFound.Add(1)
	c.currentHeight.Store(height)
	c.currentHash.Store(hash)
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

// WorkerStat holds per-goroutine performance data.
type WorkerStat struct {
	ID       int     `json:"id"`
	Hashrate float64 `json:"hashrate"` // hashes/sec (EMA)
}

// Snapshot is a point-in-time view of all mining statistics.
type Snapshot struct {
	Running        bool         `json:"running"`
	Uptime         int64        `json:"uptime"`         // seconds since start
	Hashrate       float64      `json:"hashrate"`       // aggregate EMA (hashes/sec)
	AvgHashrate    float64      `json:"avgHashrate"`    // mean over rolling history
	SharesAccepted int64        `json:"sharesAccepted"`
	SharesRejected int64        `json:"sharesRejected"`
	BlocksFound    int64        `json:"blocksFound"`
	Workers        []WorkerStat `json:"workers"`
	History        []float64    `json:"history"`        // last historyLen seconds
	CurrentHeight  int64        `json:"currentHeight"`
	CurrentHash    string       `json:"currentHash"`
}

// Snap returns a consistent copy of the current statistics.
func (c *Collector) Snap(running bool) Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	workers := make([]WorkerStat, len(c.workerRate))
	for i, r := range c.workerRate {
		workers[i] = WorkerStat{ID: i, Hashrate: r}
	}

	historyCopy := make([]float64, len(c.history))
	copy(historyCopy, c.history)

	var avg float64
	if len(c.history) > 0 {
		for _, v := range c.history {
			avg += v
		}
		avg /= float64(len(c.history))
	}

	return Snapshot{
		Running:        running,
		Uptime:         int64(time.Since(c.startTime).Seconds()),
		Hashrate:       c.totalRate,
		AvgHashrate:    avg,
		SharesAccepted: c.sharesAccepted.Load(),
		SharesRejected: c.sharesRejected.Load(),
		BlocksFound:    c.blocksFound.Load(),
		Workers:        workers,
		History:        historyCopy,
		CurrentHeight:  c.currentHeight.Load(),
		CurrentHash:    c.currentHash.Load().(string),
	}
}

// ---------------------------------------------------------------------------
// Background tick
// ---------------------------------------------------------------------------

func (c *Collector) tick() {
	ticker := time.NewTicker(reportInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.mu.Lock()
			var total float64
			for i := range c.workerHashes {
				// Atomically grab and reset the counter for this interval.
				delta := float64(c.workerHashes[i].Swap(0))
				// EMA update.
				c.workerRate[i] = emaAlpha*delta + (1-emaAlpha)*c.workerRate[i]
				total += c.workerRate[i]
			}
			c.totalRate = total

			// Append to ring buffer.
			if len(c.history) >= historyLen {
				c.history = c.history[1:]
			}
			c.history = append(c.history, math.Round(total))
			c.mu.Unlock()
		}
	}
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// FormatHashrate returns a human-readable hashrate string.
func FormatHashrate(hps float64) string {
	switch {
	case hps >= 1e9:
		return fmt.Sprintf("%.2f GH/s", hps/1e9)
	case hps >= 1e6:
		return fmt.Sprintf("%.2f MH/s", hps/1e6)
	case hps >= 1e3:
		return fmt.Sprintf("%.2f KH/s", hps/1e3)
	default:
		return fmt.Sprintf("%.0f H/s", hps)
	}
}

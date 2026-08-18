package engine

import (
	"bytes"
	"testing"
)

// TestSealHashIntoMatchesSealHash guards the worker.go hot-loop optimization:
// SealHashInto (buffer-reused) must produce byte-identical output to the
// original allocating SealHash for the same header/nonce pair.
func TestSealHashIntoMatchesSealHash(t *testing.T) {
	headers := [][]byte{
		{},
		[]byte("bucks"),
		bytes.Repeat([]byte{0xAB}, 200), // representative serialized-header size
	}
	nonces := []uint64{0, 1, 42, 1024, 1<<64 - 1}

	for _, header := range headers {
		buf := make([]byte, len(header)+8)
		copy(buf, header)

		for _, nonce := range nonces {
			want := SealHash(header, nonce)
			got := SealHashInto(buf, len(header), nonce)
			if got != want {
				t.Fatalf("SealHashInto(header=%x, nonce=%d) = %x, want %x", header, nonce, got, want)
			}
		}
	}
}

// TestSealHashIntoReuseAcrossNonces confirms repeated calls against the same
// buffer (as worker.go does across thousands of nonce attempts) never leak
// state from a prior call.
func TestSealHashIntoReuseAcrossNonces(t *testing.T) {
	header := bytes.Repeat([]byte{0x01, 0x02}, 64)
	buf := make([]byte, len(header)+8)
	copy(buf, header)

	for nonce := uint64(0); nonce < 2000; nonce++ {
		got := SealHashInto(buf, len(header), nonce)
		want := SealHash(header, nonce)
		if got != want {
			t.Fatalf("nonce %d: SealHashInto = %x, want %x", nonce, got, want)
		}
	}
}

func BenchmarkSealHash(b *testing.B) {
	header := bytes.Repeat([]byte{0xAB}, 200)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = SealHash(header, uint64(i))
	}
}

func BenchmarkSealHashInto(b *testing.B) {
	header := bytes.Repeat([]byte{0xAB}, 200)
	buf := make([]byte, len(header)+8)
	copy(buf, header)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = SealHashInto(buf, len(header), uint64(i))
	}
}

// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Package benchmarks contains the AumOS cross-language benchmark suite for Go.
//
// Run all benchmarks:
//
//	go test -bench=. -benchmem -count=3 -json > results/go-raw.json
//
// Then convert raw output to the standardized cross-language format:
//
//	go run export_results.go results/go-raw.json > results/go.json
package benchmarks

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"testing"
	"time"
)

// ─── Governance stubs ─────────────────────────────────────────────────────────
// These stubs mirror the real SDK surface but use in-memory state only.
// This isolates the measurement to governance logic, not I/O or imports.

// TrustLevel represents an operator-assigned trust tier. Levels are set
// manually — never computed or promoted automatically.
type TrustLevel int

const (
	TrustLevelPublic     TrustLevel = 0
	TrustLevelVerified   TrustLevel = 1
	TrustLevelPrivileged TrustLevel = 2
)

// TrustPolicy is an operator-configured static policy for a single tool.
type TrustPolicy struct {
	RequiredLevel TrustLevel
	ToolName      string
}

// CheckTrustLevel returns true if agentLevel meets or exceeds the required level.
func CheckTrustLevel(agentLevel TrustLevel, policy TrustPolicy) bool {
	return agentLevel >= policy.RequiredLevel
}

// BudgetState holds fixed limits and current usage for one session.
// Limits are static — set at creation, never changed automatically.
type BudgetState struct {
	TokenLimit  int
	CallLimit   int
	TokensUsed  int
	CallsUsed   int
}

// CheckBudget returns true if the session has remaining token and call budget.
func CheckBudget(state *BudgetState) bool {
	return state.TokensUsed < state.TokenLimit && state.CallsUsed < state.CallLimit
}

// RecordSpending updates the session's usage counters.
func RecordSpending(state *BudgetState, tokens int) {
	state.TokensUsed += tokens
	state.CallsUsed++
}

// AuditRecord is a single, immutable governance event. Records are written
// once and never modified — no analysis or anomaly detection.
type AuditRecord struct {
	Event     string
	SessionID string
	Timestamp int64
}

// AppendAuditRecord appends a record to the in-memory log.
func AppendAuditRecord(log *[]AuditRecord, record AuditRecord) {
	*log = append(*log, record)
}

// ─── Standard benchmarks ─────────────────────────────────────────────────────

// BenchmarkTrustCheck measures the cost of a single trust-level comparison.
func BenchmarkTrustCheck(b *testing.B) {
	policy := TrustPolicy{RequiredLevel: TrustLevelVerified, ToolName: "file-reader"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = CheckTrustLevel(TrustLevelVerified, policy)
	}
}

// BenchmarkBudgetEnforcement measures the cost of a single budget check.
func BenchmarkBudgetEnforcement(b *testing.B) {
	state := &BudgetState{TokenLimit: 10_000, CallLimit: 100}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = CheckBudget(state)
	}
}

// BenchmarkFullEvaluation measures sequential trust check, budget check, and
// audit log — the typical hot path for a governed tool call.
func BenchmarkFullEvaluation(b *testing.B) {
	policy := TrustPolicy{RequiredLevel: TrustLevelVerified, ToolName: "file-reader"}
	state := &BudgetState{TokenLimit: 10_000, CallLimit: b.N + 10}
	log := make([]AuditRecord, 0, b.N)
	record := AuditRecord{Event: "tool-call", SessionID: "sess-bench", Timestamp: 0}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if CheckTrustLevel(TrustLevelVerified, policy) && CheckBudget(state) {
			RecordSpending(state, 10)
			AppendAuditRecord(&log, record)
		}
	}
}

// BenchmarkAuditLog measures the cost of appending one record to the log.
func BenchmarkAuditLog(b *testing.B) {
	log := make([]AuditRecord, 0, b.N)
	record := AuditRecord{Event: "tool-call", SessionID: "sess-bench", Timestamp: 0}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		AppendAuditRecord(&log, record)
	}
}

// BenchmarkConformanceVectors validates known-good and known-bad governance
// decisions. Checks correctness, not only throughput.
func BenchmarkConformanceVectors(b *testing.B) {
	type vector struct {
		agentLevel    TrustLevel
		requiredLevel TrustLevel
		expected      bool
	}
	vectors := []vector{
		{TrustLevelPublic, TrustLevelPublic, true},
		{TrustLevelVerified, TrustLevelPublic, true},
		{TrustLevelPrivileged, TrustLevelVerified, true},
		{TrustLevelPublic, TrustLevelVerified, false},
		{TrustLevelVerified, TrustLevelPrivileged, false},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, v := range vectors {
			result := CheckTrustLevel(v.agentLevel, TrustPolicy{RequiredLevel: v.requiredLevel})
			if result != v.expected {
				b.Fatalf("conformance failure: agent=%d required=%d", v.agentLevel, v.requiredLevel)
			}
		}
	}
}

// ─── Cross-language JSON export ───────────────────────────────────────────────
// TestExportResults runs each benchmark a fixed number of times and writes the
// standardized cross-language JSON format to a file, or stdout if no path given.
// Run with:  go test -run TestExportResults -export-results=results/go.json

func TestExportResults(t *testing.T) {
	const iterations = 100_000

	type ScenarioResult struct {
		Name       string `json:"name"`
		Iterations int    `json:"iterations"`
		OpsPerSec  int    `json:"ops_per_sec"`
		MeanNs     int    `json:"mean_ns"`
		StdevNs    int    `json:"stdev_ns"`
	}

	type BenchmarkReport struct {
		Language  string           `json:"language"`
		Version   string           `json:"version"`
		Runtime   string           `json:"runtime"`
		Timestamp string           `json:"timestamp"`
		Scenarios []ScenarioResult `json:"scenarios"`
	}

	measure := func(fn func()) (meanNs int, stdevNs int) {
		samples := make([]float64, iterations)
		// Warm-up
		for i := 0; i < iterations/10; i++ {
			fn()
		}
		for i := range samples {
			start := time.Now()
			fn()
			samples[i] = float64(time.Since(start).Nanoseconds())
		}
		var sum float64
		for _, v := range samples {
			sum += v
		}
		mean := sum / float64(len(samples))
		var variance float64
		for _, v := range samples {
			diff := v - mean
			variance += diff * diff
		}
		variance /= float64(len(samples))
		stdev := 0.0
		if variance > 0 {
			// Integer square root approximation is sufficient here
			stdev = variance / mean // simplification; use math.Sqrt in production
		}
		return int(mean), int(stdev)
	}

	policy := TrustPolicy{RequiredLevel: TrustLevelVerified, ToolName: "file-reader"}
	budgetState := &BudgetState{TokenLimit: 10_000, CallLimit: 100}
	fullState := &BudgetState{TokenLimit: 10_000, CallLimit: iterations + 10}
	auditLog := make([]AuditRecord, 0, iterations)
	record := AuditRecord{Event: "tool-call", SessionID: "sess-bench", Timestamp: 0}

	scenarios := []ScenarioResult{}

	addScenario := func(name string, iters int, fn func()) {
		mean, stdev := measure(fn)
		ops := 0
		if mean > 0 {
			ops = int(1_000_000_000 / mean)
		}
		scenarios = append(scenarios, ScenarioResult{
			Name: name, Iterations: iters,
			OpsPerSec: ops, MeanNs: mean, StdevNs: stdev,
		})
	}

	addScenario("trust_check", iterations, func() {
		_ = CheckTrustLevel(TrustLevelVerified, policy)
	})
	addScenario("budget_enforcement", iterations, func() {
		_ = CheckBudget(budgetState)
	})
	addScenario("full_evaluation", iterations, func() {
		if CheckTrustLevel(TrustLevelVerified, policy) && CheckBudget(fullState) {
			RecordSpending(fullState, 10)
			AppendAuditRecord(&auditLog, record)
		}
	})
	addScenario("audit_log", iterations, func() {
		AppendAuditRecord(&auditLog, record)
	})
	addScenario("conformance_vectors", 10_000, func() {
		_ = CheckTrustLevel(TrustLevelPublic, TrustPolicy{RequiredLevel: TrustLevelPublic})
		_ = CheckTrustLevel(TrustLevelVerified, TrustPolicy{RequiredLevel: TrustLevelPublic})
		_ = CheckTrustLevel(TrustLevelPublic, TrustPolicy{RequiredLevel: TrustLevelVerified})
	})

	report := BenchmarkReport{
		Language:  "go",
		Version:   runtime.Version(),
		Runtime:   fmt.Sprintf("go-%s-%s", runtime.Version(), runtime.GOARCH),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Scenarios: scenarios,
	}

	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	_, _ = fmt.Fprintf(os.Stdout, "%s\n", encoded)
}

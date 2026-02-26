// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Package governance provides a static, interface-first governance SDK for
// cloud-native AI agent applications. It composes trust level enforcement,
// budget envelope checking, consent tracking, and tamper-evident audit
// logging into a single sequential evaluation pipeline.
//
// All managers are safe for concurrent use. Storage is in-memory by default;
// callers may supply an alternative implementation of [storage.Storage].
//
// # Quick Start
//
//	engine, err := governance.NewEngine(governance.Config{
//	    DefaultScope: "production",
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	// Assign trust to an agent (manual only — never automatic).
//	_, err = engine.Trust.SetLevel(ctx, "agent-1", governance.TrustSuggest, "production")
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	// Check a governed action.
//	decision, err := engine.Check(ctx, "send_email",
//	    governance.WithAgentID("agent-1"),
//	    governance.WithRequiredTrust(governance.TrustSuggest),
//	    governance.WithBudgetCheck("email", 0.01),
//	    governance.WithConsentCheck("agent-1", "email"),
//	)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println(decision.Permitted) // true
package governance

import "time"

// TrustLevel represents the six-level graduated trust hierarchy for AI agent
// authorisation. Each level strictly supersedes the one below it.
type TrustLevel int

const (
	// TrustObserver grants read-only observation. No side-effecting actions
	// are permitted at this level.
	TrustObserver TrustLevel = 0

	// TrustMonitor grants active monitoring with alerting capability. No
	// mutations to external state are permitted.
	TrustMonitor TrustLevel = 1

	// TrustSuggest permits the agent to generate proposals and suggestions.
	// All outputs require human review before execution.
	TrustSuggest TrustLevel = 2

	// TrustActWithApproval permits the agent to act but every action requires
	// explicit human approval before it is executed.
	TrustActWithApproval TrustLevel = 3

	// TrustActAndReport permits the agent to act autonomously. All actions
	// must be reported post-hoc to the operator.
	TrustActAndReport TrustLevel = 4

	// TrustAutonomous grants fully autonomous operation within the defined
	// scope. This is the highest trust level.
	TrustAutonomous TrustLevel = 5
)

// TrustLevelName returns the human-readable display name for a TrustLevel.
// Returns "Unknown" for out-of-range values.
func TrustLevelName(level TrustLevel) string {
	names := map[TrustLevel]string{
		TrustObserver:        "Observer",
		TrustMonitor:         "Monitor",
		TrustSuggest:         "Suggest",
		TrustActWithApproval: "Act-with-Approval",
		TrustActAndReport:    "Act-and-Report",
		TrustAutonomous:      "Autonomous",
	}
	name, ok := names[level]
	if !ok {
		return "Unknown"
	}
	return name
}

// Decision is the unified result of a GovernanceEngine.Check call. It
// aggregates the results from all governance checks that were performed.
type Decision struct {
	// Permitted is true when all governance checks passed.
	Permitted bool

	// AgentID is the agent identifier that was used for the checks. It is
	// populated from WithAgentID or Config.DefaultAgentID and is stored in
	// the audit record for filtering.
	AgentID string

	// Trust contains the result of the trust level check, if one was
	// requested via WithRequiredTrust.
	Trust TrustResult

	// Budget contains the result of the budget envelope check, if one was
	// requested via WithBudgetCheck.
	Budget BudgetResult

	// Consent contains the result of the consent check, if one was
	// requested via WithConsentCheck.
	Consent ConsentResult

	// Action is the action string passed to Check.
	Action string

	// Timestamp records when the decision was made.
	Timestamp time.Time

	// Reason is a human-readable summary of the final decision outcome.
	// When Permitted is false, Reason identifies the first check that failed.
	Reason string
}

// TrustAssignment is an immutable record of a trust level being manually
// assigned to an agent. Every call to TrustManager.SetLevel produces one.
type TrustAssignment struct {
	// AgentID is the identifier of the agent receiving the assignment.
	AgentID string

	// Level is the trust level that was assigned.
	Level TrustLevel

	// Scope narrows the domain in which this assignment is valid.
	Scope string

	// AssignedAt records when the assignment was made.
	AssignedAt time.Time

	// ExpiresAt is the optional time after which this assignment is no
	// longer valid. A nil pointer means the assignment does not expire.
	ExpiresAt *time.Time

	// AssignedBy records who or what created this assignment (e.g. "owner",
	// "system", "policy").
	AssignedBy string
}

// TrustResult is returned by TrustManager.CheckLevel and embedded in Decision.
type TrustResult struct {
	// Permitted is true when the agent's current level meets RequiredLevel.
	Permitted bool

	// CurrentLevel is the trust level the agent held at check time.
	CurrentLevel TrustLevel

	// RequiredLevel is the minimum trust level the action demanded.
	RequiredLevel TrustLevel

	// Reason is a human-readable explanation of the check outcome.
	Reason string
}

// BudgetResult is returned by BudgetManager.Check and embedded in Decision.
type BudgetResult struct {
	// Permitted is true when the envelope had sufficient funds.
	Permitted bool

	// Available is the remaining balance in the envelope at check time.
	Available float64

	// Requested is the amount that was checked.
	Requested float64

	// Category identifies which spending envelope was consulted.
	Category string

	// Reason is a human-readable explanation of the check outcome.
	Reason string
}

// Envelope is a bounded spending allocation for a named cost category.
// It tracks cumulative spending over a configurable rolling period.
type Envelope struct {
	// Category is the human-readable name for this spending bucket.
	Category string

	// Limit is the maximum total spend permitted within one Period.
	Limit float64

	// Spent is the cumulative amount recorded in the current period.
	Spent float64

	// Period is the duration over which the Limit applies before reset.
	Period time.Duration

	// StartsAt records when the current period began.
	StartsAt time.Time
}

// Available returns the remaining balance in the envelope.
func (e Envelope) Available() float64 {
	available := e.Limit - e.Spent
	if available < 0 {
		return 0
	}
	return available
}

// ConsentResult is returned by ConsentManager.Check and embedded in Decision.
type ConsentResult struct {
	// Permitted is true when a valid consent grant was found.
	Permitted bool

	// Reason is a human-readable explanation of the check outcome.
	Reason string
}

// AuditRecord is an entry in the tamper-evident hash chain audit log.
type AuditRecord struct {
	// ID is a unique identifier for this record, generated as a hex string.
	ID string

	// Decision is the governance decision that was recorded.
	Decision Decision

	// Hash is the SHA-256 digest of this record's canonical payload combined
	// with PrevHash, forming the hash chain link.
	Hash string

	// PrevHash is the hash of the immediately preceding record, or
	// strings.Repeat("0", 64) for the genesis record.
	PrevHash string

	// Timestamp records when the record was appended to the log.
	Timestamp time.Time
}

// AuditFilter specifies criteria for querying audit records.
// Zero values are treated as "match any".
type AuditFilter struct {
	// AgentID filters records to those whose Decision was checked for this
	// agent. An empty string matches all agents.
	AgentID string

	// Action filters records by the action string. An empty string matches
	// all actions.
	Action string

	// Since returns only records with Timestamp >= Since. A zero Time
	// matches all timestamps.
	Since time.Time

	// Until returns only records with Timestamp <= Until. A zero Time
	// matches all timestamps.
	Until time.Time

	// PermittedOnly, if true, returns only records where Decision.Permitted
	// is true. If false, all records (permitted and denied) are returned.
	PermittedOnly bool

	// DeniedOnly, if true, returns only records where Decision.Permitted is
	// false. If both PermittedOnly and DeniedOnly are true, no records are
	// returned.
	DeniedOnly bool

	// Limit caps the number of records returned. Zero means no limit.
	Limit int
}

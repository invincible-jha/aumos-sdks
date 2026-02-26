// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Package storage defines the storage interface and in-memory implementation
// used by the governance package.
//
// Callers who need persistence beyond the process lifetime may implement
// Storage using any backend — Redis, PostgreSQL, etcd — without modifying the
// governance package.
//
// All implementations MUST be safe for concurrent use.
package storage

import "time"

// Storage is the persistence interface for the governance SDK.
//
// All methods must be safe for concurrent use. Implementations should
// document their consistency and durability guarantees.
type Storage interface {
	// GetTrust returns the TrustAssignment for (agentID, scope). The second
	// return value is false when no assignment exists.
	GetTrust(agentID, scope string) (*TrustAssignment, bool)

	// SetTrust stores or overwrites the TrustAssignment for (agentID, scope).
	SetTrust(agentID, scope string, assignment TrustAssignment)

	// GetEnvelope returns the budget Envelope for category. The second return
	// value is false when no envelope exists for that category.
	GetEnvelope(category string) (Envelope, bool)

	// SetEnvelope stores or overwrites the budget Envelope for category.
	SetEnvelope(category string, envelope Envelope)

	// GetConsent returns whether consent is currently active for (agentID,
	// action). The error is non-nil only for infrastructure failures; a
	// missing record returns (false, nil).
	GetConsent(agentID, action string) (bool, error)

	// SetConsent records or updates the consent state for (agentID, action).
	SetConsent(agentID, action string, granted bool)

	// AppendAudit appends a record to the audit log. Returns a non-nil error
	// only on infrastructure failure (e.g. storage full, I/O error).
	AppendAudit(record AuditRecord) error

	// QueryAudit returns audit records matching the supplied filter. Records
	// are returned in append order (oldest first).
	QueryAudit(filter AuditFilter) ([]AuditRecord, error)
}

// TrustAssignment mirrors governance.TrustAssignment but avoids a circular
// import between the governance and storage packages.
type TrustAssignment struct {
	AgentID    string
	Level      int
	Scope      string
	AssignedAt time.Time
	ExpiresAt  *time.Time
	AssignedBy string
}

// Envelope mirrors governance.Envelope but avoids a circular import.
type Envelope struct {
	Category string
	Limit    float64
	Spent    float64
	Period   time.Duration
	StartsAt time.Time
}

// Decision mirrors the governance.Decision fields relevant to audit storage.
type Decision struct {
	Permitted bool
	Action    string
	Timestamp time.Time
	Reason    string
	// AgentID is extracted from the Trust check result for filter support.
	AgentID string
}

// AuditRecord mirrors governance.AuditRecord at the storage layer.
type AuditRecord struct {
	ID        string
	Decision  Decision
	Hash      string
	PrevHash  string
	Timestamp time.Time
}

// AuditFilter mirrors governance.AuditFilter at the storage layer.
type AuditFilter struct {
	AgentID       string
	Action        string
	Since         time.Time
	Until         time.Time
	PermittedOnly bool
	DeniedOnly    bool
	Limit         int
}

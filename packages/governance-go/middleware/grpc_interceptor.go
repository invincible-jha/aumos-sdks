// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package middleware

// Full-featured gRPC governance interceptors with trust provider integration,
// audit logging, and per-message stream governance.
//
// This file builds on the foundation in grpc.go by introducing:
//   - TrustProvider and AuditLogger interfaces for pluggable static trust
//     lookup and tamper-evident audit recording.
//   - A governed ServerStream wrapper that checks governance on each RecvMsg.
//   - An InterceptorConfig struct to group all interceptor dependencies.
//
// Trust levels are always static — looked up from operator configuration via
// TrustProvider. There is no adaptive or behavioral trust progression.
//
// # Usage
//
//	cfg := middleware.InterceptorConfig{
//	    Engine:        engine,
//	    TrustProvider: myStaticTrustProvider,
//	    AuditLogger:   myAuditLogger,
//	    SkipMethods:   []string{"grpc.health.v1.Health/Check"},
//	}
//
//	unary := middleware.NewGovernanceUnaryInterceptor(cfg)
//	stream := middleware.NewGovernanceStreamInterceptor(cfg)

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

// TrustProvider looks up the static trust level assigned to an agent by an
// operator. All trust assignments are manual — there is no automatic
// progression or behavioral scoring.
type TrustProvider interface {
	// GetTrustLevel returns the statically configured trust level for agentID.
	// Returns an error if the agent is unknown or the lookup fails.
	GetTrustLevel(ctx context.Context, agentID string) (int, error)
}

// AuditLogger records governance decisions into a tamper-evident audit trail.
// Implementations must be safe for concurrent use.
type AuditLogger interface {
	// LogDecision records a governance decision. The implementation must not
	// modify the provided AuditEntry.
	LogDecision(ctx context.Context, entry AuditEntry) error
}

// AuditEntry is the structured record written to the audit trail for every
// governance evaluation.
type AuditEntry struct {
	// AgentID is the identifier of the agent whose action was evaluated.
	AgentID string
	// Method is the full gRPC method string or HTTP path that was checked.
	Method string
	// Decision is "allow" or "deny".
	Decision string
	// Reason is a human-readable explanation of the governance outcome.
	Reason string
	// TrustLevel is the static trust level that was resolved for the agent.
	TrustLevel int
	// Timestamp is the UTC time when the decision was recorded.
	Timestamp time.Time
}

// ---------------------------------------------------------------------------
// InterceptorConfig
// ---------------------------------------------------------------------------

// InterceptorConfig groups the dependencies for the full-featured governance
// interceptors. Engine is required; TrustProvider and AuditLogger are optional
// but strongly recommended for production deployments.
type InterceptorConfig struct {
	// Engine is the governance engine used to evaluate actions.
	Engine *governance.GovernanceEngine

	// TrustProvider resolves the static trust level for an agent ID.
	// When nil, trust checks rely solely on the engine's internal state.
	TrustProvider TrustProvider

	// AuditLogger records every governance decision. When nil, decisions
	// are still evaluated but not externally logged.
	AuditLogger AuditLogger

	// SkipMethods lists full gRPC method strings (e.g.
	// "grpc.health.v1.Health/Check") that bypass governance checks entirely.
	SkipMethods []string

	// AgentMetadataKey is the gRPC metadata key from which the agent ID is
	// extracted. Defaults to "x-aumos-agent-id" if empty.
	AgentMetadataKey string

	// MetadataReader reads a single metadata value from a gRPC context.
	// Required for agent ID extraction when using real gRPC metadata.
	// When nil, a no-op reader that always returns "" is used.
	MetadataReader MetadataReader
}

// agentMetaKey returns the configured metadata key, falling back to the
// default when the config value is empty.
func (c *InterceptorConfig) agentMetaKey() string {
	if c.AgentMetadataKey != "" {
		return c.AgentMetadataKey
	}
	return "x-aumos-agent-id"
}

// metaReader returns the configured MetadataReader, falling back to a no-op.
func (c *InterceptorConfig) metaReader() MetadataReader {
	if c.MetadataReader != nil {
		return c.MetadataReader
	}
	return func(_ context.Context, _ string) string { return "" }
}

// shouldSkip reports whether the given full method is in the skip list.
func (c *InterceptorConfig) shouldSkip(fullMethod string) bool {
	trimmed := strings.TrimPrefix(fullMethod, "/")
	for _, m := range c.SkipMethods {
		if m == fullMethod || m == trimmed {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Unary interceptor
// ---------------------------------------------------------------------------

// NewGovernanceUnaryInterceptor returns a unary server interceptor that:
//  1. Extracts the agent ID from gRPC metadata.
//  2. Looks up the static trust level via TrustProvider.
//  3. Evaluates the governance engine.
//  4. Logs the decision to the audit trail.
//  5. Returns codes.PermissionDenied (as a formatted error) on deny.
//
// Methods listed in InterceptorConfig.SkipMethods bypass all checks.
// The governance Decision is stored in the context under DecisionContextKey.
func NewGovernanceUnaryInterceptor(
	cfg InterceptorConfig,
) func(ctx context.Context, req any, info *UnaryServerInfo, handler UnaryHandler) (any, error) {
	if cfg.Engine == nil {
		panic("middleware: InterceptorConfig.Engine must not be nil")
	}

	reader := cfg.metaReader()
	metaKey := cfg.agentMetaKey()

	return func(ctx context.Context, req any, info *UnaryServerInfo, handler UnaryHandler) (any, error) {
		if cfg.shouldSkip(info.FullMethod) {
			return handler(ctx, req)
		}

		agentID := reader(ctx, metaKey)
		action := strings.TrimPrefix(info.FullMethod, "/")

		decision, trustLevel, err := evaluateGovernance(ctx, &cfg, agentID, action)
		if err != nil {
			return nil, fmt.Errorf("governance evaluation error: %w", err)
		}

		// Record audit entry.
		logAuditEntry(ctx, cfg.AuditLogger, agentID, info.FullMethod, decision, trustLevel)

		ctx = context.WithValue(ctx, DecisionContextKey, decision)

		if !decision.Permitted {
			return nil, fmt.Errorf("permission denied: %s", decision.Reason)
		}

		return handler(ctx, req)
	}
}

// ---------------------------------------------------------------------------
// Stream interceptor
// ---------------------------------------------------------------------------

// governedStream wraps a ServerStream to check governance on each RecvMsg.
// The initial stream-open check is performed by the interceptor; per-message
// checks use the same governance configuration applied to each received
// message.
type governedStream struct {
	ServerStream
	ctx    context.Context
	cfg    *InterceptorConfig
	agent  string
	action string
}

// Context returns the governed context (which may carry the initial Decision).
func (s *governedStream) Context() context.Context {
	return s.ctx
}

// RecvMsg mirrors grpc.ServerStream.RecvMsg. Each call triggers a governance
// evaluation before the message is delivered to the handler.
func (s *governedStream) RecvMsg(msg any) error {
	// Delegate to the underlying stream's RecvMsg if it supports it.
	type recvMsgStream interface {
		RecvMsg(msg any) error
	}
	recv, ok := s.ServerStream.(recvMsgStream)
	if !ok {
		return fmt.Errorf("middleware: underlying ServerStream does not support RecvMsg")
	}

	// Evaluate governance before allowing the message through.
	decision, trustLevel, err := evaluateGovernance(s.ctx, s.cfg, s.agent, s.action)
	if err != nil {
		return fmt.Errorf("governance evaluation error: %w", err)
	}

	logAuditEntry(s.ctx, s.cfg.AuditLogger, s.agent, s.action, decision, trustLevel)

	if !decision.Permitted {
		return fmt.Errorf("permission denied: %s", decision.Reason)
	}

	return recv.RecvMsg(msg)
}

// NewGovernanceStreamInterceptor returns a stream server interceptor that:
//  1. Checks governance when the stream is opened.
//  2. Wraps the ServerStream so each RecvMsg is individually governed.
//  3. Logs all decisions to the audit trail.
//
// Methods listed in InterceptorConfig.SkipMethods bypass all checks.
func NewGovernanceStreamInterceptor(
	cfg InterceptorConfig,
) func(srv any, ss ServerStream, info *StreamServerInfo, handler StreamHandler) error {
	if cfg.Engine == nil {
		panic("middleware: InterceptorConfig.Engine must not be nil")
	}

	reader := cfg.metaReader()
	metaKey := cfg.agentMetaKey()

	return func(srv any, ss ServerStream, info *StreamServerInfo, handler StreamHandler) error {
		if cfg.shouldSkip(info.FullMethod) {
			return handler(srv, ss)
		}

		ctx := ss.Context()
		agentID := reader(ctx, metaKey)
		action := strings.TrimPrefix(info.FullMethod, "/")

		// Initial stream-open governance check.
		decision, trustLevel, err := evaluateGovernance(ctx, &cfg, agentID, action)
		if err != nil {
			return fmt.Errorf("governance evaluation error: %w", err)
		}

		logAuditEntry(ctx, cfg.AuditLogger, agentID, info.FullMethod, decision, trustLevel)

		if !decision.Permitted {
			return fmt.Errorf("permission denied: %s", decision.Reason)
		}

		governed := &governedStream{
			ServerStream: ss,
			ctx:          context.WithValue(ctx, DecisionContextKey, decision),
			cfg:          &cfg,
			agent:        agentID,
			action:       action,
		}

		return handler(srv, governed)
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// evaluateGovernance resolves the agent's static trust level and runs the
// governance engine. It returns the decision, the resolved trust level, and
// any infrastructure error.
func evaluateGovernance(
	ctx context.Context,
	cfg *InterceptorConfig,
	agentID string,
	action string,
) (*governance.Decision, int, error) {
	var checkOpts []governance.CheckOption
	if agentID != "" {
		checkOpts = append(checkOpts, governance.WithAgentID(agentID))
	}

	trustLevel := -1
	if cfg.TrustProvider != nil && agentID != "" {
		level, err := cfg.TrustProvider.GetTrustLevel(ctx, agentID)
		if err != nil {
			return nil, -1, fmt.Errorf("trust provider lookup for agent %q: %w", agentID, err)
		}
		trustLevel = level
		checkOpts = append(checkOpts, governance.WithRequiredTrust(governance.TrustLevel(level)))
	}

	decision, err := cfg.Engine.Check(ctx, action, checkOpts...)
	if err != nil {
		return nil, trustLevel, fmt.Errorf("engine check: %w", err)
	}

	return decision, trustLevel, nil
}

// logAuditEntry writes a governance decision to the configured AuditLogger.
// If no logger is configured, this is a no-op. Errors from the logger are
// silently ignored to avoid failing the RPC on an audit infrastructure issue.
func logAuditEntry(
	ctx context.Context,
	logger AuditLogger,
	agentID string,
	method string,
	decision *governance.Decision,
	trustLevel int,
) {
	if logger == nil {
		return
	}

	decisionLabel := "allow"
	if !decision.Permitted {
		decisionLabel = "deny"
	}

	entry := AuditEntry{
		AgentID:    agentID,
		Method:     method,
		Decision:   decisionLabel,
		Reason:     decision.Reason,
		TrustLevel: trustLevel,
		Timestamp:  time.Now().UTC(),
	}

	// Audit logging is recording only. Errors do not propagate to the caller.
	_ = logger.LogDecision(ctx, entry)
}

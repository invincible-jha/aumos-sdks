// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package middleware

// Enhanced net/http governance middleware with functional options, structured
// JSON denial responses, context enrichment, and audit logging.
//
// This file provides a struct-based middleware that wraps an http.Handler and
// enforces AumOS governance checks on every request. It complements the
// function-based GovernanceMiddleware in http.go by offering:
//
//   - Functional options pattern (WithEngine, WithTrustHeader, etc.)
//   - Structured JSON 403 responses instead of plain text
//   - TrustProvider integration for static trust lookup
//   - AuditLogger integration for tamper-evident decision recording
//   - Path-based skip list for health/readiness endpoints
//   - Context enrichment with governance decision for downstream handlers
//
// Thread safety: the middleware holds no mutable shared state after
// construction. All per-request state is scoped to the request context.
//
// # Usage
//
//	handler := middleware.NewGovernanceMiddleware(mux,
//	    middleware.WithEngine(engine),
//	    middleware.WithTrustHeader("X-AumOS-Agent-ID"),
//	    middleware.WithHTTPAuditLogger(auditLogger),
//	    middleware.WithSkipPaths("/healthz", "/readyz"),
//	)
//	http.ListenAndServe(":8080", handler)

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

// ---------------------------------------------------------------------------
// Context key for governance decision
// ---------------------------------------------------------------------------

// httpGovernanceDecisionKey is the context key under which the governance
// Decision is stored by GovernanceHTTPMiddleware.
type httpGovernanceDecisionKey struct{}

// DecisionFromHTTPContext retrieves the governance Decision stored by
// GovernanceHTTPMiddleware from the request context. Returns nil when no
// decision is present.
func DecisionFromHTTPContext(ctx context.Context) *governance.Decision {
	d, _ := ctx.Value(httpGovernanceDecisionKey{}).(*governance.Decision)
	return d
}

// ---------------------------------------------------------------------------
// Middleware option types
// ---------------------------------------------------------------------------

// HTTPMiddlewareOption is a functional option for NewGovernanceMiddleware.
type HTTPMiddlewareOption func(*httpMiddlewareConfig)

type httpMiddlewareConfig struct {
	engine        *governance.GovernanceEngine
	trustHeader   string
	trustProvider TrustProvider
	auditLogger   AuditLogger
	skipPaths     map[string]struct{}
	actionFunc    func(r *http.Request) string
}

// WithEngine sets the governance engine used to evaluate requests.
// This option is required.
func WithEngine(engine *governance.GovernanceEngine) HTTPMiddlewareOption {
	return func(c *httpMiddlewareConfig) {
		c.engine = engine
	}
}

// WithTrustHeader sets the HTTP header name from which the agent ID is read.
// Defaults to "X-AumOS-Agent-ID".
func WithTrustHeader(header string) HTTPMiddlewareOption {
	return func(c *httpMiddlewareConfig) {
		c.trustHeader = header
	}
}

// WithHTTPTrustProvider sets the TrustProvider used to resolve static trust
// levels for agents identified in request headers.
func WithHTTPTrustProvider(provider TrustProvider) HTTPMiddlewareOption {
	return func(c *httpMiddlewareConfig) {
		c.trustProvider = provider
	}
}

// WithHTTPAuditLogger sets the AuditLogger used to record governance decisions.
func WithHTTPAuditLogger(logger AuditLogger) HTTPMiddlewareOption {
	return func(c *httpMiddlewareConfig) {
		c.auditLogger = logger
	}
}

// WithSkipPaths sets URL paths that bypass governance checks entirely.
// Useful for health-check and readiness endpoints. Matching is exact and
// case-sensitive on the path (query string is ignored).
func WithSkipPaths(paths ...string) HTTPMiddlewareOption {
	return func(c *httpMiddlewareConfig) {
		for _, p := range paths {
			c.skipPaths[p] = struct{}{}
		}
	}
}

// WithHTTPActionFunc sets a function that derives the governance action name
// from the incoming request. Defaults to "METHOD /path".
func WithHTTPActionFunc(fn func(r *http.Request) string) HTTPMiddlewareOption {
	return func(c *httpMiddlewareConfig) {
		c.actionFunc = fn
	}
}

// ---------------------------------------------------------------------------
// GovernanceHTTPMiddleware
// ---------------------------------------------------------------------------

// GovernanceHTTPMiddleware wraps an http.Handler with AumOS governance checks.
// It is constructed via NewGovernanceMiddleware and is safe for concurrent use.
type GovernanceHTTPMiddleware struct {
	next   http.Handler
	config httpMiddlewareConfig
}

// denyResponse is the JSON body returned on governance denial.
type denyResponse struct {
	Error  string `json:"error"`
	Reason string `json:"reason"`
}

// NewGovernanceMiddleware constructs a governance-enforcing http.Handler that
// wraps the provided next handler.
//
// The WithEngine option is required. If it is not provided, the middleware
// panics at construction time to surface configuration errors early.
func NewGovernanceMiddleware(next http.Handler, opts ...HTTPMiddlewareOption) http.Handler {
	cfg := httpMiddlewareConfig{
		trustHeader: "X-AumOS-Agent-ID",
		skipPaths:   make(map[string]struct{}),
	}

	for _, opt := range opts {
		opt(&cfg)
	}

	if cfg.engine == nil {
		panic("middleware: WithEngine is required for NewGovernanceMiddleware")
	}

	if cfg.actionFunc == nil {
		cfg.actionFunc = func(r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}
	}

	return &GovernanceHTTPMiddleware{
		next:   next,
		config: cfg,
	}
}

// ServeHTTP implements http.Handler. For every request it:
//  1. Checks the skip-paths list.
//  2. Extracts the agent ID from the configured header.
//  3. Resolves the agent's static trust level via TrustProvider.
//  4. Evaluates the governance engine.
//  5. Logs the decision to the audit trail.
//  6. On deny: responds with 403 and a JSON body.
//  7. On allow: stores the decision in the request context and calls next.
func (m *GovernanceHTTPMiddleware) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Skip-path bypass.
	if _, skip := m.config.skipPaths[r.URL.Path]; skip {
		m.next.ServeHTTP(w, r)
		return
	}

	agentID := r.Header.Get(m.config.trustHeader)
	action := m.config.actionFunc(r)

	// Build governance check options.
	var checkOpts []governance.CheckOption
	if agentID != "" {
		checkOpts = append(checkOpts, governance.WithAgentID(agentID))
	}

	trustLevel := -1
	if m.config.trustProvider != nil && agentID != "" {
		level, err := m.config.trustProvider.GetTrustLevel(r.Context(), agentID)
		if err != nil {
			writeDenyJSON(w, "governance_denied",
				fmt.Sprintf("trust lookup failed for agent %q", agentID))
			return
		}
		trustLevel = level
		checkOpts = append(checkOpts, governance.WithRequiredTrust(governance.TrustLevel(level)))
	}

	decision, err := m.config.engine.Check(r.Context(), action, checkOpts...)
	if err != nil {
		http.Error(w, "governance check error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Record audit entry.
	m.logDecision(r.Context(), agentID, action, decision, trustLevel)

	// Enrich the request context with the governance decision.
	enrichedCtx := context.WithValue(r.Context(), httpGovernanceDecisionKey{}, decision)
	r = r.WithContext(enrichedCtx)

	if !decision.Permitted {
		writeDenyJSON(w, "governance_denied", decision.Reason)
		return
	}

	m.next.ServeHTTP(w, r)
}

// logDecision writes an audit entry for the governance decision. If no audit
// logger is configured, this is a no-op. Audit logging is recording only;
// errors from the logger do not affect the request outcome.
func (m *GovernanceHTTPMiddleware) logDecision(
	ctx context.Context,
	agentID string,
	action string,
	decision *governance.Decision,
	trustLevel int,
) {
	if m.config.auditLogger == nil {
		return
	}

	decisionLabel := "allow"
	if !decision.Permitted {
		decisionLabel = "deny"
	}

	entry := AuditEntry{
		AgentID:    agentID,
		Method:     action,
		Decision:   decisionLabel,
		Reason:     decision.Reason,
		TrustLevel: trustLevel,
		Timestamp:  time.Now().UTC(),
	}

	// Audit logging is recording only. Errors are not propagated.
	_ = m.config.auditLogger.LogDecision(ctx, entry)
}

// writeDenyJSON writes a 403 Forbidden response with a structured JSON body.
func writeDenyJSON(w http.ResponseWriter, errorCode, reason string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)

	resp := denyResponse{
		Error:  errorCode,
		Reason: reason,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		// Fallback to a hardcoded response if marshalling fails.
		_, _ = w.Write([]byte(`{"error":"governance_denied","reason":"internal error"}`))
		return
	}

	_, _ = w.Write(data)
}

// ---------------------------------------------------------------------------
// Helpers for downstream handlers
// ---------------------------------------------------------------------------

// GovernanceDecisionHeader is the canonical response header name for
// governance decisions, used for observability and debugging.
const GovernanceDecisionHeader = "X-AumOS-Governance-Decision"

// AnnotateResponseHeaders writes the governance decision into the response
// headers. Downstream handlers can call this after calling
// DecisionFromHTTPContext to surface the decision to API consumers.
func AnnotateResponseHeaders(w http.ResponseWriter, decision *governance.Decision) {
	if decision == nil {
		return
	}
	label := "allow"
	if !decision.Permitted {
		label = "deny"
	}
	w.Header().Set(GovernanceDecisionHeader, label)
	if !decision.Permitted {
		w.Header().Set("X-AumOS-Governance-Reason", truncateHeader(decision.Reason))
	}
}

// truncateHeader truncates a header value to a safe length for HTTP headers.
// RFC 7230 does not specify a maximum, but 256 bytes is a practical limit
// for single-line informational headers.
func truncateHeader(value string) string {
	if len(value) <= 256 {
		return value
	}
	return strings.TrimSpace(value[:253]) + "..."
}

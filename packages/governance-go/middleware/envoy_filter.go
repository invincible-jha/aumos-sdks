// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package middleware

// Envoy external processing filter skeleton for AumOS governance.
//
// This file provides a gRPC service skeleton that implements the Envoy
// External Processing (ext_proc) filter protocol. It allows Envoy to delegate
// governance decisions to an external Go process running the AumOS governance
// engine.
//
// # How Envoy ext_proc works
//
// Envoy sends request/response phases (headers, body, trailers) to an
// external gRPC service. The service responds with processing directives:
// continue, modify headers, replace body, or return an immediate response.
//
// # Wiring into Envoy
//
// Add an ext_proc filter to your Envoy HTTP filter chain:
//
//	http_filters:
//	  - name: envoy.filters.http.ext_proc
//	    typed_config:
//	      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor
//	      grpc_service:
//	        envoy_grpc:
//	          cluster_name: aumos_governance
//	      processing_mode:
//	        request_header_mode: SEND
//	        request_body_mode: BUFFERED
//	        response_header_mode: SEND
//	        response_body_mode: SKIP
//
// The cluster "aumos_governance" should point to the gRPC endpoint where
// the EnvoyGovernanceFilter is serving.
//
// # Protocol types
//
// This file defines its own request/response types that mirror the Envoy
// ext_proc proto surface. In a production deployment, replace these with the
// generated types from envoy/service/ext_proc/v3/external_processor.proto.
// The structural signatures are kept identical for drop-in replacement.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

// ---------------------------------------------------------------------------
// Envoy ext_proc mirror types
// ---------------------------------------------------------------------------

// HeaderMap mirrors envoy.config.core.v3.HeaderMap. Each entry is a
// key-value pair from the HTTP request or response headers.
type HeaderMap struct {
	Headers []HeaderValue
}

// HeaderValue mirrors envoy.config.core.v3.HeaderValue.
type HeaderValue struct {
	Key   string
	Value string
}

// Get returns the first value for the given header key (case-insensitive).
// Returns "" if not found.
func (hm *HeaderMap) Get(key string) string {
	lower := strings.ToLower(key)
	for _, h := range hm.Headers {
		if strings.ToLower(h.Key) == lower {
			return h.Value
		}
	}
	return ""
}

// HttpHeaders mirrors the request_headers / response_headers message in
// envoy.service.ext_proc.v3.
type HttpHeaders struct {
	Headers *HeaderMap
}

// HttpBody mirrors the request_body / response_body message in
// envoy.service.ext_proc.v3.
type HttpBody struct {
	Body []byte
}

// HeaderMutation describes header modifications to apply.
type HeaderMutation struct {
	SetHeaders    []HeaderValue
	RemoveHeaders []string
}

// CommonResponse is the shared response structure for all processing phases.
type CommonResponse struct {
	HeaderMutation *HeaderMutation
}

// ImmediateResponse instructs Envoy to return an immediate HTTP response
// without forwarding to the upstream.
type ImmediateResponse struct {
	Status  int
	Headers *HeaderMutation
	Body    []byte
}

// ProcessingResponse is the top-level response returned by each processing
// phase. Exactly one of the response fields should be non-nil.
type ProcessingResponse struct {
	// RequestHeaders is set when responding to a request_headers phase.
	RequestHeaders *CommonResponse
	// RequestBody is set when responding to a request_body phase.
	RequestBody *CommonResponse
	// ResponseHeaders is set when responding to a response_headers phase.
	ResponseHeaders *CommonResponse
	// ImmediateResponse is set to short-circuit with a direct reply to the client.
	ImmediateResponse *ImmediateResponse
}

// ---------------------------------------------------------------------------
// FilterConfig
// ---------------------------------------------------------------------------

// FilterConfig configures the EnvoyGovernanceFilter.
type FilterConfig struct {
	// Engine is the governance engine used for action evaluation.
	Engine *governance.GovernanceEngine

	// TrustProvider resolves the static trust level for an agent. When nil,
	// trust checks rely solely on the engine's internal trust state.
	TrustProvider TrustProvider

	// HeaderName is the HTTP header from which the agent ID is extracted.
	// Defaults to "x-aumos-agent-id" when empty.
	HeaderName string

	// AuditLogger records governance decisions. May be nil.
	AuditLogger AuditLogger
}

// headerName returns the configured header name or the default.
func (fc *FilterConfig) headerName() string {
	if fc.HeaderName != "" {
		return fc.HeaderName
	}
	return "x-aumos-agent-id"
}

// ---------------------------------------------------------------------------
// EnvoyGovernanceFilter
// ---------------------------------------------------------------------------

// EnvoyGovernanceFilter implements the Envoy ext_proc gRPC service for AumOS
// governance. It evaluates governance policy during request processing and
// injects decision metadata into response headers.
//
// In a production deployment this struct would implement the generated
// ExternalProcessorServer interface from Envoy's ext_proc proto. The method
// signatures here mirror that interface for structural compatibility.
type EnvoyGovernanceFilter struct {
	config FilterConfig

	// lastDecision stores the most recent governance decision per-request.
	// In the real ext_proc streaming model, state is maintained across
	// phases within a single bidirectional stream. This field illustrates
	// that pattern; production code should scope it to the stream context.
}

// NewEnvoyGovernanceFilter constructs an EnvoyGovernanceFilter with the given
// configuration.
func NewEnvoyGovernanceFilter(config FilterConfig) (*EnvoyGovernanceFilter, error) {
	if config.Engine == nil {
		return nil, fmt.Errorf("middleware: FilterConfig.Engine must not be nil")
	}
	return &EnvoyGovernanceFilter{config: config}, nil
}

// ProcessRequestHeaders is called by Envoy during the request_headers phase.
// It extracts the agent ID from the configured header and performs an initial
// trust level check via the TrustProvider.
//
// If the agent is unknown or the trust level cannot be resolved, an
// ImmediateResponse with HTTP 403 is returned.
func (f *EnvoyGovernanceFilter) ProcessRequestHeaders(
	ctx context.Context,
	headers *HttpHeaders,
) (*ProcessingResponse, error) {
	if headers == nil || headers.Headers == nil {
		return &ProcessingResponse{
			RequestHeaders: &CommonResponse{},
		}, nil
	}

	agentID := headers.Headers.Get(f.config.headerName())
	if agentID == "" {
		return &ProcessingResponse{
			ImmediateResponse: &ImmediateResponse{
				Status: 403,
				Body:   marshalDenyBody("governance_denied", "missing agent identity header"),
			},
		}, nil
	}

	// Verify the agent has a resolvable trust level.
	if f.config.TrustProvider != nil {
		_, err := f.config.TrustProvider.GetTrustLevel(ctx, agentID)
		if err != nil {
			return &ProcessingResponse{
				ImmediateResponse: &ImmediateResponse{
					Status: 403,
					Body:   marshalDenyBody("governance_denied", fmt.Sprintf("trust lookup failed for agent %q", agentID)),
				},
			}, nil
		}
	}

	// Headers phase passes; full evaluation occurs in the body phase.
	return &ProcessingResponse{
		RequestHeaders: &CommonResponse{},
	}, nil
}

// requestBodyPayload is the expected JSON structure in the request body
// when performing full governance evaluation.
type requestBodyPayload struct {
	Action string `json:"action"`
	Scope  string `json:"scope"`
}

// ProcessRequestBody is called by Envoy during the request_body phase.
// It extracts the action and scope from the request body JSON, re-reads the
// agent ID from context (which the caller must propagate), and runs the full
// governance evaluation.
//
// On deny, an ImmediateResponse with HTTP 403 is returned. On allow,
// processing continues to the upstream.
func (f *EnvoyGovernanceFilter) ProcessRequestBody(
	ctx context.Context,
	headers *HttpHeaders,
	body *HttpBody,
) (*ProcessingResponse, error) {
	if body == nil || len(body.Body) == 0 {
		return &ProcessingResponse{
			RequestBody: &CommonResponse{},
		}, nil
	}

	// Extract agent ID from headers (Envoy sends headers with body in buffered mode).
	agentID := ""
	if headers != nil && headers.Headers != nil {
		agentID = headers.Headers.Get(f.config.headerName())
	}

	// Parse action/scope from the request body.
	var payload requestBodyPayload
	if err := json.Unmarshal(body.Body, &payload); err != nil {
		// Non-JSON bodies skip governance body evaluation.
		return &ProcessingResponse{
			RequestBody: &CommonResponse{},
		}, nil
	}

	action := payload.Action
	if action == "" {
		return &ProcessingResponse{
			RequestBody: &CommonResponse{},
		}, nil
	}

	// Build check options.
	var checkOpts []governance.CheckOption
	if agentID != "" {
		checkOpts = append(checkOpts, governance.WithAgentID(agentID))
	}
	if payload.Scope != "" {
		checkOpts = append(checkOpts, governance.WithScope(payload.Scope))
	}

	if f.config.TrustProvider != nil && agentID != "" {
		level, err := f.config.TrustProvider.GetTrustLevel(ctx, agentID)
		if err == nil {
			checkOpts = append(checkOpts, governance.WithRequiredTrust(governance.TrustLevel(level)))
		}
	}

	decision, err := f.config.Engine.Check(ctx, action, checkOpts...)
	if err != nil {
		return nil, fmt.Errorf("middleware: governance engine check: %w", err)
	}

	// Record audit entry.
	if f.config.AuditLogger != nil {
		trustLevel := -1
		if f.config.TrustProvider != nil && agentID != "" {
			level, tlErr := f.config.TrustProvider.GetTrustLevel(ctx, agentID)
			if tlErr == nil {
				trustLevel = level
			}
		}
		decisionLabel := "allow"
		if !decision.Permitted {
			decisionLabel = "deny"
		}
		_ = f.config.AuditLogger.LogDecision(ctx, AuditEntry{
			AgentID:    agentID,
			Method:     action,
			Decision:   decisionLabel,
			Reason:     decision.Reason,
			TrustLevel: trustLevel,
			Timestamp:  time.Now().UTC(),
		})
	}

	if !decision.Permitted {
		return &ProcessingResponse{
			ImmediateResponse: &ImmediateResponse{
				Status: 403,
				Body:   marshalDenyBody("governance_denied", decision.Reason),
			},
		}, nil
	}

	return &ProcessingResponse{
		RequestBody: &CommonResponse{},
	}, nil
}

// ProcessResponseHeaders is called by Envoy during the response_headers phase.
// It injects the x-aumos-governance-decision header into the response so that
// downstream consumers (and observability systems) can see whether the request
// was allowed or denied by governance.
func (f *EnvoyGovernanceFilter) ProcessResponseHeaders(
	_ context.Context,
	decision *governance.Decision,
) (*ProcessingResponse, error) {
	label := "allow"
	if decision != nil && !decision.Permitted {
		label = "deny"
	}

	return &ProcessingResponse{
		ResponseHeaders: &CommonResponse{
			HeaderMutation: &HeaderMutation{
				SetHeaders: []HeaderValue{
					{Key: "x-aumos-governance-decision", Value: label},
				},
			},
		},
	}, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// marshalDenyBody produces the JSON deny response body.
func marshalDenyBody(errorCode, reason string) []byte {
	body := struct {
		Error  string `json:"error"`
		Reason string `json:"reason"`
	}{
		Error:  errorCode,
		Reason: reason,
	}
	data, _ := json.Marshal(body)
	return data
}

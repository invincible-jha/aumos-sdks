// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package middleware

// gRPC governance integration — zero external dependencies.
//
// This file does NOT import google.golang.org/grpc. Instead it defines its own
// minimal interface types that mirror the grpc package's public API surface
// needed for interceptors. This allows the governance module to stay at zero
// external dependencies while still providing idiomatic interceptor wrappers.
//
// # Wiring with google.golang.org/grpc
//
// The types defined here (UnaryHandler, StreamDesc, ServerStream, etc.) are
// structurally identical to their grpc counterparts. Go's structural type
// system means you can convert between them with a type assertion or by
// wrapping them:
//
//	import (
//	    "google.golang.org/grpc"
//	    govmw "github.com/aumos-ai/aumos-sdks/go/governance/middleware"
//	)
//
//	func toGovUnaryInterceptor(
//	    engine *governance.GovernanceEngine,
//	    opts ...govmw.InterceptorOption,
//	) grpc.UnaryServerInterceptor {
//	    interceptor := govmw.GovernanceUnaryInterceptor(engine, opts...)
//	    return func(
//	        ctx context.Context,
//	        req any,
//	        info *grpc.UnaryServerInfo,
//	        handler grpc.UnaryHandler,
//	    ) (any, error) {
//	        return interceptor(ctx, req,
//	            &govmw.UnaryServerInfo{FullMethod: info.FullMethod},
//	            govmw.UnaryHandler(handler),
//	        )
//	    }
//	}
//
//	server := grpc.NewServer(
//	    grpc.UnaryInterceptor(toGovUnaryInterceptor(engine,
//	        govmw.WithInterceptorAgentMetaKey("x-agent-id"),
//	        govmw.WithInterceptorRequiredTrust(governance.TrustSuggest),
//	    )),
//	)
//
// # Metadata-based agent identification
//
// The interceptors look for the agent ID in the incoming gRPC metadata under
// the key configured by WithInterceptorAgentMetaKey (defaults to "x-agent-id").
// The first value associated with that key is used.

import (
	"context"
	"fmt"
	"strings"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

// ---------------------------------------------------------------------------
// Mirror types — structurally equivalent to google.golang.org/grpc types
// ---------------------------------------------------------------------------

// UnaryHandler mirrors grpc.UnaryHandler. It is the handler for a unary RPC.
type UnaryHandler func(ctx context.Context, req any) (any, error)

// UnaryServerInfo mirrors grpc.UnaryServerInfo. It carries the full RPC method
// name (e.g. "/helloworld.Greeter/SayHello") for interceptor routing.
type UnaryServerInfo struct {
	// Server is the service implementation, not used by the interceptor.
	Server any
	// FullMethod is the full gRPC method string, /package.service/method.
	FullMethod string
}

// StreamDesc mirrors grpc.StreamDesc. It describes a streaming RPC.
type StreamDesc struct {
	StreamName    string
	ServerStreams bool
	ClientStreams bool
}

// ServerStream mirrors grpc.ServerStream. It provides access to the streaming
// context and metadata.
type ServerStream interface {
	// Context returns the context for this stream.
	Context() context.Context
}

// StreamHandler mirrors grpc.StreamHandler. It is the handler for a streaming RPC.
type StreamHandler func(srv any, stream ServerStream) error

// StreamServerInfo mirrors grpc.StreamServerInfo.
type StreamServerInfo struct {
	// FullMethod is the full gRPC method string.
	FullMethod string
	IsClientStream bool
	IsServerStream bool
}

// MetadataReader is a function type that reads a single metadata value by key
// from the incoming gRPC context. Callers supply this via
// WithMetadataReader to bridge the gap between the mirror types and the real
// grpc/metadata package.
//
// A typical implementation:
//
//	func grpcMetadataReader(ctx context.Context, key string) string {
//	    md, ok := metadata.FromIncomingContext(ctx)
//	    if !ok {
//	        return ""
//	    }
//	    values := md.Get(key)
//	    if len(values) == 0 {
//	        return ""
//	    }
//	    return values[0]
//	}
type MetadataReader func(ctx context.Context, key string) string

// ---------------------------------------------------------------------------
// Interceptor options
// ---------------------------------------------------------------------------

// InterceptorOption is a functional option for the governance interceptors.
type InterceptorOption func(*interceptorConfig)

type interceptorConfig struct {
	agentMetaKey  string
	requiredTrust *governance.TrustLevel
	budgetCat     string
	budgetAmount  float64
	consentAction func(fullMethod string) string
	metaReader    MetadataReader
	denyHandler   func(ctx context.Context, reason string) error
}

// WithInterceptorAgentMetaKey sets the metadata key used to extract the agent
// ID from incoming gRPC metadata. Defaults to "x-agent-id".
func WithInterceptorAgentMetaKey(key string) InterceptorOption {
	return func(c *interceptorConfig) { c.agentMetaKey = key }
}

// WithInterceptorRequiredTrust gates every RPC on the agent meeting the given
// trust level.
func WithInterceptorRequiredTrust(level governance.TrustLevel) InterceptorOption {
	return func(c *interceptorConfig) { c.requiredTrust = &level }
}

// WithInterceptorBudgetCheck gates every RPC on the named budget envelope
// having at least amount remaining.
func WithInterceptorBudgetCheck(category string, amount float64) InterceptorOption {
	return func(c *interceptorConfig) {
		c.budgetCat = category
		c.budgetAmount = amount
	}
}

// WithInterceptorConsentAction sets a function that derives the consent action
// name from the full gRPC method string. When set, a consent check is
// performed on every RPC.
func WithInterceptorConsentAction(fn func(fullMethod string) string) InterceptorOption {
	return func(c *interceptorConfig) { c.consentAction = fn }
}

// WithMetadataReader provides the function used to read metadata from a gRPC
// context. Required for agent ID extraction when using real gRPC metadata.
// When not set the interceptor uses a no-op reader that always returns "".
func WithMetadataReader(reader MetadataReader) InterceptorOption {
	return func(c *interceptorConfig) { c.metaReader = reader }
}

// WithInterceptorDenyHandler overrides the error returned when governance
// denies an RPC. The default returns a permission-denied error string.
func WithInterceptorDenyHandler(fn func(ctx context.Context, reason string) error) InterceptorOption {
	return func(c *interceptorConfig) { c.denyHandler = fn }
}

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

// GovernanceUnaryInterceptor returns a unary server interceptor that runs
// governance checks before invoking the actual RPC handler.
//
// On denial the interceptor returns a non-nil error from the deny handler
// (default: fmt.Errorf("permission denied: %s", reason)) and does NOT call
// the downstream handler.
//
// The governance Decision is stored in the context under
// middleware.DecisionContextKey and can be retrieved with
// middleware.DecisionFromGRPCContext.
func GovernanceUnaryInterceptor(
	engine *governance.GovernanceEngine,
	opts ...InterceptorOption,
) func(ctx context.Context, req any, info *UnaryServerInfo, handler UnaryHandler) (any, error) {
	cfg := buildInterceptorConfig(opts)

	return func(ctx context.Context, req any, info *UnaryServerInfo, handler UnaryHandler) (any, error) {
		agentID := cfg.metaReader(ctx, cfg.agentMetaKey)
		action := methodToAction(info.FullMethod)

		decision, err := runGovernanceCheck(ctx, engine, cfg, agentID, action)
		if err != nil {
			return nil, err
		}

		ctx = context.WithValue(ctx, DecisionContextKey, decision)

		if !decision.Permitted {
			return nil, cfg.denyHandler(ctx, decision.Reason)
		}

		return handler(ctx, req)
	}
}

// GovernanceStreamInterceptor returns a stream server interceptor that runs
// governance checks before opening the stream.
//
// The check fires once when the stream is opened. Per-message governance is
// not performed — that would require callers to supply per-message cost hints
// which cannot be expressed generically.
func GovernanceStreamInterceptor(
	engine *governance.GovernanceEngine,
	opts ...InterceptorOption,
) func(srv any, ss ServerStream, info *StreamServerInfo, handler StreamHandler) error {
	cfg := buildInterceptorConfig(opts)

	return func(srv any, ss ServerStream, info *StreamServerInfo, handler StreamHandler) error {
		ctx := ss.Context()
		agentID := cfg.metaReader(ctx, cfg.agentMetaKey)
		action := methodToAction(info.FullMethod)

		decision, err := runGovernanceCheck(ctx, engine, cfg, agentID, action)
		if err != nil {
			return err
		}

		if !decision.Permitted {
			return cfg.denyHandler(ctx, decision.Reason)
		}

		return handler(srv, ss)
	}
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

// DecisionFromGRPCContext retrieves the governance Decision stored by the
// governance interceptors. Returns nil when no decision is present.
func DecisionFromGRPCContext(ctx context.Context) *governance.Decision {
	d, _ := ctx.Value(DecisionContextKey).(*governance.Decision)
	return d
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func buildInterceptorConfig(opts []InterceptorOption) *interceptorConfig {
	cfg := &interceptorConfig{
		agentMetaKey: "x-agent-id",
		metaReader:   func(_ context.Context, _ string) string { return "" },
		denyHandler: func(_ context.Context, reason string) error {
			return fmt.Errorf("permission denied: %s", reason)
		},
	}
	for _, opt := range opts {
		opt(cfg)
	}
	return cfg
}

func runGovernanceCheck(
	ctx context.Context,
	engine *governance.GovernanceEngine,
	cfg *interceptorConfig,
	agentID, action string,
) (*governance.Decision, error) {
	var checkOpts []governance.CheckOption

	if agentID != "" {
		checkOpts = append(checkOpts, governance.WithAgentID(agentID))
	}
	if cfg.requiredTrust != nil {
		checkOpts = append(checkOpts, governance.WithRequiredTrust(*cfg.requiredTrust))
	}
	if cfg.budgetCat != "" {
		checkOpts = append(checkOpts, governance.WithBudgetCheck(cfg.budgetCat, cfg.budgetAmount))
	}
	if cfg.consentAction != nil {
		consentAction := cfg.consentAction(action)
		if consentAction != "" {
			checkOpts = append(checkOpts, governance.WithConsentCheck(agentID, consentAction))
		}
	}

	return engine.Check(ctx, action, checkOpts...)
}

// methodToAction converts a full gRPC method string ("/package.Service/Method")
// to a compact action label ("package.Service/Method"). This is used as the
// governance action name in audit records.
func methodToAction(fullMethod string) string {
	return strings.TrimPrefix(fullMethod, "/")
}

// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Package middleware provides net/http and gRPC integration helpers for the
// governance SDK.
//
// # HTTP Usage
//
//	engine, _ := governance.NewEngine(governance.Config{})
//
//	mux := http.NewServeMux()
//	mux.HandleFunc("/api/action", handleAction)
//
//	handler := middleware.GovernanceMiddleware(engine,
//	    middleware.WithHTTPActionFunc(func(r *http.Request) string {
//	        return r.URL.Path
//	    }),
//	    middleware.WithHTTPAgentHeader("X-Agent-ID"),
//	    middleware.WithHTTPRequiredTrust(governance.TrustSuggest),
//	)(mux)
//
//	http.ListenAndServe(":8080", handler)
//
// # gRPC Usage
//
// The gRPC helpers in grpc.go define their own interface types that mirror
// google.golang.org/grpc so the package compiles with zero external
// dependencies. See grpc.go for wiring instructions.
package middleware

import (
	"context"
	"net/http"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

// MiddlewareOption is a functional option for GovernanceMiddleware.
type MiddlewareOption func(*middlewareConfig)

type middlewareConfig struct {
	actionFunc    func(r *http.Request) string
	agentHeader   string
	requiredTrust *governance.TrustLevel
	budgetCat     string
	budgetAmount  float64
	consentAction func(r *http.Request) string
	denyHandler   http.Handler
}

// WithHTTPActionFunc sets a function that derives the action name from the
// incoming request. Defaults to using r.Method + " " + r.URL.Path.
func WithHTTPActionFunc(fn func(r *http.Request) string) MiddlewareOption {
	return func(c *middlewareConfig) { c.actionFunc = fn }
}

// WithHTTPAgentHeader sets the name of the HTTP header from which the agent ID
// is read. Defaults to "X-Agent-ID". An empty header value in the request
// causes the engine's DefaultAgentID to be used.
func WithHTTPAgentHeader(header string) MiddlewareOption {
	return func(c *middlewareConfig) { c.agentHeader = header }
}

// WithHTTPRequiredTrust gates every request on the agent meeting the given
// trust level.
func WithHTTPRequiredTrust(level governance.TrustLevel) MiddlewareOption {
	return func(c *middlewareConfig) { c.requiredTrust = &level }
}

// WithHTTPBudgetCheck gates every request on the budget envelope for category
// having at least amount remaining.
func WithHTTPBudgetCheck(category string, amount float64) MiddlewareOption {
	return func(c *middlewareConfig) {
		c.budgetCat = category
		c.budgetAmount = amount
	}
}

// WithHTTPConsentAction sets a function that derives the consent action from
// the request. When set, a consent check is performed on every request.
func WithHTTPConsentAction(fn func(r *http.Request) string) MiddlewareOption {
	return func(c *middlewareConfig) { c.consentAction = fn }
}

// WithHTTPDenyHandler sets a custom http.Handler invoked when the governance
// check denies a request. Defaults to responding 403 Forbidden with a plain
// text body containing the denial reason.
func WithHTTPDenyHandler(h http.Handler) MiddlewareOption {
	return func(c *middlewareConfig) { c.denyHandler = h }
}

// GovernanceMiddleware returns an HTTP middleware that runs governance checks
// on every inbound request before passing control to the next handler.
//
// When a check fails the middleware responds with 403 Forbidden (or calls the
// custom deny handler if one was configured) and does not call next.ServeHTTP.
//
// The governance Decision is stored in the request context under the key
// DecisionContextKey and is accessible to downstream handlers.
func GovernanceMiddleware(engine *governance.GovernanceEngine, opts ...MiddlewareOption) func(http.Handler) http.Handler {
	cfg := &middlewareConfig{
		agentHeader: "X-Agent-ID",
		denyHandler: defaultDenyHandler{},
	}
	for _, opt := range opts {
		opt(cfg)
	}
	if cfg.actionFunc == nil {
		cfg.actionFunc = func(r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			action := cfg.actionFunc(r)
			agentID := r.Header.Get(cfg.agentHeader)

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
				consentAction := cfg.consentAction(r)
				if consentAction != "" {
					checkOpts = append(checkOpts, governance.WithConsentCheck(agentID, consentAction))
				}
			}

			decision, err := engine.Check(r.Context(), action, checkOpts...)
			if err != nil {
				http.Error(w, "governance check error: "+err.Error(), http.StatusInternalServerError)
				return
			}

			// Attach the decision to the request context for downstream handlers.
			r = r.WithContext(contextWithDecision(r.Context(), decision))

			if !decision.Permitted {
				cfg.denyHandler.ServeHTTP(w, r)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// DecisionContextKey is the context key under which the governance Decision is
// stored by GovernanceMiddleware. Use DecisionFromContext to retrieve it.
type decisionContextKeyType struct{}

// DecisionContextKey is the exported context key value.
var DecisionContextKey = decisionContextKeyType{}

// contextWithDecision returns a context that carries the governance Decision.
func contextWithDecision(ctx context.Context, decision *governance.Decision) context.Context {
	return context.WithValue(ctx, DecisionContextKey, decision)
}

// DecisionFromContext retrieves the governance Decision stored by
// GovernanceMiddleware. Returns nil when no decision is present.
func DecisionFromContext(r *http.Request) *governance.Decision {
	d, _ := r.Context().Value(DecisionContextKey).(*governance.Decision)
	return d
}

// defaultDenyHandler writes a 403 Forbidden response.
type defaultDenyHandler struct{}

func (defaultDenyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	decision := DecisionFromContext(r)
	reason := "governance check failed"
	if decision != nil {
		reason = decision.Reason
	}
	http.Error(w, reason, http.StatusForbidden)
}

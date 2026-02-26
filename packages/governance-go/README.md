# aumos-trust-sdk-go

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](https://mariadb.com/bsl11/)
[![Go 1.22+](https://img.shields.io/badge/Go-1.22+-00ADD8.svg)](https://go.dev/dl/)

Go SDK for governance-aware cloud-native AI agent applications.

Part of the [AumOS open-source governance stack](https://github.com/aumos-ai).

---

## Overview

`aumos-trust-sdk-go` gives Go applications a sequential governance evaluation
pipeline composed of four independent checks:

| Check | Manager | What it enforces |
|---|---|---|
| Trust | `TrustManager` | Agent has a sufficient trust level to perform the action |
| Budget | `BudgetManager` | Spending envelope has sufficient funds |
| Consent | `ConsentManager` | An active consent grant exists for the (agent, action) pair |
| Audit | `AuditLogger` | Every decision is recorded in a tamper-evident SHA-256 hash chain |

All governance is **static and manual**:
- Trust levels are set by operators. There is no automatic progression.
- Budget envelopes are created once with a fixed limit. There is no adaptive allocation.
- Consent grants are recorded by operators or service policies.

## Features

- **Zero external dependencies** — stdlib only (`context`, `crypto/sha256`, `encoding/json`, `net/http`, `sync`, `time`)
- **Interface-first** — every component is an interface with a default in-memory implementation
- **Concurrent-safe** — all managers use `sync.RWMutex` internally
- **net/http middleware** — drop-in handler wrapper with configurable deny handler
- **gRPC interceptors** — mirror types for both unary and streaming, no grpc import required
- **Hash chain audit log** — SHA-256 linked records for tamper detection

## Installation

```bash
go get github.com/aumos-ai/aumos-sdks/go/governance@latest
```

Requires Go 1.22+.

## Quick start

```go
engine, _ := governance.NewEngine(governance.Config{DefaultScope: "prod"})

// Manually assign trust — always operator-initiated.
engine.Trust.SetLevel(ctx, "agent-1", governance.TrustSuggest, "prod",
    governance.WithAssignedBy("admin"))

// Create a static budget envelope.
engine.Budget.CreateEnvelope(ctx, "llm", 50.0, 30*24*time.Hour)

// Record consent.
engine.Consent.Record(ctx, "agent-1", "summarise_docs", "admin")

// Evaluate.
decision, _ := engine.Check(ctx, "summarise_docs",
    governance.WithAgentID("agent-1"),
    governance.WithRequiredTrust(governance.TrustSuggest),
    governance.WithBudgetCheck("llm", 0.05),
    governance.WithConsentCheck("agent-1", "summarise_docs"),
)
fmt.Println(decision.Permitted) // true
```

See `examples/basic/main.go` for a complete walkthrough.

## Package layout

```
governance/         Core types, managers, engine
middleware/         net/http and gRPC interceptors
storage/            Storage interface and in-memory implementation
examples/
  basic/            Core SDK walkthrough
  http-middleware/  net/http integration
  grpc-server/      gRPC interceptor wiring (build tag: grpc_example)
  k8s-webhook/      Kubernetes validating admission webhook
docs/
  quickstart.md
  kubernetes.md
  grpc-integration.md
```

## HTTP middleware

```go
handler := middleware.GovernanceMiddleware(engine,
    middleware.WithHTTPAgentHeader("X-Agent-ID"),
    middleware.WithHTTPRequiredTrust(governance.TrustSuggest),
    middleware.WithHTTPBudgetCheck("api", 1.0),
)(mux)
```

## gRPC interceptors

The module stays dependency-free by defining mirror types for grpc.
See `docs/grpc-integration.md` for the full wiring pattern.

## Audit log

Every `engine.Check` call writes a record with SHA-256 hash chaining:

```go
records, _ := engine.Audit.Query(ctx, governance.WithDeniedOnly())
```

## License

Business Source License 1.1. See [LICENSE](../../LICENSE).
Copyright (c) 2026 MuVeraAI Corporation.

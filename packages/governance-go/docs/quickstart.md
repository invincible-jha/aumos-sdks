# Quickstart — aumos-trust-sdk-go

## Installation

```bash
go get github.com/aumos-ai/aumos-sdks/go/governance@latest
```

The module has **zero external dependencies**. It uses only the Go standard
library (`context`, `crypto/sha256`, `encoding/json`, `net/http`, `sync`,
`time`, `fmt`, `errors`).

## Minimum Go version

Go 1.22 or later.

---

## Five-minute example

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "github.com/aumos-ai/aumos-sdks/go/governance"
)

func main() {
    ctx := context.Background()

    // 1. Build the engine with default in-memory storage.
    engine, err := governance.NewEngine(governance.Config{
        DefaultScope: "production",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 2. Manually assign trust to an agent.
    _, err = engine.Trust.SetLevel(ctx, "agent-1", governance.TrustSuggest, "production",
        governance.WithAssignedBy("admin"),
    )
    if err != nil {
        log.Fatal(err)
    }

    // 3. Create a budget envelope.
    _, err = engine.Budget.CreateEnvelope(ctx, "llm", 50.0, 30*24*time.Hour)
    if err != nil {
        log.Fatal(err)
    }

    // 4. Record consent.
    err = engine.Consent.Record(ctx, "agent-1", "send_email", "admin")
    if err != nil {
        log.Fatal(err)
    }

    // 5. Evaluate a governed action.
    decision, err := engine.Check(ctx, "send_email",
        governance.WithAgentID("agent-1"),
        governance.WithRequiredTrust(governance.TrustSuggest),
        governance.WithBudgetCheck("llm", 0.05),
        governance.WithConsentCheck("agent-1", "send_email"),
        governance.WithBudgetRecord(), // record spend when permitted
    )
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println("Permitted:", decision.Permitted)
    fmt.Println("Reason:   ", decision.Reason)
}
```

---

## Trust levels

| Constant | Value | Meaning |
|---|---|---|
| `TrustObserver` | 0 | Read-only. No side effects permitted. |
| `TrustMonitor` | 1 | Monitor and alert. No mutations. |
| `TrustSuggest` | 2 | Propose actions. All outputs require human review. |
| `TrustActWithApproval` | 3 | Act, but every action requires human approval. |
| `TrustActAndReport` | 4 | Act autonomously. All actions reported post-hoc. |
| `TrustAutonomous` | 5 | Fully autonomous within scope. |

Trust is always assigned manually by an operator. There is no automatic
trust progression.

---

## Governance pipeline

`engine.Check` evaluates checks sequentially:

```
1. Trust check      (requires WithRequiredTrust)
2. Budget check     (requires WithBudgetCheck)
3. Consent check    (requires WithConsentCheck)
4. Audit log        (always written)
```

The first failing check produces `Permitted: false` immediately. Subsequent
checks are skipped. The audit record is always written, regardless of outcome.

---

## Check options

| Option | Description |
|---|---|
| `WithAgentID(id)` | Agent identity for all checks. |
| `WithScope(scope)` | Override trust scope. |
| `WithRequiredTrust(level)` | Minimum trust level required. |
| `WithBudgetCheck(cat, amount)` | Gate on envelope having `amount` available. |
| `WithBudgetRecord()` | Record the spend when decision is permitted. |
| `WithConsentCheck(agentID, action)` | Gate on active consent existing. |

---

## Custom storage

To use a persistent storage backend, implement
`storage.Storage` and pass it to `governance.NewEngineWithStorage`:

```go
type MyRedisStorage struct { /* ... */ }

func (s *MyRedisStorage) GetTrust(agentID, scope string) (*storage.TrustAssignment, bool) { ... }
// ... implement all 8 methods

engine, err := governance.NewEngineWithStorage(
    governance.Config{},
    &MyRedisStorage{},
)
```

---

## Audit log queries

```go
// All records.
records, _ := engine.Audit.Query(ctx)

// Denied decisions only.
denied, _ := engine.Audit.Query(ctx, governance.WithDeniedOnly())

// Specific agent, last 10.
agentRecords, _ := engine.Audit.Query(ctx,
    governance.WithAgentFilter("agent-1"),
    governance.WithQueryLimit(10),
)

// Time-bounded window.
recent, _ := engine.Audit.Query(ctx,
    governance.WithSinceFilter(time.Now().Add(-1*time.Hour)),
)
```

# @aumos/security-bundle

The complete AI agent security stack in a single install.

Bundles three production-ready packages — trust gating, budget enforcement, and
audit logging — so you can secure an AI agent in minutes rather than managing
three separate dependencies.

---

## What's Included

| Component | Package | What it does |
|-----------|---------|--------------|
| Trust Gate | `@aumos/mcp-trust-gate` / `aumos-governance` | Blocks tool calls that exceed the operator-assigned trust level. Levels are set manually — never computed automatically. |
| Budget Enforcer | `@aumos/budget-enforcer` / `budget-enforcer` | Enforces fixed token and call limits per session. Limits are static — defined at creation and never adjusted. |
| Audit Logger | `@aumos/audit-trail` / `agent-audit-trail` | Appends tamper-evident records of every governance decision. Records only — no analysis or anomaly detection. |

---

## Install

### TypeScript / Node.js

```bash
npm install @aumos/security-bundle @aumos/types
```

### Python

```bash
pip install aumos-security-bundle
```

---

## Quick Start — TypeScript

```typescript
import { createSecurityStack } from '@aumos/security-bundle';

const stack = createSecurityStack({
  trustGate: {
    requiredLevel: 'verified',
    toolName: 'file-reader',
  },
  budget: {
    tokenLimit: 10_000,
    callLimit: 100,
  },
  auditNamespace: 'my-agent.production',
});

// In your tool-call handler:
async function handleToolCall(request: ToolRequest): Promise<ToolResponse> {
  // 1. Check trust level (set by operator, never automatic)
  const trustDecision = stack.trustGate.check(request);
  if (!trustDecision.allowed) {
    stack.audit.log({ event: 'trust-denied', reason: trustDecision.reason });
    throw new Error(`Trust gate denied: ${trustDecision.reason}`);
  }

  // 2. Check budget (static limits, never adaptive)
  const budgetDecision = stack.budget.checkBudget(request.sessionId);
  if (!budgetDecision.allowed) {
    stack.audit.log({ event: 'budget-exceeded', sessionId: request.sessionId });
    throw new Error('Budget limit reached for this session');
  }

  // 3. Execute the tool call
  const result = await executeToolCall(request);

  // 4. Record spending and audit (recording only)
  stack.budget.recordSpending(request.sessionId, result.tokensUsed);
  stack.audit.log({ event: 'tool-call-complete', sessionId: request.sessionId });

  return result;
}
```

---

## Quick Start — Python

```python
from aumos_security import (
    create_security_stack,
    SecurityStackConfig,
    TrustGateConfig,
    BudgetEnforcerConfig,
    AuditRecord,
)

config = SecurityStackConfig(
    trust_gate=TrustGateConfig(required_level="verified", tool_name="file-reader"),
    budget=BudgetEnforcerConfig(token_limit=10_000, call_limit=100),
    audit_namespace="my-agent.production",
)
stack = create_security_stack(config)

# In your tool-call handler:
def handle_tool_call(request: ToolRequest) -> ToolResponse:
    # 1. Check trust level (operator-set, never automatic)
    trust_decision = stack.trust_gate.check(request)
    if not trust_decision.allowed:
        stack.audit.log(AuditRecord(event="trust-denied", reason=trust_decision.reason))
        raise PermissionError(f"Trust gate denied: {trust_decision.reason}")

    # 2. Check budget (static limits, never adaptive)
    budget_decision = stack.budget.check_budget(request.session_id)
    if not budget_decision.allowed:
        stack.audit.log(AuditRecord(event="budget-exceeded", session_id=request.session_id))
        raise RuntimeError("Budget limit reached for this session")

    # 3. Execute
    result = execute_tool_call(request)

    # 4. Record spending and audit (recording only)
    stack.budget.record_spending(request.session_id, result.tokens_used)
    stack.audit.log(AuditRecord(event="tool-call-complete", session_id=request.session_id))

    return result
```

---

## Component Details

### Trust Gate

Enforces access control based on a static trust level assigned to an agent or
session by an operator. Trust levels are never computed or promoted automatically.

```typescript
stack.trustGate.check(request)  // returns GovernanceDecision
```

See [`@aumos/mcp-trust-gate` docs](../trust-ladder/typescript/README.md) for full API.

### Budget Enforcer

Tracks token and call consumption against fixed per-session limits. Limits are
set when the budget is created and never modified by the system.

```typescript
stack.budget.checkBudget(sessionId)              // returns GovernanceDecision
stack.budget.recordSpending(sessionId, tokens)   // records usage
```

See [`@aumos/budget-enforcer` docs](../budget-enforcer/typescript/README.md) for full API.

### Audit Logger

Appends tamper-evident records to an in-memory log. Supports structured queries
for inspection. Records are immutable once written.

```typescript
stack.audit.log(record)    // append a record
stack.audit.query(filter)  // retrieve records
```

See [`@aumos/audit-trail` docs](../audit-trail/typescript/README.md) for full API.

---

## Full Documentation

- AumOS SDK docs: https://docs.aumos.ai/sdks
- GitHub: https://github.com/aumos-ai/aumos-sdks

---

## License

BSL-1.1. Copyright (c) 2026 MuVeraAI Corporation.

Production use requires a commercial license from MuVeraAI Corporation after the
BSL change date. See [LICENSE](./LICENSE) for details.

# aumos-governance — API Reference

## Overview

The `aumos-governance` package exposes four independent managers and a
`GovernanceEngine` that composes them into a single evaluation pipeline.

All classes are importable from the top-level `aumos_governance` package.

---

## TrustLevel

```python
from aumos_governance import TrustLevel
```

An `IntEnum` representing the six trust tiers:

| Value | Name | Label |
|-------|------|-------|
| 0 | `L0_OBSERVER` | Observer |
| 1 | `L1_MONITOR` | Monitor |
| 2 | `L2_SUGGEST` | Suggest |
| 3 | `L3_ACT_APPROVE` | Act (Approval Required) |
| 4 | `L4_ACT_REPORT` | Act (Report After) |
| 5 | `L5_AUTONOMOUS` | Autonomous |

Higher values indicate broader operational permissions.
Trust levels are always assigned manually — there is no automatic promotion.

---

## TrustManager

```python
from aumos_governance import TrustManager, TrustConfig, SetLevelOptions
```

### `set_level(agent_id, level, scope=None, options=None)`

Manually assign a trust level to an agent.

- `agent_id: str` — unique agent identifier
- `level: TrustLevel` — the level to assign
- `scope: str | None` — optional scope; when given, applies only in that scope
- `options: SetLevelOptions | None` — optional metadata (`assigned_by`, `force`)

Raises `ValueError` if `agent_id` is empty.

### `get_level(agent_id, scope=None) -> TrustLevel`

Return the effective trust level. Scoped entry takes precedence over global.
Applies decay if `TrustConfig.enable_decay` is True.

### `check_level(agent_id, required_level, scope=None) -> TrustCheckResult`

Non-raising check. Returns `TrustCheckResult` with `allowed: bool` and `reason: str`.

### `require_level(agent_id, required_level, scope=None)`

Raises `TrustLevelError` if the agent does not meet `required_level`.

### `touch(agent_id, scope=None)`

Update the `last_active` timestamp (resets decay timer).

### `remove(agent_id, scope=None) -> bool`

Remove a trust assignment. Returns `True` if removed.

### `list_agents() -> list[str]`

Return all agent IDs with stored assignments.

---

## BudgetManager

```python
from aumos_governance import BudgetManager, BudgetConfig
```

### `create_budget(category, limit, period="monthly")`

Create a static budget envelope.

- `category: str` — unique category name
- `limit: float` — maximum spend per period (>= 0)
- `period: str` — one of `'daily'`, `'weekly'`, `'monthly'`, `'yearly'`, `'lifetime'`

Raises `InvalidPeriodError` for unrecognised period strings.

### `record_spending(category, amount, description=None) -> SpendingTransaction`

Record a spending transaction. If overdraft is disabled and `amount` would
exceed the limit, raises `BudgetExceededError` without mutating state.
Auto-resets the period if it has elapsed.

### `check_budget(category, amount) -> BudgetCheckResult`

Read-only check. Returns `BudgetCheckResult` with `allowed: bool`, `available: float`.

Raises `BudgetNotFoundError` if category does not exist.

### `get_utilization(category) -> float`

Return fraction consumed (0.0–1.0+).

### `list_categories() -> list[str]`

Return all registered category names.

### `summary() -> list[dict]`

Return a list of snapshot dicts for all budget envelopes.

---

## ConsentManager

```python
from aumos_governance import ConsentManager, ConsentConfig
```

### `record_consent(agent_id, data_type, purpose, granted_by, expires_at=None) -> ConsentRecord`

Record explicit consent. Replaces any existing record for the same
`(agent_id, data_type, purpose)` triple.

- `purpose=None` records blanket consent covering all purposes.

### `check_consent(agent_id, data_type, purpose=None) -> ConsentCheckResult`

Read-only check. Returns `ConsentCheckResult` with `granted: bool`.

Lookup: exact `(agent_id, data_type, purpose)` first, then blanket
`(agent_id, data_type, None)`.

### `revoke_consent(agent_id, data_type, purpose=None)`

Remove a consent record. Raises `ConsentNotFoundError` if not found.

### `revoke_all_for_agent(agent_id) -> int`

Remove all consent records for an agent. Returns count removed.

### `list_consents(agent_id) -> list[ConsentRecord]`

Return all records (including expired) for an agent.

---

## AuditLogger

```python
from aumos_governance import AuditLogger, AuditConfig
```

Audit logging is **recording only**. No analysis, anomaly detection, or
inference occurs.

### `log(outcome, decision, reasons=None, context=None) -> AuditRecord`

Record a governance decision.

- `outcome: GovernanceOutcome` — `ALLOW`, `DENY`, or `ALLOW_WITH_CAVEAT`
- `decision: str` — concise summary of the decision
- `reasons: list[str] | None` — collected reason strings
- `context: GovernanceDecisionContext | None` — structured metadata

### `query(audit_filter=None) -> AuditQueryResult`

Query stored records. `None` returns all records.

See `AuditFilter` for supported criteria:
`agent_id`, `outcome`, `action_type`, `since`, `until`, `resource`, `limit`, `offset`.

### `count() -> int`

Return total stored records.

### `clear() -> int`

Remove all records. Returns count cleared.

### `latest(n=10) -> list[AuditRecord]`

Return the `n` most recent records.

---

## GovernanceEngine

```python
from aumos_governance import GovernanceEngine, GovernanceConfig
```

### Constructor

```python
engine = GovernanceEngine(config=GovernanceConfig())
```

Exposes `engine.trust`, `engine.budget`, `engine.consent`, `engine.audit`
as public attributes.

### `await engine.evaluate(action) -> GovernanceDecision`

Evaluate a `GovernanceAction` asynchronously. Sequential pipeline:
1. Trust check (if `required_trust_level` set)
2. Budget check (if `budget_category` set)
3. Consent check (if `data_type` set)
4. Audit record written (always)

Returns immediately on first failing check with `outcome=DENY`.

### `engine.evaluate_sync(action) -> GovernanceDecision`

Synchronous wrapper. Safe to call from non-async contexts.

### GovernanceAction fields

| Field | Type | Description |
|-------|------|-------------|
| `agent_id` | `str` | Required — the acting agent |
| `required_trust_level` | `TrustLevel \| None` | Minimum trust required |
| `scope` | `str \| None` | Scope for trust check |
| `budget_category` | `str \| None` | Budget category to check |
| `budget_amount` | `float \| None` | Amount to check against budget |
| `data_type` | `str \| None` | Data type to check consent for |
| `purpose` | `str \| None` | Purpose for consent check |
| `action_type` | `str \| None` | Descriptor stored in audit context |
| `resource` | `str \| None` | Resource descriptor for audit |
| `extra` | `dict` | Additional audit metadata |

---

## Error Reference

| Exception | Code | When raised |
|-----------|------|-------------|
| `AumOSGovernanceError` | base | Base for all SDK errors |
| `TrustLevelError` | `TRUST_LEVEL_INSUFFICIENT` | `require_level()` fails |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | Spending would exceed limit |
| `BudgetNotFoundError` | `BUDGET_NOT_FOUND` | Category does not exist |
| `ConsentDeniedError` | `CONSENT_DENIED` | Consent check fails (not raised by default; use check_consent) |
| `ConsentNotFoundError` | `CONSENT_NOT_FOUND` | Revocation target not found |
| `ConfigurationError` | `CONFIGURATION_ERROR` | Misconfigured SDK |
| `InvalidPeriodError` | `INVALID_PERIOD` | Unrecognised period string |

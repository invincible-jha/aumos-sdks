# aumos-governance — Configuration Guide

## GovernanceConfig

The top-level configuration object accepted by `GovernanceEngine`.

```python
from aumos_governance import GovernanceConfig
from aumos_governance.config import TrustConfig, BudgetConfig, ConsentConfig, AuditConfig

config = GovernanceConfig(
    trust=TrustConfig(...),
    budget=BudgetConfig(...),
    consent=ConsentConfig(...),
    audit=AuditConfig(...),
)
engine = GovernanceEngine(config=config)
```

All fields have sensible defaults — you only need to override what you change.

---

## TrustConfig

```python
TrustConfig(
    default_level=1,          # TrustLevel assigned to unknown agents (0–5)
    enable_decay=False,       # Enable time-based trust decay
    decay_cliff_days=90,      # Days inactive before cliff drop (None = disabled)
    decay_gradual_days=30,    # Days inactive before gradual drop (None = disabled)
)
```

### Trust Decay

When `enable_decay=True`, `get_level()` applies decay before returning:

- **Cliff decay**: After `decay_cliff_days` days of inactivity, the level
  drops by one tier. This is a hard signal — e.g. an agent that has been
  dormant for a quarter is no longer trusted at its previous level until
  re-assigned by an administrator.

- **Gradual decay**: After `decay_gradual_days` days, the level drops by
  one tier (softer signal). If both thresholds are crossed, cliff decay
  takes precedence.

Only one reduction is applied per `get_level()` call regardless of how
long the agent has been inactive. Level can never decay below `L0_OBSERVER`.

Update `last_active` by calling `trust.touch(agent_id)` after successful actions.

---

## BudgetConfig

```python
BudgetConfig(
    allow_overdraft=False,    # Allow spending beyond the limit
    rollover_on_reset=False,  # Carry unspent budget to next period (capped at 2x)
)
```

### Overdraft Mode

When `allow_overdraft=True`, `record_spending()` will succeed even when
the envelope is exhausted. `check_budget()` still returns `allowed=False`
for amounts exceeding the remaining budget, so the engine will still deny
actions — but manual calls to `record_spending()` bypass this.

### Rollover

When `rollover_on_reset=True` and a period resets, unspent budget from the
previous period is added to the new period's limit. The effective limit is
capped at `2 * base_limit` to prevent unlimited accumulation.

### Period Reference

| Period | Resets |
|--------|--------|
| `daily` | Each calendar day |
| `weekly` | Each Monday |
| `monthly` | First day of each month |
| `yearly` | January 1st each year |
| `lifetime` | Never resets |

---

## ConsentConfig

```python
ConsentConfig(
    default_deny=True,        # Deny when no consent record exists
)
```

### Default Deny (Recommended)

When `default_deny=True` (the default), the absence of a consent record
is treated as a denial. This is the safe production default.

When `default_deny=False`, the absence of a record is treated as implicit
approval (permissive mode). Only use this during development or in
environments where all data access is considered pre-approved.

---

## AuditConfig

```python
AuditConfig(
    max_records=10_000,       # Maximum records retained in memory
    include_context=True,     # Store full GovernanceDecisionContext with each record
)
```

### Memory Budget

Audit records are stored in a bounded `collections.deque`. When
`max_records` is reached, the oldest record is evicted automatically.
Size the limit based on your available memory and query access patterns.

A single `AuditRecord` with context is approximately 1–2 KB in memory.
`max_records=10_000` is therefore roughly 10–20 MB of audit storage.

### Context Storage

When `include_context=False`, the `context` field on each record is set to
`None` before storage. This reduces memory usage but disables per-record
filtering by `agent_id`, `action_type`, and `resource` in `AuditFilter`.

---

## Environment-Specific Presets

### Development

```python
config = GovernanceConfig(
    trust=TrustConfig(default_level=3, enable_decay=False),
    consent=ConsentConfig(default_deny=False),
    audit=AuditConfig(max_records=500, include_context=True),
)
```

### Production

```python
config = GovernanceConfig(
    trust=TrustConfig(default_level=1, enable_decay=True),
    budget=BudgetConfig(allow_overdraft=False, rollover_on_reset=False),
    consent=ConsentConfig(default_deny=True),
    audit=AuditConfig(max_records=50_000, include_context=True),
)
```

### Testing

```python
config = GovernanceConfig(
    trust=TrustConfig(default_level=5, enable_decay=False),
    budget=BudgetConfig(allow_overdraft=True),
    consent=ConsentConfig(default_deny=False),
    audit=AuditConfig(max_records=100, include_context=False),
)
```

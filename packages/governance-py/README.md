# aumos-governance

Python SDK for building governance-aware AI agent applications.

Part of the [AumOS](https://github.com/aumos-ai) open-source governance protocol suite.

[![PyPI](https://img.shields.io/pypi/v/aumos-governance)](https://pypi.org/project/aumos-governance/)
[![Python](https://img.shields.io/pypi/pyversions/aumos-governance)](https://pypi.org/project/aumos-governance/)
[![License: BSL-1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](../../LICENSE)

---

## Installation

```bash
pip install aumos-governance
```

Requires Python 3.10+. The only runtime dependency is [Pydantic v2](https://docs.pydantic.dev/latest/).

---

## Quick Start

```python
import asyncio
from aumos_governance import (
    GovernanceEngine,
    GovernanceAction,
    GovernanceConfig,
    TrustLevel,
)

async def main():
    engine = GovernanceEngine()

    # Assign trust levels manually — no automatic promotion.
    engine.trust.set_level("my-agent", TrustLevel.L3_ACT_APPROVE)

    # Create a static budget envelope.
    engine.budget.create_budget("llm-calls", limit=100.0, period="monthly")

    # Record explicit consent.
    engine.consent.record_consent(
        agent_id="my-agent",
        data_type="user_profile",
        purpose="personalisation",
        granted_by="admin@example.com",
    )

    # Evaluate an action through the full pipeline.
    decision = await engine.evaluate(GovernanceAction(
        agent_id="my-agent",
        required_trust_level=TrustLevel.L2_SUGGEST,
        budget_category="llm-calls",
        budget_amount=1.5,
        data_type="user_profile",
        purpose="personalisation",
        action_type="llm_completion",
    ))

    print(decision.allowed)          # True
    print(decision.outcome)          # allow
    print(decision.audit_record_id)  # uuid

asyncio.run(main())
```

Or use the synchronous wrapper:

```python
decision = engine.evaluate_sync(action)
```

---

## Core Components

### GovernanceEngine

Composes all four managers into a sequential evaluation pipeline:

1. **Trust check** — is the agent's trust level sufficient?
2. **Budget check** — is there budget remaining?
3. **Consent check** — has consent been granted for this data access?
4. **Audit record** — always written regardless of outcome.

```python
engine = GovernanceEngine(config=GovernanceConfig(...))
engine.trust   # TrustManager
engine.budget  # BudgetManager
engine.consent # ConsentManager
engine.audit   # AuditLogger
```

### TrustManager

Manages manual trust level assignments with optional time-based decay.

```python
engine.trust.set_level("agent-id", TrustLevel.L3_ACT_APPROVE)
result = engine.trust.check_level("agent-id", TrustLevel.L2_SUGGEST)
# result.allowed → True
```

Trust levels are **always assigned manually**. The SDK has no automatic
promotion, behavioral scoring, or adaptive trust mechanism.

### BudgetManager

Manages static per-category spending budgets with period resets.

```python
engine.budget.create_budget("tools", limit=50.0, period="daily")
engine.budget.record_spending("tools", 2.5, description="web search")
result = engine.budget.check_budget("tools", 10.0)
# result.allowed → True
# result.available → 47.5
```

Budget allocations are **always static**. There is no adaptive limit
adjustment or spending prediction.

### ConsentManager

Records and checks explicit consent for agent data access.

```python
engine.consent.record_consent(
    agent_id="agent-id",
    data_type="user_email",
    purpose="notifications",
    granted_by="data-owner",
)
result = engine.consent.check_consent("agent-id", "user_email", "notifications")
# result.granted → True
```

Consent records with `purpose=None` cover all purposes for that
agent + data type combination.

### AuditLogger

Records governance decisions as immutable audit records.
Audit logging is **recording only** — no analysis or inference.

```python
from aumos_governance import AuditFilter, GovernanceOutcome

results = engine.audit.query(
    AuditFilter(agent_id="agent-id", outcome=GovernanceOutcome.DENY)
)
for record in results.records:
    print(record.record_id, record.decision)
```

---

## Configuration

```python
from aumos_governance import GovernanceConfig
from aumos_governance.config import TrustConfig, BudgetConfig, ConsentConfig, AuditConfig

config = GovernanceConfig(
    trust=TrustConfig(
        default_level=1,
        enable_decay=True,
        decay_cliff_days=90,
    ),
    budget=BudgetConfig(
        allow_overdraft=False,
        rollover_on_reset=False,
    ),
    consent=ConsentConfig(default_deny=True),
    audit=AuditConfig(max_records=10_000),
)
engine = GovernanceEngine(config=config)
```

See [docs/configuration.md](docs/configuration.md) for full reference.

---

## Examples

| File | Description |
|------|-------------|
| [examples/basic_governance.py](examples/basic_governance.py) | Basic engine usage with all three check types |
| [examples/fastapi_middleware.py](examples/fastapi_middleware.py) | FastAPI middleware integration |
| [examples/multi_agent.py](examples/multi_agent.py) | Scoped trust, shared budgets, consent matrix |

---

## Development

```bash
pip install -e ".[dev]"

# Lint
ruff check src/

# Type check
mypy src/

# Tests
pytest
```

---

## License

Business Source License 1.1. See [LICENSE](../../LICENSE) for details.

Copyright (c) 2026 MuVeraAI Corporation

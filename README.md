# AumOS SDKs

Official SDKs and governance libraries for building AumOS-compliant AI agent applications.

## Packages

| Package | npm / PyPI | License | Description |
|---|---|---|---|
| `@aumos/governance` | [npm](https://www.npmjs.com/package/@aumos/governance) | BSL 1.1 | TypeScript SDK for governance-aware AI agents |
| `aumos-governance` | [PyPI](https://pypi.org/project/aumos-governance/) | BSL 1.1 | Python SDK for governance-aware AI agents |
| `@aumos/trust-ladder` | [npm](https://www.npmjs.com/package/@aumos/trust-ladder) | BSL 1.1 | 6-level graduated autonomy with trust decay |
| `trust-ladder` | [PyPI](https://pypi.org/project/trust-ladder/) | BSL 1.1 | Python trust ladder implementation |
| `@aumos/audit-trail` | [npm](https://www.npmjs.com/package/@aumos/audit-trail) | Apache 2.0 | Immutable hash-chained decision logging |
| `agent-audit-trail` | [PyPI](https://pypi.org/project/agent-audit-trail/) | Apache 2.0 | Python audit trail implementation |
| `@aumos/budget-enforcer` | [npm](https://www.npmjs.com/package/@aumos/budget-enforcer) | BSL 1.1 | Economic governance and spending limits |
| `budget-enforcer` | [PyPI](https://pypi.org/project/budget-enforcer/) | BSL 1.1 | Python budget enforcer implementation |

## Quick Start

### TypeScript

```typescript
import { GovernanceEngine } from '@aumos/governance';

const engine = new GovernanceEngine({
  trust: { defaultLevel: 2 },
  budget: { dailyLimitUsd: 50 },
});

const decision = await engine.evaluate({
  action: 'send_email',
  agentId: 'agent-001',
  estimatedCostUsd: 0.05,
});

if (decision.permitted) {
  // proceed with action
}
```

### Python

```python
from aumos_governance import GovernanceEngine, GovernanceConfig

engine = GovernanceEngine(GovernanceConfig(
    trust=TrustConfig(default_level=2),
    budget=BudgetConfig(daily_limit_usd=50.0),
))

decision = await engine.evaluate(GovernanceAction(
    action="send_email",
    agent_id="agent-001",
    estimated_cost_usd=0.05,
))

if decision.permitted:
    # proceed with action
    ...
```

## Architecture

All SDKs follow the same governance evaluation pipeline:

1. **Trust Check** - Is the agent's trust level sufficient for this action?
2. **Budget Check** - Does the agent have remaining budget for this action?
3. **Consent Check** - Has the required consent been recorded?
4. **Audit Log** - Record the governance decision

## Documentation

- [AumOS Documentation](https://docs.aumos.ai)
- [Protocol Specifications](https://github.com/aumos-ai/aumos-core/tree/main/packages/specs)
- [Type Definitions](https://github.com/aumos-ai/aumos-core/tree/main/packages/types)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

## License

SDK packages are licensed under BSL 1.1 (converts to Apache 2.0 after 36 months).
The audit-trail package is licensed under Apache 2.0.

Copyright (c) 2026 MuVeraAI Corporation

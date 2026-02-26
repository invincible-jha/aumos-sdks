# CLAUDE.md — aumos-sdks Monorepo

## Repository Identity

**aumos-sdks** is the SDK and library monorepo for AumOS governance tools.
GitHub org: `aumos-ai` | npm scope: `@aumos` | PyPI prefix: `aumos-`

## Package Structure

```
aumos-sdks/
  packages/
    governance-ts/           # @aumos/governance — TypeScript SDK (BSL 1.1)
    governance-py/           # aumos-governance — Python SDK (BSL 1.1)
    trust-ladder/            # @aumos/trust-ladder + trust-ladder (BSL 1.1)
      typescript/
      python/
    audit-trail/             # @aumos/audit-trail + agent-audit-trail (Apache 2.0)
      typescript/
      python/
    budget-enforcer/         # @aumos/budget-enforcer + budget-enforcer (BSL 1.1)
      typescript/
      python/
```

## The Fire Line — Absolute Rule

**Read [FIRE_LINE.md](FIRE_LINE.md) before writing anything.**

Key SDK rules:
- TrustManager: `setLevel()`, `getLevel()`, `checkLevel()` ONLY
- BudgetManager: `createBudget()`, `recordSpending()`, `checkBudget()` ONLY
- ConsentManager: `recordConsent()`, `checkConsent()`, `revokeConsent()` ONLY
- AuditLogger: `log()`, `query()` ONLY
- GovernanceEngine: Sequential evaluation ONLY
- ALL storage: in-memory ONLY

Run `npm run fire-line-audit` before every commit.

## Build Commands

### Root workspace
```bash
npm install
npm run build
npm run typecheck
npm run lint
npm run test
npm run fire-line-audit
```

### TypeScript packages
```bash
npm run build             # tsup — CJS + ESM + .d.ts
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint 9 flat config
```

### Python packages
```bash
pip install -e ".[dev]"
ruff check src/
mypy src/
pytest
```

## Code Standards

### TypeScript
- Strict mode, no `any`, use `unknown` and narrow
- Named exports, Zod for runtime validation
- ESLint 9 flat config, zero warnings
- Vitest for tests, tsup for bundling
- License header: `// SPDX-License-Identifier: BSL-1.1`

### Python
- Python 3.10+, type hints on every function
- Pydantic v2, ruff, mypy --strict, pytest
- License header: `# SPDX-License-Identifier: BSL-1.1`

## Commit Convention

```
feat(governance-ts): description
fix(trust-ladder): description
docs(audit-trail): description
test(budget-enforcer): description
```

---

Copyright (c) 2026 MuVeraAI Corporation

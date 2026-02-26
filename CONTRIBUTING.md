# Contributing to AumOS SDKs

Thank you for your interest in contributing to the AumOS SDK ecosystem.

## Before You Start

1. **Read [FIRE_LINE.md](FIRE_LINE.md)** — understand what is and is not in scope
2. **Sign the CLA** — all contributions require a signed Contributor License Agreement
3. **Check existing issues** — your idea may already be tracked

## Development Setup

### TypeScript packages

```bash
npm install
npm run build
npm run test
```

### Python packages

```bash
cd packages/<package>/python
pip install -e ".[dev]"
pytest
```

## Pull Request Process

1. Create a feature branch from `main`
2. Write implementation with tests
3. Run `npm run fire-line-audit` — must pass with zero violations
4. Submit PR using the template
5. Address review feedback

## Fire Line Compliance

Every PR must pass the fire line audit. The CI will reject any PR containing forbidden identifiers or patterns.

---

Copyright (c) 2026 MuVeraAI Corporation

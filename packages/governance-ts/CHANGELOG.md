# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-28

### Added
- Initial release
- Core functionality implementation
- `GovernanceEngine` composing trust, budget, consent, and audit into a sequential pipeline
- `TrustManager` with manual-only level assignment and optional expiry
- `BudgetManager` for static per-category spending envelopes (deprecated; use `@aumos/budget-enforcer`)
- `ConsentManager` for recording and enforcing data access consent
- `AuditLogger` with append-only in-memory record store and query support
- Zod-validated configuration schemas for all sub-managers
- Vercel AI SDK, OpenAI, Anthropic, Express, Fastify, and Hono integrations
- Governed streaming with mid-stream budget enforcement
- BSL-1.1 license

### Deprecated
- `BudgetManager` — use `BudgetEnforcer` from `@aumos/budget-enforcer` instead.
  `BudgetEnforcer` provides commit/release semantics and envelope suspension.
  `BudgetManager` will be removed in v1.0.

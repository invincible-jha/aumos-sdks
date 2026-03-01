# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-28

### Added
- Initial release
- Core functionality implementation
- `GovernanceEngine` composing trust, budget, consent, and audit into a sequential pipeline
- `TrustManager` with manual-only level assignment
- `BudgetManager` for static per-category spending envelopes
- `ConsentManager` for recording and enforcing data access consent
- `AuditLogger` with bounded in-memory deque and query filtering
- Pydantic v2 models for all structured data
- Jupyter notebook extension for interactive governance exploration
- BSL-1.1 license

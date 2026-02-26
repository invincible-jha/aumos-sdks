# Compliance Guide

## Purpose

`@aumos/audit-trail` / `agent-audit-trail` provides the logging substrate for
AI agent governance compliance.  It records **decisions** — what an agent was
permitted or denied to do, at what trust level, and why — and chains them
cryptographically so the record is tamper-evident.

This document maps the package capabilities to common compliance requirements.

## What is logged

Each `AuditRecord` captures:

| Field             | Description                                           |
| ----------------- | ----------------------------------------------------- |
| `id`              | Unique record identifier (UUID v4)                    |
| `timestamp`       | UTC ISO 8601 time of the decision                     |
| `agentId`         | Identifier of the agent that requested the action     |
| `action`          | The action that was evaluated                         |
| `permitted`       | Whether the action was allowed                        |
| `trustLevel`      | Agent's current trust level at decision time          |
| `requiredLevel`   | Minimum trust level required for the action           |
| `budgetUsed`      | Spend consumed by this action (optional)              |
| `budgetRemaining` | Remaining budget after this action (optional)         |
| `reason`          | Human-readable rationale for the decision             |
| `metadata`        | Arbitrary structured context (invoice IDs, etc.)      |
| `previousHash`    | SHA-256 of the preceding record (chain link)          |
| `recordHash`      | SHA-256 of this record (tamper evidence)              |

## What is NOT logged

By design, the following are outside the scope of this package:

- **Reasoning traces** — the internal deliberation of the agent.
- **Counterfactual analysis** — "what would have happened if…" scenarios.
- **Anomaly detection** — pattern-based analysis of decisions.
- **Cross-agent correlation** — this is a single-agent trail.

## Tamper evidence

The SHA-256 hash chain provides tamper evidence:

- Any modification to a past record breaks its hash and every subsequent hash.
- Deletions from the middle of the chain break the `previousHash` linkage.
- `AuditLogger.verify()` / `logger.verify()` re-derives all hashes in O(n)
  time and returns the index and reason for the first detected discrepancy.

Run `verify()` periodically and store the result out-of-band (e.g., database,
signed ledger) to establish a trusted checkpoint.

## Retention

The package itself does not enforce retention periods.  Operators should:

1. Use `FileStorage` (or a custom `AuditStorage` implementation) backed by
   append-only, immutable object storage (S3 Object Lock, Azure Immutable
   Blob Storage).
2. Set retention policies at the storage layer in accordance with applicable
   regulatory requirements.
3. Rotate log files on a schedule (daily or by size) and archive completed
   files with their final `recordHash` recorded externally as a checkpoint.

## Access control

The package makes no access-control decisions.  Operators must:

- Restrict write access to the log file / storage backend to the process
  running the agent only.
- Restrict read access to auditors and compliance tooling.
- Never expose the raw log over an unauthenticated network endpoint.

## Export for regulators

Use `exportRecords("json")` or `exportRecords("csv")` to produce portable
evidence packages.  Use `exportRecords("cef")` to integrate with SIEM platforms
that regulators may require access to (e.g., SOC 2 evidence requests).

## EU AI Act / ISO 42001 alignment

The package supports the following obligations:

| Obligation                        | How this package helps                          |
| --------------------------------- | ----------------------------------------------- |
| Log high-risk AI system decisions | `log()` records every governance decision       |
| Maintain traceability             | Hash chain provides cryptographic ordering      |
| Enable auditor review             | `query()` and export to JSON/CSV/CEF            |
| Non-repudiation                   | Immutable records with hash linkage             |
| Incident investigation            | Time-range and agent-scoped queries             |

> This package is infrastructure, not a compliance certification.  Engage your
> legal and compliance teams to map these capabilities to your specific
> regulatory obligations.

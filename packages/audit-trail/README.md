# @aumos/audit-trail / agent-audit-trail

Immutable, hash-chained decision logging for AI agent governance compliance.

Part of the [AumOS](https://github.com/aumos-ai) open governance protocol suite.

**License:** Apache 2.0

---

## What it does

Records governance decisions made about AI agents — what actions were permitted
or denied, at what trust level, with what budget impact — and chains every
record to its predecessor with SHA-256.  Any retrospective modification to any
record breaks the chain and is detectable by `verify()`.

## What it does NOT do

- No anomaly detection
- No counterfactual analysis
- No real-time alerting
- No cross-agent correlation

This is a logger.  Analysis belongs in your product stack.

---

## TypeScript

### Install

```bash
npm install @aumos/audit-trail
```

### Quick start

```typescript
import { AuditLogger } from "@aumos/audit-trail";

const logger = new AuditLogger();

// Log a governance decision
const record = await logger.log({
  agentId: "agent-crm-001",
  action: "send_email",
  permitted: true,
  trustLevel: 3,
  requiredLevel: 3,
  budgetUsed: 0.02,
  budgetRemaining: 9.98,
  reason: "Action permitted within budget",
});

console.log(record.recordHash); // SHA-256 hex digest

// Verify chain integrity
const result = await logger.verify();
// => { valid: true, recordCount: 1 }

// Query denied decisions
const denied = await logger.query({ permitted: false });

// Export to CEF for Splunk / ELK
const cef = await logger.exportRecords("cef");
```

### File storage (persistent)

```typescript
import { AuditLogger, FileStorage } from "@aumos/audit-trail";

const storage = new FileStorage("./audit.ndjson");
const logger = new AuditLogger({ storage });
```

---

## Python

### Install

```bash
pip install agent-audit-trail
```

### Quick start

```python
import asyncio
from audit_trail import AuditLogger, GovernanceDecisionInput, AuditFilter

async def main():
    logger = AuditLogger()

    record = await logger.log(GovernanceDecisionInput(
        agent_id="agent-crm-001",
        action="send_email",
        permitted=True,
        trust_level=3,
        required_level=3,
        budget_used=0.02,
        budget_remaining=9.98,
        reason="Action permitted within budget",
    ))

    print(record.record_hash)  # SHA-256 hex digest

    result = await logger.verify()
    # => ChainVerificationSuccess(valid=True, record_count=1)

    denied = await logger.query(AuditFilter(permitted=False))
    cef = await logger.export_records("cef")

asyncio.run(main())
```

### File storage (persistent)

```python
from audit_trail import AuditLogger, FileStorage

storage = FileStorage("./audit.ndjson")
logger = AuditLogger(storage=storage)
```

---

## API Reference

### `AuditLogger`

| Method | Description |
|---|---|
| `log(decision)` | Record a governance decision; returns the completed `AuditRecord` |
| `query(filter)` | Filter and retrieve records |
| `verify()` | Walk the full chain and detect any tampering |
| `exportRecords(format, filter?)` | Export to `"json"`, `"csv"`, or `"cef"` |
| `count()` | Total number of records |

### `AuditRecord` fields

| Field | Type | Required |
|---|---|---|
| `id` | string | always |
| `timestamp` | ISO 8601 string | always |
| `agentId` / `agent_id` | string | always |
| `action` | string | always |
| `permitted` | boolean | always |
| `trustLevel` / `trust_level` | number | optional |
| `requiredLevel` / `required_level` | number | optional |
| `budgetUsed` / `budget_used` | number | optional |
| `budgetRemaining` / `budget_remaining` | number | optional |
| `reason` | string | optional |
| `metadata` | object | optional |
| `previousHash` / `previous_hash` | string (64 hex chars) | always |
| `recordHash` / `record_hash` | string (64 hex chars) | always |

### `AuditFilter`

All fields optional:

| Field | Type | Description |
|---|---|---|
| `agentId` / `agent_id` | string | Exact match |
| `action` | string | Exact match |
| `permitted` | boolean | Filter by outcome |
| `startTime` / `start_time` | ISO 8601 string | Inclusive lower bound |
| `endTime` / `end_time` | ISO 8601 string | Inclusive upper bound |
| `limit` | number | Max records to return |
| `offset` | number | Skip first N records |

### Storage backends

| Class | Description |
|---|---|
| `MemoryStorage` | Default; volatile, in-process |
| `FileStorage` | Append-only NDJSON file |

Implement `AuditStorage` to add your own backend (database, S3, etc.).

---

## Export formats

See [docs/export-formats.md](docs/export-formats.md) for full format specs.

- **JSON** — structured array, suitable for archiving and API responses
- **CSV** — spreadsheet-compatible, all 13 columns
- **CEF** — ArcSight Common Event Format for Splunk, Elastic, QRadar

---

## Hash chain

See [docs/hash-chain.md](docs/hash-chain.md) for the full algorithm spec.

SHA-256 links each record to its predecessor.  Call `verify()` periodically
and store the result externally to establish trusted checkpoints.

---

## Compliance notes

See [docs/compliance.md](docs/compliance.md) for EU AI Act / ISO 42001 alignment notes.

---

## License

Apache License 2.0. Copyright (c) 2026 MuVeraAI Corporation.

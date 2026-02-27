# OpenTelemetry Governance Observability

AumOS audit-trail ships a zero-dependency OTel integration that converts
governance decisions into distributed traces.  When wired into Jaeger, Zipkin,
Grafana Tempo, or any OTLP-compatible backend, every `permitted`/`denied`
decision becomes a first-class trace span carrying structured governance
attributes — queryable, filterable, and correlatable with the rest of your
application traces.

---

## Why governance observability matters

Audit logs answer *what happened*.  Distributed traces answer *why it was slow,
where it failed, and how it fits into the broader request flow*.

For AI agents operating inside production systems, you need both:

| Concern | Tool |
|---|---|
| Tamper-evident record of every decision | `AuditLogger` hash chain |
| Per-request latency breakdown | OTel spans |
| Correlation with upstream calls (LLM, DB, API) | OTel trace context propagation |
| Long-term search and compliance reporting | Audit log export (JSON / CSV / CEF) |
| Real-time dashboards for operations teams | OTel metrics (Prometheus / OTLP) |

The `GovernanceOTelExporter` bridges these two worlds: it reads a completed
`AuditRecord` (or a typed snapshot) and emits an OTel span carrying the same
data.  The span includes `ai.governance.audit.record_id` and
`ai.governance.audit.chain_hash`, so an operator can jump from a Jaeger trace
directly to the corresponding tamper-evident audit record.

---

## Semantic convention reference

All attribute keys and span names are defined in the
`GOVERNANCE_SEMANTIC_CONVENTIONS` constant (TypeScript) /
`GOVERNANCE_SEMANTIC_CONVENTIONS` singleton (Python).

### Trust governance attributes

| Attribute | Type | Description |
|---|---|---|
| `ai.governance.trust.level` | `int` | Trust level held by the agent at decision time |
| `ai.governance.trust.required` | `int` | Minimum trust level required for the action |
| `ai.governance.trust.decision` | `string` | `"passed"` or `"failed"` |

### Budget governance attributes

| Attribute | Type | Description |
|---|---|---|
| `ai.governance.budget.limit` | `float` | Configured maximum spend for the budget period |
| `ai.governance.budget.remaining` | `float` | Balance remaining after this operation |
| `ai.governance.budget.cost` | `float` | Cost charged by this specific operation |
| `ai.governance.budget.currency` | `string` | ISO 4217 code (e.g. `"USD"`) or token unit (e.g. `"tokens"`) |

### Consent governance attributes

| Attribute | Type | Description |
|---|---|---|
| `ai.governance.consent.status` | `string` | `"granted"`, `"revoked"`, or `"absent"` |
| `ai.governance.consent.purpose` | `string` | Processing purpose evaluated |

### Decision attributes

| Attribute | Type | Description |
|---|---|---|
| `ai.governance.decision` | `string` | `"permitted"` or `"denied"` |
| `ai.governance.decision.reason` | `string` | Human-readable explanation (optional) |

### Audit chain attributes

| Attribute | Type | Description |
|---|---|---|
| `ai.governance.audit.record_id` | `string` | UUID of the corresponding `AuditRecord` |
| `ai.governance.audit.chain_hash` | `string` | SHA-256 chain hash of the `AuditRecord` |

### Agent identity attributes

| Attribute | Type | Description |
|---|---|---|
| `ai.agent.id` | `string` | Stable unique identifier for the agent |
| `ai.agent.name` | `string` | Human-readable agent name |
| `ai.agent.framework` | `string` | Agent framework (e.g. `"aumos-governance"`) |

### Canonical span names

| Constant | Span name | Purpose |
|---|---|---|
| `SPAN_GOVERNANCE_EVALUATE` | `ai.governance.evaluate` | End-to-end governance evaluation |
| `SPAN_TRUST_CHECK` | `ai.governance.trust_check` | Trust-level evaluation step |
| `SPAN_BUDGET_CHECK` | `ai.governance.budget_check` | Budget-limit evaluation step |
| `SPAN_CONSENT_CHECK` | `ai.governance.consent_check` | Consent-status evaluation step |
| `SPAN_AUDIT_LOG` | `ai.governance.audit_log` | Audit-record write to storage |

---

## Quick start

### TypeScript

```bash
npm install @aumos/audit-trail @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-jaeger
```

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";
import { trace } from "@opentelemetry/api";
import { AuditLogger, GovernanceOTelExporter } from "@aumos/audit-trail";

// 1. Initialise the OTel SDK (do this once at process start).
const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({ endpoint: "http://localhost:14268/api/traces" }),
});
sdk.start();

// 2. Get a tracer for your service.
const tracer = trace.getTracer("my-agent-service", "1.0.0");

// 3. Create the governance exporter.
const otelExporter = new GovernanceOTelExporter({ tracer });

// 4. Create the audit logger.
const auditLogger = new AuditLogger();

// 5. Log a decision and export it as an OTel span.
const record = await auditLogger.log({
  agentId: "agent-crm-001",
  action: "export_customer_data",
  permitted: false,
  trustLevel: 3,
  requiredLevel: 5,
  reason: "Trust level 3 is insufficient for bulk data export (requires 5)",
});

otelExporter.exportDecision(record);
```

### Python

```bash
pip install "agent-audit-trail" \
  opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp
```

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

from audit_trail import AuditLogger, GovernanceDecisionInput
from audit_trail.otel_exporter import GovernanceOTelExporter

# 1. Initialise the OTel SDK.
provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:4317"))
)
trace.set_tracer_provider(provider)

# 2. Get a tracer for your service.
tracer = trace.get_tracer("my-agent-service", "1.0.0")

# 3. Create the governance exporter.
otel_exporter = GovernanceOTelExporter(tracer=tracer)

# 4. Create the audit logger.
audit_logger = AuditLogger()

# 5. Log a decision and export it as an OTel span.
record = await audit_logger.log(
    GovernanceDecisionInput(
        agent_id="agent-crm-001",
        action="export_customer_data",
        permitted=False,
        trust_level=3,
        required_level=5,
        reason="Trust level 3 is insufficient for bulk data export (requires 5)",
    )
)

otel_exporter.export_decision(record)
```

---

## Integration with Jaeger

Run Jaeger locally with Docker:

```bash
docker run -d --name jaeger \
  -p 6831:6831/udp \
  -p 16686:16686 \
  -p 14268:14268 \
  jaegertracing/all-in-one:latest
```

Open the Jaeger UI at `http://localhost:16686` and search for service
`my-agent-service`.  Filter by operation `ai.governance.evaluate` to see all
governance decisions.  Denied decisions appear with span status `ERROR` and are
highlighted in red in the trace waterfall.

---

## Integration with Zipkin

```bash
docker run -d --name zipkin -p 9411:9411 openzipkin/zipkin
```

Replace `JaegerExporter` with Zipkin's exporter:

```typescript
import { ZipkinExporter } from "@opentelemetry/exporter-zipkin";

const sdk = new NodeSDK({
  traceExporter: new ZipkinExporter({ url: "http://localhost:9411/api/v2/spans" }),
});
```

```python
from opentelemetry.exporter.zipkin.json import ZipkinExporter

provider.add_span_processor(
    BatchSpanProcessor(ZipkinExporter(endpoint="http://localhost:9411/api/v2/spans"))
)
```

---

## Integration with existing OTel pipelines

If you already have OTel configured for your service, integrate the governance
exporter by passing your existing tracer:

```typescript
// TypeScript — pass the tracer already used by your service
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("your-service");  // already initialised elsewhere
const otelExporter = new GovernanceOTelExporter({ tracer });
```

```python
# Python — pass the tracer already used by your service
import opentelemetry.trace as trace

tracer = trace.get_tracer("your-service")  # already initialised elsewhere
otel_exporter = GovernanceOTelExporter(tracer=tracer)
```

Governance spans will appear as siblings or children of your existing spans,
inheriting the active trace context automatically via the OTel context
propagation API.

### Opt-out without code changes

To disable OTel export without changing application code, simply omit the
tracer at construction time:

```typescript
// No tracer — all export methods are no-ops
const otelExporter = new GovernanceOTelExporter();
```

```python
# No tracer — all export methods are no-ops
otel_exporter = GovernanceOTelExporter()
```

---

## Standalone sub-span exports

For finer-grained traces, export each governance sub-step individually.  This
is useful inside a `GovernanceEngine` that evaluates trust, budget, and consent
as separate sequential steps.

### TypeScript

```typescript
// Trust check
otelExporter.exportTrustCheck({
  agentId: "agent-crm-001",
  trustLevel: 3,
  requiredLevel: 2,
  passed: true,
  auditRecordId: record.id,
  auditChainHash: record.recordHash,
});

// Budget check
otelExporter.exportBudgetCheck({
  agentId: "agent-crm-001",
  budgetLimit: 100.00,
  budgetRemaining: 73.45,
  operationCost: 0.12,
  currency: "USD",
  passed: true,
  auditRecordId: record.id,
  auditChainHash: record.recordHash,
});

// Consent check
otelExporter.exportConsentCheck({
  agentId: "agent-crm-001",
  purpose: "marketing_email",
  consentStatus: "granted",
  passed: true,
  auditRecordId: record.id,
  auditChainHash: record.recordHash,
});
```

### Python

```python
from audit_trail.otel_exporter import (
    TrustCheckSnapshot,
    BudgetCheckSnapshot,
    ConsentCheckSnapshot,
)

# Trust check
otel_exporter.export_trust_check(
    TrustCheckSnapshot(
        agent_id="agent-crm-001",
        trust_level=3,
        required_level=2,
        passed=True,
        audit_record_id=record.id,
        audit_chain_hash=record.record_hash,
    )
)

# Budget check
otel_exporter.export_budget_check(
    BudgetCheckSnapshot(
        agent_id="agent-crm-001",
        budget_limit=100.00,
        budget_remaining=73.45,
        operation_cost=0.12,
        currency="USD",
        passed=True,
        audit_record_id=record.id,
        audit_chain_hash=record.record_hash,
    )
)

# Consent check
otel_exporter.export_consent_check(
    ConsentCheckSnapshot(
        agent_id="agent-crm-001",
        purpose="marketing_email",
        consent_status="granted",
        passed=True,
        audit_record_id=record.id,
        audit_chain_hash=record.record_hash,
    )
)
```

---

## Example traces

### Permitted decision trace

```
Trace: agent-crm-001 / read_customer_record
└── ai.governance.evaluate                          [OK]  14ms
    │  ai.agent.id                = agent-crm-001
    │  ai.governance.decision     = permitted
    │  ai.governance.trust.level  = 3
    │  ai.governance.trust.required = 2
    │  ai.governance.budget.cost  = 0.04
    │  ai.governance.budget.remaining = 73.45
    │  ai.governance.audit.record_id  = 3f7a1b2c-...
    │  ai.governance.audit.chain_hash = a3f7c9d2...
    ├── ai.governance.trust_check                   [OK]   2ms
    │      ai.governance.trust.decision = passed
    ├── ai.governance.budget_check                  [OK]   1ms
    │      ai.governance.budget.currency = USD
    └── ai.governance.audit_log                     [OK]   4ms
           ai.governance.audit.record_id = 3f7a1b2c-...
```

### Denied decision trace

```
Trace: agent-crm-001 / export_customer_data
└── ai.governance.evaluate                          [ERROR] 11ms
    │  ai.agent.id                 = agent-crm-001
    │  ai.governance.decision      = denied
    │  ai.governance.decision.reason = Trust level 3 is insufficient for bulk data export
    │  ai.governance.trust.level   = 3
    │  ai.governance.trust.required = 5
    │  ai.governance.audit.record_id  = 9c2d4e5f-...
    │  ai.governance.audit.chain_hash = 9c2d4e5f...
    └── ai.governance.trust_check                   [ERROR]  2ms
           ai.governance.trust.decision = failed
```

In Jaeger, denied spans appear in red (ERROR status) and can be filtered with:

```
operationName = "ai.governance.evaluate" AND tags["ai.governance.decision"] = "denied"
```

### Consent denied trace

```
Trace: agent-marketing-002 / send_promotional_email
└── ai.governance.evaluate                          [ERROR] 9ms
    │  ai.agent.id                   = agent-marketing-002
    │  ai.governance.decision        = denied
    │  ai.governance.decision.reason = Consent not granted for purpose: marketing_email
    │  ai.governance.audit.record_id = 7b3e9f1a-...
    └── ai.governance.consent_check                 [ERROR] 2ms
           ai.governance.consent.status  = revoked
           ai.governance.consent.purpose = marketing_email
```

---

## Cross-referencing traces with the audit log

Every governance span carries `ai.governance.audit.record_id`.  Use that UUID
to retrieve the corresponding tamper-evident record from the audit log:

```typescript
const records = await auditLogger.query({ agentId: "agent-crm-001" });
const target = records.find((r) => r.id === "3f7a1b2c-...");
```

```python
records = await audit_logger.query(AuditFilter(agent_id="agent-crm-001"))
target = next((r for r in records if r.id == "3f7a1b2c-..."), None)
```

The `ai.governance.audit.chain_hash` attribute lets you verify that the span
was produced from the unmodified record:

```typescript
import crypto from "node:crypto";

const expectedHash = target?.recordHash;
const spanHash = span.attributes["ai.governance.audit.chain_hash"];
const isIntact = expectedHash === spanHash;
```

---

## Filtering and alerting

Configure your OTel collector to route denied governance spans to a dedicated
pipeline:

```yaml
# otel-collector-config.yaml
processors:
  filter/governance_denied:
    spans:
      include:
        match_type: strict
        attributes:
          - key: ai.governance.decision
            value: denied

exporters:
  otlp/siem:
    endpoint: siem.internal:4317

service:
  pipelines:
    traces/governance:
      receivers: [otlp]
      processors: [filter/governance_denied]
      exporters: [otlp/siem]
```

This routes only denied decisions to your SIEM while the full trace (including
permitted decisions) goes to your primary trace backend.

> **Note:** Alerting logic lives in the OTel collector or downstream SIEM —
> never inside the audit-trail library.  The library records; external systems
> react.

---

## API reference

### TypeScript

```typescript
import {
  GovernanceOTelExporter,
  GOVERNANCE_SEMANTIC_CONVENTIONS,
} from "@aumos/audit-trail";

// Constructor
new GovernanceOTelExporter(options?: GovernanceOTelExporterOptions)

// options.tracer       — OTelTracer (optional peer dependency)
// options.meterProvider — OTelMeterProvider (reserved for future metrics)

// Methods
exporter.exportDecision(record: AuditRecord): void
exporter.exportTrustCheck(snapshot: TrustCheckSnapshot): void
exporter.exportBudgetCheck(snapshot: BudgetCheckSnapshot): void
exporter.exportConsentCheck(snapshot: ConsentCheckSnapshot): void
```

### Python

```python
from audit_trail.otel_exporter import (
    GovernanceOTelExporter,
    TrustCheckSnapshot,
    BudgetCheckSnapshot,
    ConsentCheckSnapshot,
)
from audit_trail.otel_conventions import GOVERNANCE_SEMANTIC_CONVENTIONS

# Constructor
GovernanceOTelExporter(
    tracer: OTelTracer | None = None,
    meter_provider: OTelMeterProvider | None = None,
)

# Methods
exporter.export_decision(record: AuditRecord) -> None
exporter.export_trust_check(snapshot: TrustCheckSnapshot) -> None
exporter.export_budget_check(snapshot: BudgetCheckSnapshot) -> None
exporter.export_consent_check(snapshot: ConsentCheckSnapshot) -> None
```

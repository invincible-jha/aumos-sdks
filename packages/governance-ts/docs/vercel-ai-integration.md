# Vercel AI SDK — AumOS Governance Integration

This document covers the `createGovernedAI` middleware, the `GovernedOpenAI` and `GovernedAnthropic` wrappers, and the HTTP framework middleware provided by `@aumos/governance`.

---

## Overview

The Vercel AI SDK integration provides governance controls that sit between your application code and any AI provider call.  Every request is evaluated against:

1. **Trust level** — is the configured tier sufficient for the operation?
2. **Budget** — does the request fit within the static spending caps?
3. **Audit** — a record of the decision is appended to an in-memory log.

Trust assignment is manual only.  Budget limits are static.  Audit logging is recording only.

---

## Quick Start

```ts
import { createGovernedAI } from '@aumos/governance';

const governed = createGovernedAI({
  trustLevel: 3,
  budget: {
    daily: 10.00,
    hourly: 2.00,
    perRequest: 0.10,
  },
  audit: true,
  onDeny: 'throw',
});

// Call before every AI provider request
const result = await governed.beforeRequest({
  model: 'gpt-4o',
  maxTokens: 512,
  prompt: 'Summarise the governance framework.',
});

if (!result.allowed) {
  console.warn('Request denied:', result.denialReason);
}
```

---

## `VercelAIGovernanceConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `trustLevel` | `number` (0–5) | `2` | Trust tier under which this client operates. |
| `budget.daily` | `number` (USD) | — | Maximum spend per UTC calendar day. |
| `budget.hourly` | `number` (USD) | — | Maximum spend per clock-hour. |
| `budget.perRequest` | `number` (USD) | — | Maximum spend per individual request. |
| `audit` | `boolean` | `true` | Whether decisions are recorded. |
| `onDeny` | `'throw' \| 'return_empty' \| 'log_only'` | `'throw'` | Behaviour on denial. |

### Trust Levels

| Value | Name | Meaning |
|---|---|---|
| 0 | L0_OBSERVER | Read-only observer |
| 1 | L1_MONITOR | Active monitoring, no mutations |
| 2 | L2_SUGGEST | Proposals only; all outputs reviewed |
| 3 | L3_ACT_APPROVE | Acts with explicit human approval |
| 4 | L4_ACT_REPORT | Acts autonomously; reports post-hoc |
| 5 | L5_AUTONOMOUS | Fully autonomous within scope |

### `onDeny` Behaviour

| Value | Behaviour |
|---|---|
| `'throw'` | Throws `GovernanceDeniedError` or `TrustLevelInsufficientError`. |
| `'return_empty'` | Returns `GovernanceMiddlewareResult` with `allowed: false`. |
| `'log_only'` | Records the denial but allows the request to proceed. |

---

## `GovernanceMiddlewareResult`

```ts
interface GovernanceMiddlewareResult {
  readonly allowed: boolean;
  readonly trustLevel: number;
  readonly budgetRemaining: number | undefined;
  readonly auditRecordId: string;
  readonly denialReason: string | undefined;
}
```

---

## OpenAI Wrapper — `GovernedOpenAI`

```ts
import OpenAI from 'openai';
import { GovernedOpenAI } from '@aumos/governance';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const governed = new GovernedOpenAI(openai, {
  trustLevel: 3,
  minimumTrustLevel: 2,   // Requests denied if trustLevel < 2
  budget: { daily: 5.00, perRequest: 0.05 },
  audit: true,
  onDeny: 'throw',
});

const response = await governed.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
  max_tokens: 256,
});
```

### Configuration

`GovernedOpenAI` accepts the same fields as `VercelAIGovernanceConfig` plus:

| Field | Type | Default | Description |
|---|---|---|---|
| `minimumTrustLevel` | `number` (0–5) | `1` | Minimum trust level required to make API calls. |

### Accessing the Audit Log

```ts
const records = governed.getAuditLog();
for (const record of records) {
  console.log(record.allowed, record.model, record.maxTokens);
}
```

---

## Anthropic Wrapper — `GovernedAnthropic`

```ts
import Anthropic from '@anthropic-ai/sdk';
import { GovernedAnthropic } from '@aumos/governance';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const governed = new GovernedAnthropic(anthropic, {
  trustLevel: 3,
  minimumTrustLevel: 2,
  budget: { daily: 5.00, perRequest: 0.05 },
  audit: true,
  onDeny: 'return_empty',
});

const response = await governed.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

The configuration and `getAuditLog()` API are identical to `GovernedOpenAI`.

---

## Express Middleware

```ts
import express from 'express';
import { governanceMiddleware } from '@aumos/governance';
import type { GovernanceRequest } from '@aumos/governance';

const app = express();

app.use(
  governanceMiddleware({
    trustLevel: 3,
    budget: { hourly: 5.00 },
  }),
);

app.post('/api/generate', (req, res) => {
  const gov = (req as GovernanceRequest).governance;
  console.log('Request ID:', gov.requestId);
  console.log('Trust level:', gov.trustLevel);
  res.json({ ok: true });
});
```

---

## Fastify Plugin

```ts
import Fastify from 'fastify';
import { governanceFastifyPlugin } from '@aumos/governance';

const app = Fastify();

await app.register(governanceFastifyPlugin, {
  trustLevel: 3,
  budget: { hourly: 5.00 },
});

app.get('/api/generate', async (request) => {
  // TypeScript: augment FastifyRequest in your project's type declarations
  const gov = (request as { governance: { trustLevel: number; requestId: string } }).governance;
  return { trustLevel: gov.trustLevel, requestId: gov.requestId };
});
```

### TypeScript Augmentation

Add to your project's type declarations (e.g. `src/types/fastify.d.ts`):

```ts
import type { FastifyRequestGovernanceContext } from '@aumos/governance';

declare module 'fastify' {
  interface FastifyRequest {
    governance: FastifyRequestGovernanceContext;
  }
}
```

---

## Hono Middleware

```ts
import { Hono } from 'hono';
import { governanceHonoMiddleware } from '@aumos/governance';
import type { HonoGovernanceContext } from '@aumos/governance';

type AppVariables = { governance: HonoGovernanceContext };
const app = new Hono<{ Variables: AppVariables }>();

app.use('*', governanceHonoMiddleware({ trustLevel: 3 }));

app.get('/api/generate', (c) => {
  const gov = c.get('governance');
  return c.json({ trustLevel: gov.trustLevel, requestId: gov.requestId });
});
```

---

## Streaming Governance

```ts
import { createGovernedStream } from '@aumos/governance';

// Assume `rawStream` is a ReadableStream<Uint8Array> from an AI provider.
const governed = createGovernedStream(rawStream, {
  onChunk: (accumulated, _chunk) => {
    const estimatedTokens = accumulated.length / 4;
    return {
      allowed: estimatedTokens < 2_000,
      reason: 'Token accumulation limit reached',
    };
  },
  onHalt: (reason, content) => {
    console.warn(`Stream halted at ${content.length} chars: ${reason}`);
  },
});

// governed.stream is the ReadableStream<string>; getReader() is a shortcut.
const reader = governed.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(value);
}
```

---

## Event Emitter

```ts
import {
  GovernanceEventEmitter,
  EVENT_DECISION,
  EVENT_BUDGET_WARNING,
  EVENT_TRUST_DENIED,
  EVENT_AUDIT_LOGGED,
} from '@aumos/governance';

const emitter = new GovernanceEventEmitter();

emitter.on(EVENT_DECISION, (payload) => {
  console.log(`Decision: allowed=${payload.allowed} protocol=${payload.protocol}`);
});

emitter.once(EVENT_BUDGET_WARNING, (payload) => {
  console.warn(`Budget at ${payload.utilizationPercent}%`);
});

// Emit manually or wire to GovernanceManger callbacks in your application.
emitter.emit(EVENT_DECISION, {
  allowed: true,
  protocol: 'ATP',
  trustLevel: 3,
  timestamp: new Date().toISOString(),
  reason: 'All checks passed.',
});
```

### Supported Events

| Constant | Event Name | Payload Type |
|---|---|---|
| `EVENT_DECISION` | `governance:decision` | `GovernanceDecisionEventPayload` |
| `EVENT_BUDGET_WARNING` | `governance:budget:warning` | `GovernanceBudgetWarningEventPayload` |
| `EVENT_TRUST_DENIED` | `governance:trust:denied` | `GovernanceTrustDeniedEventPayload` |
| `EVENT_AUDIT_LOGGED` | `governance:audit:logged` | `GovernanceAuditLoggedEventPayload` |

---

## Cost Estimation

The middleware estimates request cost using the following formula:

```
estimatedCost = (maxTokens + promptTokens) * COST_PER_TOKEN
```

Where:
- `promptTokens` is estimated at `promptChars / 4` (4-chars-per-token heuristic).
- `COST_PER_TOKEN` is `$0.000015` (USD per token, provider-agnostic average).

This estimate is conservative and intentionally over-states cost to ensure spending caps are not breached.  After an AI call resolves, callers should record actual provider costs via their own accounting system.

---

## IP Boundaries

This integration enforces AumOS OSS boundaries:

- Trust changes are **manual only** — `trustLevel` is set in config, never auto-adjusted.
- Budget limits are **static only** — caps are set at construction, not modified by spend patterns.
- Audit logging is **recording only** — no anomaly detection or pattern analysis.

---

Copyright (c) 2026 MuVeraAI Corporation. Licensed under BSL-1.1.

# WASM Bindings

`aumos-governance-wasm` compiles `aumos-governance-core` to WebAssembly and
exposes a JavaScript / TypeScript API via `wasm-bindgen`.

## Prerequisites

```bash
# Install wasm-pack
cargo install wasm-pack

# Add the WASM target
rustup target add wasm32-unknown-unknown
```

## Build the WASM package

```bash
cd packages/governance-rust/crates/aumos-governance-wasm
wasm-pack build --target web --out-dir pkg
```

This produces a `pkg/` directory containing:

```
pkg/
├── aumos_governance_wasm.js        # ES module JS glue
├── aumos_governance_wasm.d.ts      # TypeScript declarations
├── aumos_governance_wasm_bg.wasm   # compiled WASM binary
└── package.json
```

For Node.js consumers use `--target nodejs` instead.

## JavaScript usage

```html
<script type="module">
import init, {
  create_engine,
  set_trust_level,
  create_budget,
  record_consent,
  revoke_consent,
  check_action,
  query_audit,
  destroy_engine,
} from './pkg/aumos_governance_wasm.js';

async function main() {
  // Initialise the WASM module.
  await init();

  // Create an engine and obtain its integer handle.
  const handle = create_engine();

  // Assign trust levels (always manual — never automatic).
  set_trust_level(handle, 'agent-001', 'finance', 4, 'owner');
  //                                               ^ TrustLevel::ActAndReport

  // Create a spending envelope.
  create_budget(handle, 'financial', 1000.0, 86_400_000, 0);

  // Record consent.
  record_consent(handle, 'agent-001', 'process_pii');

  // Evaluate an action.
  const result = check_action(handle, 'send_payment', JSON.stringify({
    agent_id:       'agent-001',
    scope:          'finance',
    required_trust: 4,
    cost:           250.0,
    category:       'financial',
    data_type:      'process_pii',
    purpose:        null,
  }));

  const decision = JSON.parse(result);
  console.log('permitted:', decision.permitted);
  console.log('reason:',    decision.reason);

  // Query the audit log.
  const auditJson = query_audit(handle, JSON.stringify({ limit: 10 }));
  const records = JSON.parse(auditJson);
  console.log('audit records:', records.length);

  // Always release the engine when done.
  destroy_engine(handle);
}

main();
</script>
```

## TypeScript usage

The generated `.d.ts` file provides full type declarations.  Example with
explicit typing:

```typescript
import init, {
  create_engine,
  set_trust_level,
  create_budget,
  check_action,
  destroy_engine,
} from './pkg/aumos_governance_wasm';

interface GovernanceContext {
  agent_id:       string;
  scope:          string;
  required_trust: number;  // 0-5
  cost:           number | null;
  category:       string;
  data_type:      string | null;
  purpose:        string | null;
}

interface GovernanceDecision {
  permitted:    boolean;
  reason:       string;
  action:       string;
  timestamp_ms: number;
}

async function evaluate(
  agentId: string,
  action:  string,
): Promise<GovernanceDecision> {
  await init();

  const handle = create_engine();
  set_trust_level(handle, agentId, 'default', 4, 'owner');
  create_budget(handle, 'default', 500.0, 0, 0);

  const context: GovernanceContext = {
    agent_id:       agentId,
    scope:          'default',
    required_trust: 2,
    cost:           10.0,
    category:       'default',
    data_type:      null,
    purpose:        null,
  };

  const raw: string = check_action(handle, action, JSON.stringify(context));
  destroy_engine(handle);

  return JSON.parse(raw) as GovernanceDecision;
}
```

## Engine handles

Each call to `create_engine()` returns a unique `u32` handle.  Handles are
integers so they cross the WASM boundary cheaply.

Handles are registered in a `thread_local` registry inside the WASM module.
Always call `destroy_engine(handle)` when the engine is no longer needed to
free its memory.

## Trust level constants

Pass the numeric discriminant to `set_trust_level`:

| Constant | Value |
|----------|:-----:|
| `Observer`        | 0 |
| `Monitor`         | 1 |
| `Suggest`         | 2 |
| `ActWithApproval` | 3 |
| `ActAndReport`    | 4 |
| `Autonomous`      | 5 |

## Audit filter shape

```typescript
interface AuditFilter {
  agent_id?: string;
  action?:   string;
  since_ms?: number;
  until_ms?: number;
  limit?:    number;
}

// Retrieve all records:
query_audit(handle, '{}');

// Retrieve last 20 records for a specific action:
query_audit(handle, JSON.stringify({ action: 'send_payment', limit: 20 }));
```

## Bundle size

The release profile is configured with `opt-level = "z"` and `lto = true` to
minimise the `.wasm` binary size.  Typical output for the governance module is
under 200 KB before gzip compression.

# Hash Chain Design

## Overview

Every audit record in `@aumos/audit-trail` / `agent-audit-trail` is linked to
its predecessor via a SHA-256 digest.  This creates an immutable, ordered chain
where tampering with any record is detectable because it invalidates every
subsequent hash.

## Algorithm

### Genesis condition

The chain is initialised with a known sentinel value:

```
GENESIS_HASH = "0000...0000"  (64 zero hex characters)
```

The very first record's `previousHash` field is always the genesis hash.

### Appending a record

When `HashChain.append(pending)` is called:

1. Serialise the pending record (all fields except `recordHash`) to canonical
   JSON: keys are sorted alphabetically, no extra whitespace.
2. Build the hash input:
   ```
   payload = canonicalJSON + "\n" + previousHash
   ```
3. Compute `recordHash = SHA-256(payload).hexdigest()`
4. Store `recordHash` as the new chain tip (`lastHash`).
5. Return the completed `AuditRecord` with `recordHash` populated.

### Why canonical JSON?

JavaScript object key order and Python dict insertion order both vary.
Sorting keys alphabetically before serialisation ensures that two records with
the same logical content always produce the same digest regardless of how the
runtime ordered the keys.

### Verification

`HashChain.verify(records)` walks the array from index 0:

```
expected_previous = GENESIS_HASH

for each record at index i:
  1. assert record.previousHash == expected_previous
  2. rebuild pending = { all fields except recordHash }
  3. recompute expected_hash = SHA-256(canonical(pending) + "\n" + expected_previous)
  4. assert record.recordHash == expected_hash
  5. expected_previous = record.recordHash
```

A mismatch at step 1 indicates a deleted record (gap in the chain).
A mismatch at step 4 indicates a mutated record.

## What the chain protects

| Attack                          | Detected? |
| ------------------------------- | --------- |
| Modify a field in a past record | Yes — hash mismatch on the modified record |
| Delete a record from the middle | Yes — previousHash mismatch on the next record |
| Append a fabricated record      | Yes — previousHash will not match the real tip |
| Reorder records                 | Yes — previousHash chain breaks |

## What the chain does NOT protect

- **Deletion of the tail** — truncating the newest N records leaves a valid
  sub-chain.  If you need tail-protection, snapshot `lastHash` to a separate
  trusted store (e.g., an append-only ledger or a notary signature).
- **Wholesale replacement** — if an attacker replaces the entire record set
  with a freshly-computed chain, verification passes.  External anchoring
  (periodic hash publication) mitigates this.
- **Storage-layer confidentiality** — the chain proves integrity, not
  confidentiality.  Encrypt the storage file separately if records contain
  sensitive data.

## Storage restoration

When resuming from durable storage (e.g., `FileStorage`), pass the last record's
`recordHash` as `initialHash` to the `HashChain` constructor.  New appends will
be correctly linked to the existing chain.

```typescript
// TypeScript
const lastLine = FileStorage.readLastLineSynchronously('./audit.ndjson');
const lastHash = lastLine ? JSON.parse(lastLine).recordHash : undefined;
const chain = new HashChain(lastHash);
```

```python
# Python
last_line = FileStorage.read_last_line_sync('./audit.ndjson')
last_hash = json.loads(last_line)['record_hash'] if last_line else None
chain = HashChain(initial_hash=last_hash)
```

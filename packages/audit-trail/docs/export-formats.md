# Export Formats

`AuditLogger.exportRecords(format, filter?)` supports three output formats.

## JSON

A JSON array of `AuditRecord` objects, 2-space indented.

```json
[
  {
    "id": "3f7a1b2c-...",
    "timestamp": "2026-02-26T14:32:01.123Z",
    "agentId": "agent-crm-001",
    "action": "read_customer_record",
    "permitted": true,
    "trustLevel": 3,
    "requiredLevel": 2,
    "reason": "Trust level meets requirement",
    "previousHash": "0000...0000",
    "recordHash": "a3f7..."
  }
]
```

Use when integrating with downstream systems that consume structured JSON, or
when archiving for long-term storage.

## CSV

RFC 4180 CSV with a header row.  All 13 columns are always present; optional
fields absent on a record are left empty.

```
id,timestamp,agentId,action,permitted,trustLevel,requiredLevel,budgetUsed,budgetRemaining,reason,metadata,previousHash,recordHash
3f7a1b2c,...,2026-02-26T14:32:01.123Z,agent-crm-001,read_customer_record,true,3,2,,,...,0000...0000,a3f7...
```

Python column names use `snake_case` (`agent_id`, `trust_level`, etc.) to match
the Pydantic model fields.  TypeScript column names use `camelCase`.

Object-valued `metadata` fields are JSON-encoded within the CSV cell.

## CEF (Common Event Format)

ArcSight CEF v0, one event per line.  Compatible with:

- Splunk Universal Forwarder (monitor input or HEC)
- Elastic Agent with CEF codec
- QRadar DSM auto-detection

### Line format

```
CEF:0|AumOS|AuditTrail|1.0|<SignatureId>|<Name>|<Severity>|<Extensions>
```

| CEF field     | Source                                    |
| ------------- | ----------------------------------------- |
| `SignatureId` | `action` (CEF-escaped)                    |
| `Name`        | `"Governance Decision: <action>"`         |
| `Severity`    | 7 for denied, 3 for permitted             |
| `rt`          | `timestamp`                               |
| `src`         | `agentId`                                 |
| `act`         | `action`                                  |
| `outcome`     | `"permitted"` or `"denied"`               |
| `cs1`/`cs1Label` | `recordId` / `id`                    |
| `cs2`/`cs2Label` | `previousHash` / previous hash value |
| `cs3`/`cs3Label` | `recordHash` / record hash value     |
| `cn1`/`cn1Label` | `trustLevel` (when present)          |
| `cn2`/`cn2Label` | `requiredLevel` (when present)       |
| `cn3`/`cn3Label` | `budgetUsed` (when present)          |
| `cn4`/`cn4Label` | `budgetRemaining` (when present)     |
| `msg`         | `reason` (when present)                   |

### Example line

```
CEF:0|AumOS|AuditTrail|1.0|export_customer_data|Governance Decision: export_customer_data|7|rt=2026-02-26T14:32:05.001Z src=agent-crm-001 act=export_customer_data outcome=denied cs1Label=recordId cs1=3f7a... cs2Label=previousHash cs2=a3f7... cs3Label=recordHash cs3=9c2d... cn1Label=trustLevel cn1=3 cn2Label=requiredLevel cn2=5 msg=Trust level insufficient for bulk data export
```

### Splunk ingestion

Configure a monitor stanza in `inputs.conf`:

```ini
[monitor:///var/log/aumos/audit.cef]
sourcetype = cef
index = governance
```

### Elastic ingestion

Use the `filebeat` CEF module or a pipeline with the `dissect` processor
targeting the CEF format.

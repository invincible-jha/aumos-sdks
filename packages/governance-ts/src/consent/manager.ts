// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { ConsentRecord } from '../types.js';
import type { ConsentConfig } from '../config.js';
import { parseConsentConfig } from '../config.js';
import { ConsentStore } from './store.js';

/** Options accepted by ConsentManager.recordConsent(). */
export interface RecordConsentOptions {
  /** ISO 8601 datetime after which the consent expires. */
  expiresAt?: string;
}

/** Result returned by ConsentManager.checkConsent(). */
export interface ConsentCheckResult {
  /** Whether valid consent exists. */
  readonly permitted: boolean;
  /** Matching consent record, if one was found. */
  readonly record?: ConsentRecord;
  /** Human-readable explanation on denial. */
  readonly reason?: string;
}

/**
 * ConsentManager records, checks, and revokes consent grants.
 *
 * Consent is a record of agreement by a principal (`grantedBy`) that a
 * specific agent may access a data type for a stated purpose.  Consent
 * is never inferred, suggested proactively, or upgraded automatically.
 *
 * Storage is delegated to ConsentStore (in-memory, Map-based).  Records
 * are never physically deleted; revocation sets `active: false`.
 *
 * Public API (Fire Line — do NOT add methods beyond these three core ones):
 *   recordConsent()  — persist a new consent grant
 *   checkConsent()   — check whether valid consent exists
 *   revokeConsent()  — revoke one or more consent records
 *
 * Additional read-only helper:
 *   listConsents()   — enumerate active consents for an agent
 */
export class ConsentManager {
  readonly #config: ConsentConfig;
  readonly #store: ConsentStore;

  constructor(config: unknown = {}) {
    this.#config = parseConsentConfig(config);
    this.#store = new ConsentStore();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Records a consent grant for an agent to access a data type for a purpose.
   *
   * When an unexpired active record already exists for the same
   * (agentId, dataType, purpose) triplet, an additional record is still
   * created — multiple overlapping consents are valid and tracked separately.
   *
   * @param agentId   - The agent being granted consent.
   * @param dataType  - The category of data the agent may access.
   * @param purpose   - The stated purpose for which access is granted.
   * @param grantedBy - The principal authorising the consent.
   * @param options   - Additional options (e.g., expiry).
   * @returns The newly created ConsentRecord.
   */
  recordConsent(
    agentId: string,
    dataType: string,
    purpose: string,
    grantedBy: string,
    options: RecordConsentOptions = {},
  ): ConsentRecord {
    if (agentId.trim().length === 0) {
      throw new RangeError('agentId must be a non-empty string.');
    }
    if (dataType.trim().length === 0) {
      throw new RangeError('dataType must be a non-empty string.');
    }
    if (purpose.trim().length === 0) {
      throw new RangeError('purpose must be a non-empty string.');
    }
    if (grantedBy.trim().length === 0) {
      throw new RangeError('grantedBy must be a non-empty string.');
    }

    const record: ConsentRecord = {
      id: crypto.randomUUID(),
      agentId,
      dataType,
      purpose,
      grantedBy,
      grantedAt: new Date().toISOString(),
      expiresAt: options.expiresAt,
      active: true,
    };

    this.#store.add(record);
    return record;
  }

  /**
   * Checks whether valid consent exists for an agent to access a data type.
   *
   * When `purpose` is provided, only records with a matching purpose are
   * considered.  When omitted, any active record for the data type is accepted.
   *
   * Consent is also implicitly granted when:
   * - `requireConsent` is false in the config (default), AND
   *   no explicit record is required.
   * - The stated `purpose` is in the config's `defaultPurposes` list.
   *
   * @param agentId  - The agent to evaluate.
   * @param dataType - The data type being accessed.
   * @param purpose  - Optional purpose to match against.
   */
  checkConsent(agentId: string, dataType: string, purpose?: string): ConsentCheckResult {
    // Check whether this purpose is in the default (always-accepted) list.
    if (purpose !== undefined && this.#config.defaultPurposes !== undefined) {
      if (this.#config.defaultPurposes.includes(purpose)) {
        return { permitted: true };
      }
    }

    // When requireConsent is false and no explicit record is needed,
    // permit without checking the store.
    if (!this.#config.requireConsent) {
      // Still check for an explicit record — if one exists, surface it.
      const records = this.#store.findActive(agentId, dataType, purpose);
      const record = records[0];
      return { permitted: true, record };
    }

    // requireConsent is true — must find an active record.
    const records = this.#store.findActive(agentId, dataType, purpose);
    if (records.length === 0) {
      const purposeClause = purpose !== undefined ? ` for purpose "${purpose}"` : '';
      return {
        permitted: false,
        reason:
          `No active consent found for agent "${agentId}" ` +
          `to access data type "${dataType}"${purposeClause}.`,
      };
    }

    return { permitted: true, record: records[0] };
  }

  /**
   * Revokes consent for an agent to access a data type.
   *
   * When `purpose` is provided, only records with that exact purpose are
   * revoked.  When omitted, all active records for the data type are revoked.
   *
   * @param agentId  - The agent whose consent is being revoked.
   * @param dataType - The data type to revoke access to.
   * @param purpose  - Optional purpose to narrow the revocation scope.
   * @returns The number of records that were revoked.
   */
  revokeConsent(agentId: string, dataType: string, purpose?: string): number {
    return this.#store.revoke(agentId, dataType, purpose);
  }

  /**
   * Returns all currently active (non-revoked, non-expired) consent records
   * for an agent.
   */
  listConsents(agentId: string): readonly ConsentRecord[] {
    return this.#store.getActive(agentId, new Date());
  }
}

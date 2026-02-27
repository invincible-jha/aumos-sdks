// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Governance Event Emitter
 *
 * `GovernanceEventEmitter` provides a typed publish-subscribe bus for
 * governance lifecycle events.  It is framework-agnostic and has zero
 * runtime dependencies beyond the TypeScript SDK itself.
 *
 * Supported events (see EVENT_* constants below):
 *   - governance:decision      — fired after every trust/budget/consent evaluation
 *   - governance:budget:warning — fired when remaining budget falls below a threshold
 *   - governance:trust:denied  — fired when a trust-level check denies an action
 *   - governance:audit:logged  — fired after an audit record is persisted
 *
 * Usage:
 * ```ts
 * import { GovernanceEventEmitter, EVENT_DECISION } from '@aumos/governance';
 *
 * const emitter = new GovernanceEventEmitter();
 *
 * emitter.on(EVENT_DECISION, (payload) => {
 *   console.log('Decision:', payload.allowed, payload.protocol);
 * });
 *
 * emitter.emit(EVENT_DECISION, {
 *   allowed: true,
 *   protocol: 'ATP',
 *   trustLevel: 3,
 *   timestamp: new Date().toISOString(),
 * });
 * ```
 */

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

/** Emitted after every governance evaluation (permit or deny). */
export const EVENT_DECISION = 'governance:decision' as const;

/** Emitted when the remaining budget for any window drops below a threshold. */
export const EVENT_BUDGET_WARNING = 'governance:budget:warning' as const;

/** Emitted specifically when a trust-level check denies an action. */
export const EVENT_TRUST_DENIED = 'governance:trust:denied' as const;

/** Emitted after a governance decision has been persisted to the audit log. */
export const EVENT_AUDIT_LOGGED = 'governance:audit:logged' as const;

/** Union of all supported event name constants. */
export type GovernanceEventName =
  | typeof EVENT_DECISION
  | typeof EVENT_BUDGET_WARNING
  | typeof EVENT_TRUST_DENIED
  | typeof EVENT_AUDIT_LOGGED;

// ---------------------------------------------------------------------------
// Event payload interfaces
// ---------------------------------------------------------------------------

/**
 * Payload for the `governance:decision` event.
 *
 * Emitted after every governance evaluation regardless of outcome.
 */
export interface GovernanceDecisionEventPayload {
  /** Whether the evaluated action was permitted. */
  readonly allowed: boolean;
  /** The governance protocol that produced the verdict (e.g. 'ATP', 'AEAP'). */
  readonly protocol: string;
  /** The effective trust level at the time of evaluation. */
  readonly trustLevel: number;
  /** ISO 8601 timestamp of the evaluation. */
  readonly timestamp: string;
  /** Human-readable reason for the decision. */
  readonly reason: string;
  /** Agent identifier, if available. */
  readonly agentId?: string;
  /** Action identifier, if available. */
  readonly action?: string;
  /** Supplementary structured details forwarded from the governance result. */
  readonly details?: Record<string, unknown>;
}

/**
 * Payload for the `governance:budget:warning` event.
 *
 * Emitted when remaining budget falls below a consumer-configured threshold.
 */
export interface GovernanceBudgetWarningEventPayload {
  /** The budget category or window type (e.g. 'daily', 'hourly'). */
  readonly budgetType: string;
  /** The configured limit for this budget window in USD. */
  readonly limit: number;
  /** The amount spent so far in the current window in USD. */
  readonly spent: number;
  /** The remaining headroom in USD at the time of this warning. */
  readonly remaining: number;
  /** Utilisation as a percentage [0, 100]. */
  readonly utilizationPercent: number;
  /** ISO 8601 timestamp of the warning. */
  readonly timestamp: string;
}

/**
 * Payload for the `governance:trust:denied` event.
 *
 * Emitted specifically when a trust-level check blocks an action.
 */
export interface GovernanceTrustDeniedEventPayload {
  /** The agent whose trust level was evaluated. */
  readonly agentId: string;
  /** The action that was denied. */
  readonly action: string;
  /** The agent's current trust level at the time of the check. */
  readonly currentLevel: number;
  /** The minimum level required to proceed. */
  readonly requiredLevel: number;
  /** ISO 8601 timestamp of the denial. */
  readonly timestamp: string;
  /** Human-readable reason for the denial. */
  readonly reason: string;
}

/**
 * Payload for the `governance:audit:logged` event.
 *
 * Emitted after an audit record has been successfully persisted.
 */
export interface GovernanceAuditLoggedEventPayload {
  /** The unique ID of the persisted audit record. */
  readonly auditRecordId: string;
  /** The agent whose action was evaluated. */
  readonly agentId: string;
  /** The action that was evaluated. */
  readonly action: string;
  /** The outcome that was recorded. */
  readonly outcome: 'permit' | 'deny';
  /** ISO 8601 timestamp of when the record was persisted. */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Event payload map — links event names to their payload types
// ---------------------------------------------------------------------------

/**
 * Maps each event name to its corresponding payload interface.
 *
 * Used to drive the generic overloads on `on()`, `off()`, and `emit()`.
 */
export interface GovernanceEventPayloadMap {
  [EVENT_DECISION]: GovernanceDecisionEventPayload;
  [EVENT_BUDGET_WARNING]: GovernanceBudgetWarningEventPayload;
  [EVENT_TRUST_DENIED]: GovernanceTrustDeniedEventPayload;
  [EVENT_AUDIT_LOGGED]: GovernanceAuditLoggedEventPayload;
}

// ---------------------------------------------------------------------------
// Listener type
// ---------------------------------------------------------------------------

/**
 * Typed event listener for a specific governance event.
 *
 * @template E - The event name; constrains the payload type automatically.
 */
export type GovernanceEventListener<E extends GovernanceEventName> = (
  payload: GovernanceEventPayloadMap[E],
) => void;

// ---------------------------------------------------------------------------
// GovernanceEventEmitter
// ---------------------------------------------------------------------------

/**
 * Typed publish-subscribe event emitter for governance lifecycle events.
 *
 * Supports multiple listeners per event, ordered registration, and
 * once-only listeners.  All operations are synchronous.
 *
 * There is no Node.js `EventEmitter` dependency; this is a pure TypeScript
 * implementation suitable for browser, edge, and server runtimes.
 */
export class GovernanceEventEmitter {
  /**
   * Internal listener registry.
   *
   * Keyed by event name; each entry is an array of { listener, once } tuples.
   */
  readonly #listeners: Map<
    GovernanceEventName,
    Array<{ listener: (payload: unknown) => void; once: boolean }>
  > = new Map();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Registers a persistent listener for the specified event.
   *
   * The listener is called synchronously every time the event is emitted
   * until it is removed via `off()`.
   *
   * @param event    - The event name constant (use `EVENT_*` exports).
   * @param listener - The callback to invoke with the typed payload.
   * @returns `this` for fluent chaining.
   */
  on<E extends GovernanceEventName>(
    event: E,
    listener: GovernanceEventListener<E>,
  ): this {
    this.#addListener(event, listener as (payload: unknown) => void, false);
    return this;
  }

  /**
   * Registers a one-shot listener for the specified event.
   *
   * The listener is called at most once; it is automatically removed after
   * the first invocation.
   *
   * @param event    - The event name constant.
   * @param listener - The callback to invoke with the typed payload.
   * @returns `this` for fluent chaining.
   */
  once<E extends GovernanceEventName>(
    event: E,
    listener: GovernanceEventListener<E>,
  ): this {
    this.#addListener(event, listener as (payload: unknown) => void, true);
    return this;
  }

  /**
   * Removes a previously registered listener for the specified event.
   *
   * If the listener was registered multiple times, only the first matching
   * entry is removed.
   *
   * @param event    - The event name constant.
   * @param listener - The callback reference to remove.
   * @returns `this` for fluent chaining.
   */
  off<E extends GovernanceEventName>(
    event: E,
    listener: GovernanceEventListener<E>,
  ): this {
    const entries = this.#listeners.get(event);
    if (entries === undefined) return this;

    const index = entries.findIndex(
      (entry) => entry.listener === (listener as (payload: unknown) => void),
    );
    if (index !== -1) {
      entries.splice(index, 1);
    }
    if (entries.length === 0) {
      this.#listeners.delete(event);
    }
    return this;
  }

  /**
   * Emits an event, invoking all registered listeners synchronously in the
   * order they were registered.
   *
   * One-shot listeners are removed before invocation to prevent re-entrant
   * double-fire if the listener itself emits the same event.
   *
   * @param event   - The event name constant.
   * @param payload - The typed payload for the event.
   * @returns `true` if at least one listener was invoked; `false` otherwise.
   */
  emit<E extends GovernanceEventName>(
    event: E,
    payload: GovernanceEventPayloadMap[E],
  ): boolean {
    const entries = this.#listeners.get(event);
    if (entries === undefined || entries.length === 0) return false;

    // Snapshot the entries array before iterating so that listeners added or
    // removed during emission do not affect the current call.
    const snapshot = [...entries];

    // Remove once-listeners before invoking them (prevents double-fire).
    const remaining = entries.filter((entry) => !entry.once);
    if (remaining.length !== entries.length) {
      if (remaining.length === 0) {
        this.#listeners.delete(event);
      } else {
        this.#listeners.set(event, remaining);
      }
    }

    for (const { listener } of snapshot) {
      listener(payload);
    }

    return true;
  }

  /**
   * Removes all listeners for the specified event, or all listeners for all
   * events if no event is specified.
   *
   * @param event - Optional event to clear.  Clears all events if omitted.
   * @returns `this` for fluent chaining.
   */
  removeAllListeners(event?: GovernanceEventName): this {
    if (event !== undefined) {
      this.#listeners.delete(event);
    } else {
      this.#listeners.clear();
    }
    return this;
  }

  /**
   * Returns the number of listeners currently registered for the specified event.
   *
   * @param event - The event name to count listeners for.
   */
  listenerCount(event: GovernanceEventName): number {
    return this.#listeners.get(event)?.length ?? 0;
  }

  /**
   * Returns a copy of all registered listener callbacks for the specified event.
   */
  listeners<E extends GovernanceEventName>(event: E): ReadonlyArray<GovernanceEventListener<E>> {
    const entries = this.#listeners.get(event);
    if (entries === undefined) return [];
    return entries.map((entry) => entry.listener as GovernanceEventListener<E>);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  #addListener(
    event: GovernanceEventName,
    listener: (payload: unknown) => void,
    once: boolean,
  ): void {
    const existing = this.#listeners.get(event);
    if (existing !== undefined) {
      existing.push({ listener, once });
    } else {
      this.#listeners.set(event, [{ listener, once }]);
    }
  }
}

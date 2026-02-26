// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * The six trust levels in the AumOS trust ladder.
 * Each level grants progressively broader autonomy to an AI agent.
 * Levels are integers 0–5 for easy numeric comparison.
 */
export const TRUST_LEVELS = {
  /** Read-only observation. No execution capability. */
  OBSERVER: 0,
  /** Can read state and emit structured status signals. */
  MONITOR: 1,
  /** Can generate recommendations for human review. */
  SUGGEST: 2,
  /** Can execute actions that require explicit human sign-off. */
  ACT_WITH_APPROVAL: 3,
  /** Can execute actions and must report outcomes afterward. */
  ACT_AND_REPORT: 4,
  /** Full execution autonomy within assigned scope. */
  AUTONOMOUS: 5,
} as const;

export type TrustLevelValue = (typeof TRUST_LEVELS)[keyof typeof TRUST_LEVELS];

/** Human-readable name for each trust level. */
export const TRUST_LEVEL_NAMES: Readonly<Record<TrustLevelValue, string>> = {
  0: "OBSERVER",
  1: "MONITOR",
  2: "SUGGEST",
  3: "ACT_WITH_APPROVAL",
  4: "ACT_AND_REPORT",
  5: "AUTONOMOUS",
};

/** One-line description of each trust level's capability. */
export const TRUST_LEVEL_DESCRIPTIONS: Readonly<Record<TrustLevelValue, string>> = {
  0: "Read-only observation; no execution capability.",
  1: "State monitoring and structured status signaling.",
  2: "Recommendation generation for human review.",
  3: "Action execution requiring explicit human approval.",
  4: "Action execution with mandatory post-hoc reporting.",
  5: "Full autonomous execution within the assigned scope.",
};

/** Minimum numeric trust level (floor for decay). */
export const TRUST_LEVEL_MIN: TrustLevelValue = TRUST_LEVELS.OBSERVER;

/** Maximum numeric trust level. */
export const TRUST_LEVEL_MAX: TrustLevelValue = TRUST_LEVELS.AUTONOMOUS;

/** Total number of distinct trust levels. */
export const TRUST_LEVEL_COUNT = 6 as const;

/**
 * Returns true if the given number is a valid trust level integer (0–5).
 */
export function isValidTrustLevel(value: unknown): value is TrustLevelValue {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= TRUST_LEVEL_MIN &&
    value <= TRUST_LEVEL_MAX
  );
}

/**
 * Returns the name string for a numeric trust level.
 * Throws if the level is out of range.
 */
export function trustLevelName(level: number): string {
  if (!isValidTrustLevel(level)) {
    throw new RangeError(
      `Trust level ${level} is out of range [${TRUST_LEVEL_MIN}, ${TRUST_LEVEL_MAX}].`
    );
  }
  return TRUST_LEVEL_NAMES[level];
}

/**
 * Returns the description string for a numeric trust level.
 * Throws if the level is out of range.
 */
export function trustLevelDescription(level: number): string {
  if (!isValidTrustLevel(level)) {
    throw new RangeError(
      `Trust level ${level} is out of range [${TRUST_LEVEL_MIN}, ${TRUST_LEVEL_MAX}].`
    );
  }
  return TRUST_LEVEL_DESCRIPTIONS[level];
}

/**
 * Clamps a raw number to the valid trust-level range [0, 5].
 * Used internally by decay mechanics to prevent underflow/overflow.
 */
export function clampTrustLevel(value: number): TrustLevelValue {
  const clamped = Math.max(TRUST_LEVEL_MIN, Math.min(TRUST_LEVEL_MAX, Math.round(value)));
  return clamped as TrustLevelValue;
}

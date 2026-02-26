// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { TrustLevel, TRUST_LEVEL_NAMES } from '../types.js';
import type { TrustCheckResult } from '../types.js';

/**
 * Validates whether an effective trust level satisfies a required minimum.
 *
 * This function is the single source of truth for permit/deny logic within
 * the trust sub-system.  It is intentionally stateless so it can be called
 * freely from tests or higher-level orchestrators.
 *
 * @param agentId       - Identifier of the agent being evaluated.
 * @param effectiveLevel - The agent's current effective trust level
 *                        (after decay has been applied by the caller).
 * @param requiredLevel  - Minimum level the action demands.
 * @returns A TrustCheckResult with a populated `reason` on denial.
 */
export function validateTrustLevel(
  agentId: string,
  effectiveLevel: TrustLevel,
  requiredLevel: TrustLevel,
): TrustCheckResult {
  const permitted = (effectiveLevel as number) >= (requiredLevel as number);

  if (permitted) {
    return {
      permitted: true,
      currentLevel: effectiveLevel,
      requiredLevel,
    };
  }

  const currentName = TRUST_LEVEL_NAMES[effectiveLevel];
  const requiredName = TRUST_LEVEL_NAMES[requiredLevel];

  return {
    permitted: false,
    currentLevel: effectiveLevel,
    requiredLevel,
    reason:
      `Agent "${agentId}" has trust level "${currentName}" (${effectiveLevel}) ` +
      `but the action requires "${requiredName}" (${requiredLevel}) or higher.`,
  };
}

/**
 * Validates that a proposed trust level is a valid TrustLevel enum member.
 * Returns the numeric value on success or throws if the value is out of range.
 */
export function assertValidTrustLevel(value: number): TrustLevel {
  const validValues: number[] = Object.values(TrustLevel).filter(
    (v): v is number => typeof v === 'number',
  );
  if (!validValues.includes(value)) {
    throw new RangeError(
      `Invalid trust level: ${value}. Must be one of ${validValues.join(', ')}.`,
    );
  }
  return value as TrustLevel;
}

// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * Load governance policies from YAML or JSON files.
 *
 * YAML parsing requires the `js-yaml` package (listed as a devDependency).
 * In production bundles, callers that only use JSON can avoid the js-yaml
 * import by always passing `format: 'json'`.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ZodError } from 'zod';

import {
  GovernancePolicySchema,
  type GovernancePolicy,
  type ValidationResult,
} from './policy-schema.js';

// ---------------------------------------------------------------------------
// Internal YAML loading — dynamic import to keep js-yaml optional at build time
// ---------------------------------------------------------------------------

async function parseYaml(content: string): Promise<unknown> {
  // js-yaml is a devDependency; dynamic import avoids bundling it unless needed.
  const yaml = await import('js-yaml' as string);
  return yaml.load(content);
}

function parseYamlSync(content: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml') as { load(s: string): unknown };
  return yaml.load(content);
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Detect the format (yaml/json) from a file extension.
 * Defaults to 'yaml' for unknown extensions.
 */
function detectFormat(filePath: string): 'yaml' | 'json' {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  return 'yaml';
}

/**
 * Parse and validate a raw object against the GovernancePolicySchema.
 *
 * @throws {PolicyParseError} when the document does not match the schema.
 */
function parseRawPolicy(raw: unknown, source: string): GovernancePolicy {
  const result = GovernancePolicySchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`,
    );
    throw new PolicyParseError(
      `Invalid governance policy in "${source}": ${messages.join('; ')}`,
      result.error,
    );
  }
  return result.data;
}

/**
 * Load a governance policy from a YAML or JSON file asynchronously.
 *
 * The format is inferred from the file extension (.yaml/.yml → yaml, .json → json).
 *
 * @param filePath - Absolute or relative path to the policy file.
 * @returns Parsed and validated GovernancePolicy.
 * @throws {PolicyParseError} on parse or validation failure.
 */
export async function loadPolicy(filePath: string): Promise<GovernancePolicy> {
  const content = await readFile(filePath, 'utf8');
  const format = detectFormat(filePath);
  return loadPolicyFromString(content, format, filePath);
}

/**
 * Load a governance policy from a raw string synchronously.
 *
 * @param content - YAML or JSON document as a string.
 * @param format - The format of the document ('yaml' | 'json').
 * @param source - An optional label used in error messages (e.g. the file path).
 * @returns Parsed and validated GovernancePolicy.
 * @throws {PolicyParseError} on parse or validation failure.
 */
export function loadPolicyFromString(
  content: string,
  format: 'yaml' | 'json',
  source = '<string>',
): GovernancePolicy {
  let raw: unknown;
  try {
    if (format === 'json') {
      raw = JSON.parse(content) as unknown;
    } else {
      raw = parseYamlSync(content);
    }
  } catch (err) {
    throw new PolicyParseError(
      `Failed to parse ${format.toUpperCase()} in "${source}": ${String(err)}`,
    );
  }
  return parseRawPolicy(raw, source);
}

/**
 * Load a governance policy from a YAML or JSON file asynchronously using
 * async YAML parsing (avoids the synchronous require() call).
 *
 * @param filePath - Absolute or relative path to the policy file.
 * @returns Parsed and validated GovernancePolicy.
 */
export async function loadPolicyAsync(
  filePath: string,
): Promise<GovernancePolicy> {
  const content = await readFile(filePath, 'utf8');
  const format = detectFormat(filePath);

  let raw: unknown;
  try {
    if (format === 'json') {
      raw = JSON.parse(content) as unknown;
    } else {
      raw = await parseYaml(content);
    }
  } catch (err) {
    throw new PolicyParseError(
      `Failed to parse ${format.toUpperCase()} in "${filePath}": ${String(err)}`,
    );
  }
  return parseRawPolicy(raw, filePath);
}

/**
 * Load a governance policy from a file synchronously.
 *
 * @param filePath - Absolute or relative path to the policy file.
 * @returns Parsed and validated GovernancePolicy.
 */
export function loadPolicySync(filePath: string): GovernancePolicy {
  const content = readFileSync(filePath, 'utf8');
  const format = detectFormat(filePath);
  return loadPolicyFromString(content, format, filePath);
}

/**
 * Validate a GovernancePolicy object without throwing.
 *
 * @param policy - The policy object to validate (may be partially constructed).
 * @returns A ValidationResult with `valid` flag and array of error strings.
 */
export function validatePolicy(policy: GovernancePolicy): ValidationResult {
  const result = GovernancePolicySchema.safeParse(policy);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.errors.map(
    (e) => `${e.path.join('.')}: ${e.message}`,
  );
  return { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when a policy file or string cannot be parsed or fails schema
 * validation.
 */
export class PolicyParseError extends Error {
  readonly zodError?: ZodError;

  constructor(message: string, zodError?: ZodError) {
    super(message);
    this.name = 'PolicyParseError';
    this.zodError = zodError;
  }
}

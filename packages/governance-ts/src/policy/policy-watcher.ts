// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * PolicyWatcher — watch policy files for changes and auto-reload.
 *
 * Intended for development environments where hot-reload of governance
 * policies eliminates the need to restart the process after a policy edit.
 *
 * Usage:
 * ```typescript
 * const watcher = new PolicyWatcher(['/etc/aumos/default-policy.yaml']);
 * watcher.onPolicyChange((policies) => engine.setPolicies(policies));
 * await watcher.start();
 * // ... later ...
 * watcher.stop();
 * ```
 *
 * In production, prefer loading policies once at start-up and reloading them
 * via a deployment mechanism (e.g. k8s ConfigMap rollout) rather than relying
 * on in-process file watching.
 */

import { watch, type FSWatcher } from 'node:fs';
import { loadPolicyAsync } from './policy-loader.js';
import type { GovernancePolicy } from './policy-schema.js';

export type PolicyChangeCallback = (
  policies: ReadonlyArray<GovernancePolicy>,
) => void;

export type PolicyErrorCallback = (error: Error, filePath: string) => void;

/**
 * Watches a set of policy files and notifies listeners when any file changes.
 *
 * Multiple files may be watched simultaneously. When any file changes all
 * registered files are re-read and the full set of valid policies is delivered
 * to subscribers.
 */
export class PolicyWatcher {
  readonly #filePaths: ReadonlyArray<string>;
  readonly #changeCallbacks: Array<PolicyChangeCallback> = [];
  readonly #errorCallbacks: Array<PolicyErrorCallback> = [];
  readonly #watchers: Map<string, FSWatcher> = new Map();

  /** Minimum milliseconds between two successive reload attempts. */
  readonly #debounceMs: number;

  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #currentPolicies: ReadonlyArray<GovernancePolicy> = [];
  #started = false;

  /**
   * @param filePaths - Absolute paths to the policy files to watch.
   * @param debounceMs - Debounce window (default: 200 ms) to coalesce rapid
   *   successive change events from the OS.
   */
  constructor(filePaths: ReadonlyArray<string>, debounceMs = 200) {
    this.#filePaths = filePaths;
    this.#debounceMs = debounceMs;
  }

  /**
   * Register a callback that is invoked with the full set of currently valid
   * policies whenever any watched file changes.
   *
   * The callback is also called once immediately with the current policies
   * when `start()` completes the initial load.
   */
  onPolicyChange(callback: PolicyChangeCallback): this {
    this.#changeCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback that is invoked when a file cannot be read or parsed.
   * The failed file is skipped; other valid policies are still delivered to
   * `onPolicyChange` listeners.
   */
  onError(callback: PolicyErrorCallback): this {
    this.#errorCallbacks.push(callback);
    return this;
  }

  /**
   * Start watching files.
   *
   * Performs an initial load of all files, then attaches `fs.watch` listeners.
   * Returns when the initial load completes.
   *
   * @throws {Error} if called more than once without `stop()` in between.
   */
  async start(): Promise<void> {
    if (this.#started) {
      throw new Error('PolicyWatcher is already started.');
    }
    this.#started = true;

    await this.#reload();

    for (const filePath of this.#filePaths) {
      const watcher = watch(filePath, { persistent: false }, () => {
        this.#scheduleReload();
      });
      this.#watchers.set(filePath, watcher);
    }
  }

  /**
   * Stop watching all files and clear all pending timers.
   * Safe to call multiple times.
   */
  stop(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    for (const watcher of this.#watchers.values()) {
      watcher.close();
    }
    this.#watchers.clear();
    this.#started = false;
  }

  /**
   * The most recently loaded set of valid policies.
   * Empty array until `start()` completes.
   */
  get currentPolicies(): ReadonlyArray<GovernancePolicy> {
    return this.#currentPolicies;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #scheduleReload(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
    }
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#reload();
    }, this.#debounceMs);
  }

  async #reload(): Promise<void> {
    const settled = await Promise.allSettled(
      this.#filePaths.map((fp) => loadPolicyAsync(fp)),
    );

    const policies: GovernancePolicy[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        policies.push(result.value);
      } else {
        const error =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));
        const filePath = this.#filePaths[i] ?? '<unknown>';
        this.#notifyError(error, filePath);
      }
    }

    this.#currentPolicies = policies;
    this.#notifyChange(policies);
  }

  #notifyChange(policies: ReadonlyArray<GovernancePolicy>): void {
    for (const callback of this.#changeCallbacks) {
      callback(policies);
    }
  }

  #notifyError(error: Error, filePath: string): void {
    for (const callback of this.#errorCallbacks) {
      callback(error, filePath);
    }
  }
}

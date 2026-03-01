// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — TypeScript SDK for building governance-aware AI agent applications.
 *
 * Public API surface:
 *
 * Engine
 *   GovernanceEngine   — compose trust, budget, consent, and audit into one pipeline
 *
 * Sub-managers (usable standalone or via GovernanceEngine)
 *   TrustManager       — manage agent trust level assignments
 *   BudgetManager      — manage per-category spending envelopes (deprecated; use @aumos/budget-enforcer)
 *   ConsentManager     — record and enforce data access consent
 *   AuditLogger        — append-only governance decision log
 *
 * Types
 *   TrustLevel, TrustAssignment, TrustCheckResult
 *   SpendingEnvelope, BudgetCheckResult, BudgetUtilization, BudgetPeriod
 *   ConsentRecord
 *   ActionCategory
 *   GovernanceAction, GovernanceDecision
 *   AuditRecord, AuditFilter, AuditContext
 *
 * Config (Zod schemas + parsed types)
 *   GovernanceConfig, TrustConfig, BudgetConfig, ConsentConfig, AuditConfig
 *   GovernanceConfigSchema, TrustConfigSchema, BudgetConfigSchema,
 *   ConsentConfigSchema, AuditConfigSchema
 *
 * Errors
 *   GovernanceError, TrustDeniedError, BudgetExceededError,
 *   ConsentRequiredError, InvalidConfigError
 *
 * Streaming governance
 *   GovernedStream         — govern AsyncIterable<string> token streams
 *   StreamHaltedError      — thrown when a stream is halted by governance
 *   createGovernedStream   — factory for AsyncIterable-based governed streams
 *
 * Agent Memory Governance (AMGP)
 *   MemoryGovernor         — evaluate and record memory access decisions
 *   RetentionPolicyEngine  — evaluate retention policies and expiry
 *   parseDurationMs        — parse ISO 8601 durations to milliseconds
 *   computeExpiresAt       — compute expiry timestamps from retention policies
 *
 * Multi-Model Cost Tracking
 *   CostTracker            — record LLM usage and generate cost summaries
 *   ModelPricingRegistry   — register and look up per-model pricing
 */

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export { GovernanceEngine } from './governance.js';
export { ReferenceGovernanceEngine } from './reference-engine.js';
export type { ReferenceEngineConfig } from './reference-engine.js';

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------
export { TrustManager } from './trust/manager.js';
export type { SetLevelOptions } from './trust/manager.js';
export { computeEffectiveLevel, isExpired } from './trust/decay.js';
export { validateTrustLevel, assertValidTrustLevel } from './trust/validator.js';

// ---------------------------------------------------------------------------
// Budget
//
// NOTE: BudgetManager is deprecated. New callers should use BudgetEnforcer
// from the @aumos/budget-enforcer package, which provides commit/release
// semantics and envelope suspension in addition to the core check/record API.
// BudgetManager will be removed in v1.0.
// ---------------------------------------------------------------------------
export { BudgetManager } from './budget/manager.js';
export { SpendingTracker, computeNextResetAt } from './budget/tracker.js';
export type { SpendingTransaction } from './budget/tracker.js';
export { isPeriodExpired, resetEnvelope, applyRolloverIfDue } from './budget/policy.js';

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
export { ConsentManager } from './consent/manager.js';
export type { RecordConsentOptions, ConsentCheckResult } from './consent/manager.js';
export { ConsentStore } from './consent/store.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export { AuditLogger } from './audit/logger.js';
export { createAuditRecord } from './audit/record.js';
export type { AuditRecord, AuditContext } from './audit/record.js';
export { filterRecords } from './audit/query.js';
export type { AuditFilter } from './audit/query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  TrustLevel,
  TRUST_LEVEL_NAMES,
} from './types.js';
export type {
  Timestamp,
  AgentId,
  TrustAssignment,
  TrustCheckResult,
  BudgetPeriod,
  SpendingEnvelope,
  BudgetCheckResult,
  BudgetUtilization,
  ConsentRecord,
  ActionCategory,
  GovernanceAction,
  GovernanceDecision,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export {
  GovernanceConfigSchema,
  TrustConfigSchema,
  BudgetConfigSchema,
  ConsentConfigSchema,
  AuditConfigSchema,
  parseGovernanceConfig,
  parseTrustConfig,
  parseBudgetConfig,
  parseConsentConfig,
  parseAuditConfig,
} from './config.js';
export type {
  GovernanceConfig,
  TrustConfig,
  BudgetConfig,
  ConsentConfig,
  AuditConfig,
} from './config.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export {
  GovernanceError,
  TrustDeniedError,
  BudgetExceededError,
  ConsentRequiredError,
  InvalidConfigError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
export {
  GovernedStream,
  LegacyGovernedReadableStream,
  StreamHaltedError,
  createGovernedStream,
  createGovernedReadableStream,
} from './streaming.js';
export type {
  StreamGovernanceCheckResult,
  StreamGovernanceCallback,
  GovernedStreamConfig,
  LegacyStreamGovernanceCheckResult,
  LegacyStreamGovernanceCallback,
  LegacyGovernedStreamConfig,
} from './streaming.js';

// ---------------------------------------------------------------------------
// Storage adapters
// ---------------------------------------------------------------------------
export type { StorageAdapter, AuditStorageFilter } from './storage/adapter.js';
export { MemoryStorageAdapter } from './storage/memory.js';
export { RedisStorageAdapter } from './storage/redis.js';
export type { RedisClientLike, RedisStorageConfig } from './storage/redis.js';
export { SQLiteStorageAdapter } from './storage/sqlite.js';
export type { SQLiteDatabaseLike, SQLiteStatementLike, SQLiteStorageConfig } from './storage/sqlite.js';
export { PostgresStorageAdapter } from './storage/postgres.js';
export type { PostgresClientLike, PostgresStorageConfig } from './storage/postgres.js';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export {
  GovernanceEventEmitter,
  EVENT_DECISION,
  EVENT_BUDGET_WARNING,
  EVENT_TRUST_DENIED,
  EVENT_AUDIT_LOGGED,
} from './events.js';
export type {
  GovernanceEventName,
  GovernanceEventPayloadMap,
  GovernanceDecisionEventPayload,
  GovernanceBudgetWarningEventPayload,
  GovernanceTrustDeniedEventPayload,
  GovernanceAuditLoggedEventPayload,
  GovernanceEventListener,
} from './events.js';

// ---------------------------------------------------------------------------
// Integrations — Vercel AI SDK
// ---------------------------------------------------------------------------
export {
  VercelAIGovernanceConfigSchema,
  GovernedAI,
  GovernanceDeniedError,
  createGovernedAI,
} from './integrations/vercel-ai.js';
export type {
  VercelAIGovernanceConfig,
  GovernanceMiddlewareResult,
  BeforeRequestParams,
} from './integrations/vercel-ai.js';

// ---------------------------------------------------------------------------
// Integrations — OpenAI wrapper
// ---------------------------------------------------------------------------
export {
  GovernedOpenAI,
  GovernedOpenAIConfigSchema,
  TrustLevelInsufficientError,
} from './integrations/openai-wrapper.js';
export type {
  GovernedOpenAIConfig,
  OpenAIChatMessage,
  OpenAIChatCompletionParams,
  OpenAIClientLike,
  OpenAIGovernanceAuditRecord,
} from './integrations/openai-wrapper.js';

// ---------------------------------------------------------------------------
// Integrations — Anthropic wrapper
// ---------------------------------------------------------------------------
export {
  GovernedAnthropic,
  GovernedAnthropicConfigSchema,
} from './integrations/anthropic-wrapper.js';
export type {
  GovernedAnthropicConfig,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicMessagesCreateParams,
  AnthropicClientLike,
  AnthropicGovernanceAuditRecord,
} from './integrations/anthropic-wrapper.js';

// ---------------------------------------------------------------------------
// Integrations — Express middleware
// ---------------------------------------------------------------------------
export { governanceMiddleware } from './integrations/express-middleware.js';
export type {
  ExpressGovernanceMiddlewareConfig,
  RequestGovernanceContext,
  GovernanceRequest,
  ExpressRequest,
  ExpressResponse,
  ExpressNextFunction,
} from './integrations/express-middleware.js';

// ---------------------------------------------------------------------------
// Integrations — Fastify plugin
// ---------------------------------------------------------------------------
export {
  governanceFastifyPlugin,
  governancePluginMeta,
} from './integrations/fastify-plugin.js';
export type {
  FastifyGovernancePluginOptions,
  FastifyRequestGovernanceContext,
  FastifyInstanceGovernanceConfig,
  FastifyRequestLike,
  FastifyReplyLike,
  FastifyInstanceLike,
} from './integrations/fastify-plugin.js';

// ---------------------------------------------------------------------------
// Integrations — Hono middleware
// ---------------------------------------------------------------------------
export { governanceHonoMiddleware } from './integrations/hono-middleware.js';
export type {
  HonoGovernanceMiddlewareConfig,
  HonoGovernanceContext,
  HonoContextLike,
  HonoNext,
  HonoMiddlewareHandler,
} from './integrations/hono-middleware.js';

// ---------------------------------------------------------------------------
// Policy-as-code
// ---------------------------------------------------------------------------
export {
  // Zod schemas
  GovernancePolicySchema,
  PolicyMetadataSchema,
  PolicyMatchSchema,
  PolicyActionSchema,
  PolicyRuleSchema,
  PolicyDefaultsSchema,
  PolicySpecSchema,
  // Loaders
  loadPolicy,
  loadPolicyAsync,
  loadPolicySync,
  loadPolicyFromString,
  validatePolicy,
  PolicyParseError,
  // Engine
  PolicyEngine,
  // Watcher
  PolicyWatcher,
} from './policy/index.js';
export type {
  GovernancePolicy,
  PolicyMetadata,
  PolicyMatch,
  PolicyAction,
  PolicyRule,
  PolicyDefaults,
  PolicySpec,
  ValidationResult,
  GovernanceRequest,
  PolicyDecision,
  PolicyChangeCallback,
  PolicyErrorCallback,
} from './policy/index.js';

// ---------------------------------------------------------------------------
// Integrations — LangChain.js tool wrapper
// ---------------------------------------------------------------------------
export {
  GovernedLangChainTool,
  GovernedLangChainToolConfigSchema,
  LangChainToolGovernanceDeniedError,
  LangChainToolTrustInsufficientError,
} from './integrations/langchain-js.js';
export type {
  GovernedLangChainToolConfig,
  LangChainToolAuditRecord,
  LangChainToolLike,
} from './integrations/langchain-js.js';

// ---------------------------------------------------------------------------
// Integrations — Mastra tool wrapper
// ---------------------------------------------------------------------------
export {
  GovernedMastraTool,
  GovernedMastraToolConfigSchema,
  MastraToolGovernanceDeniedError,
  MastraToolTrustInsufficientError,
} from './integrations/mastra.js';
export type {
  GovernedMastraToolConfig,
  MastraToolAuditRecord,
  MastraToolLike,
} from './integrations/mastra.js';

// ---------------------------------------------------------------------------
// Agent Memory Governance (AMGP)
// ---------------------------------------------------------------------------
export { MemoryGovernor } from './memory/governor.js';
export type { CreateMemorySlotParams } from './memory/governor.js';
export { RetentionPolicyEngine, parseDurationMs, computeExpiresAt } from './memory/retention.js';
export type {
  MemoryCategory,
  MemoryAccessRequest,
  MemoryGovernanceDecision,
  RetentionPolicy,
  GovernedMemoryRecord,
  MemoryAccessLogEntry,
  MemoryGovernorConfig,
  ForgetRequest,
  ForgetResult,
} from './memory/types.js';

// ---------------------------------------------------------------------------
// Multi-Model Cost Tracking
// ---------------------------------------------------------------------------
export { CostTracker } from './cost/tracker.js';
export type { RecordRawParams } from './cost/tracker.js';
export { ModelPricingRegistry } from './cost/provider-registry.js';
export type {
  ModelProvider,
  ModelPricing,
  LLMUsageRecord,
  CostSummary,
  CostBudgetCheckResult,
  CostTrackerConfig,
} from './cost/types.js';

// ---------------------------------------------------------------------------
// Telemetry (OpenTelemetry instrumentation)
// ---------------------------------------------------------------------------
export { GovernanceTracer } from './telemetry/otel.js';
export type {
  OTelSpanLike,
  OTelTracerLike,
  GovernanceOTelConfig,
} from './telemetry/otel.js';

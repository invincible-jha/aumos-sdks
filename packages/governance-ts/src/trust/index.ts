// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

export { TrustManager } from './manager.js';
export type { SetLevelOptions } from './manager.js';
export { computeEffectiveLevel, isExpired } from './decay.js';
export { validateTrustLevel, assertValidTrustLevel } from './validator.js';

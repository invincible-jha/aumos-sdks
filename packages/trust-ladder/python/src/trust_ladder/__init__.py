# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
trust-ladder — 6-level graduated autonomy for AI agents with formal trust decay.

Key invariants:
- Trust changes are MANUAL ONLY — no automatic promotion or behavioural scoring.
- Decay is strictly one-directional — effective levels only decrease.
- Each (agent_id, scope) pair holds a single integer trust level [0, 5].
- Scopes are independent — no inference across scope boundaries.
"""

from .assignment import AssignmentStore, validate_agent_id, validate_level
from .config import (
    CliffDecayConfig,
    GradualDecayConfig,
    NoDecayConfig,
    ResolvedTrustLadderConfig,
    TrustLadderConfig,
    resolve_config,
)
from .decay import DecayEngine, DecayResult, compute_effective_level, time_until_next_decay
from .ladder import TrustLadder
from .levels import (
    TRUST_LEVEL_COUNT,
    TRUST_LEVEL_DESCRIPTIONS,
    TRUST_LEVEL_MAX,
    TRUST_LEVEL_MIN,
    TrustLevel,
    clamp_trust_level,
    is_valid_trust_level,
    trust_level_description,
    trust_level_name,
)
from .scope import (
    assignments_for_agent,
    assignments_for_scope,
    distinct_agent_ids,
    distinct_scopes,
    history_by_kind,
    history_in_window,
    max_level_per_scope,
)
from .types import (
    TrustAssignment,
    TrustChangeKind,
    TrustChangeRecord,
    TrustCheckResult,
    build_scope_key,
)

__all__ = [
    # Core ladder
    "TrustLadder",
    # Level constants and helpers
    "TrustLevel",
    "TRUST_LEVEL_MIN",
    "TRUST_LEVEL_MAX",
    "TRUST_LEVEL_COUNT",
    "TRUST_LEVEL_DESCRIPTIONS",
    "is_valid_trust_level",
    "trust_level_name",
    "trust_level_description",
    "clamp_trust_level",
    # Configuration
    "TrustLadderConfig",
    "CliffDecayConfig",
    "GradualDecayConfig",
    "NoDecayConfig",
    "ResolvedTrustLadderConfig",
    "resolve_config",
    # Types
    "TrustAssignment",
    "TrustChangeRecord",
    "TrustChangeKind",
    "TrustCheckResult",
    "build_scope_key",
    # Decay engine and helpers
    "DecayEngine",
    "DecayResult",
    "compute_effective_level",
    "time_until_next_decay",
    # Storage
    "AssignmentStore",
    "validate_agent_id",
    "validate_level",
    # Scope helpers
    "assignments_for_agent",
    "assignments_for_scope",
    "distinct_scopes",
    "distinct_agent_ids",
    "max_level_per_scope",
    "history_in_window",
    "history_by_kind",
]

__version__ = "0.1.0"

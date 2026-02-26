# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Configuration models for TrustLadder instances.

Pydantic v2 models provide runtime validation at system boundaries.
All fields have explicit types and descriptions for self-documenting configs.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Decay configuration — discriminated union on the ``type`` field
# ---------------------------------------------------------------------------


class CliffDecayConfig(BaseModel, frozen=True):
    """
    Cliff decay: trust drops to OBSERVER (L0) when *ttl_ms* elapses
    since the assignment timestamp.
    """

    enabled: Literal[True] = True
    type: Literal["cliff"] = "cliff"
    ttl_ms: int = Field(
        ...,
        gt=0,
        description="Milliseconds after assignment before trust drops to L0.",
    )


class GradualDecayConfig(BaseModel, frozen=True):
    """
    Gradual decay: trust decreases by one level for each complete
    *step_interval_ms* that elapses since the assignment timestamp.
    The effective level never goes below OBSERVER (L0).
    """

    enabled: Literal[True] = True
    type: Literal["gradual"] = "gradual"
    step_interval_ms: int = Field(
        ...,
        gt=0,
        description="Milliseconds between each single-level decrease.",
    )


class NoDecayConfig(BaseModel, frozen=True):
    """Decay disabled — effective level always equals the assigned level."""

    enabled: Literal[False] = False
    type: Literal["cliff", "gradual"] | None = None


DecayConfig = Annotated[
    Union[CliffDecayConfig, GradualDecayConfig, NoDecayConfig],
    Field(discriminator="enabled"),
]
"""
Union type for decay configuration.

Use ``CliffDecayConfig``, ``GradualDecayConfig``, or ``NoDecayConfig``
directly, or let Pydantic discriminate via the ``enabled`` field.
"""


# ---------------------------------------------------------------------------
# Top-level TrustLadder configuration
# ---------------------------------------------------------------------------


class TrustLadderConfig(BaseModel):
    """
    Configuration for a TrustLadder instance.

    All fields are optional with sensible defaults applied by
    ``resolve_config()``.
    """

    decay: CliffDecayConfig | GradualDecayConfig | NoDecayConfig = Field(
        default_factory=NoDecayConfig,
        description="Decay settings applied to every assignment in this ladder.",
    )
    default_scope: str = Field(
        default="",
        description=(
            "Default scope string used when no scope is provided to API calls. "
            "Empty string represents the global scope."
        ),
    )
    max_history_per_scope: int = Field(
        default=1000,
        ge=0,
        description=(
            "Maximum history entries retained per (agent_id, scope) pair. "
            "0 means unlimited."
        ),
    )


# ---------------------------------------------------------------------------
# Resolved (fully-defaulted) configuration
# ---------------------------------------------------------------------------


class ResolvedTrustLadderConfig(BaseModel, frozen=True):
    """Internal fully-resolved configuration with all defaults applied."""

    decay: CliffDecayConfig | GradualDecayConfig | NoDecayConfig
    default_scope: str
    max_history_per_scope: int


def resolve_config(
    config: TrustLadderConfig | None = None,
) -> ResolvedTrustLadderConfig:
    """
    Merge a partial TrustLadderConfig with defaults to produce a fully
    resolved configuration.

    Args:
        config: Optional caller-supplied configuration. If None, all defaults
                are applied.

    Returns:
        A frozen ResolvedTrustLadderConfig ready for use by TrustLadder.
    """
    if config is None:
        config = TrustLadderConfig()

    return ResolvedTrustLadderConfig(
        decay=config.decay,
        default_scope=config.default_scope,
        max_history_per_scope=config.max_history_per_scope,
    )

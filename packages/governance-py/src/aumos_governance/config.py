# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field


class TrustConfig(BaseModel, frozen=True):
    """
    Configuration for the TrustManager.

    Attributes:
        default_level: Trust level assigned to unknown agents.
        enable_decay: Whether trust levels decay when agents are inactive.
        decay_cliff_days: Inactivity period (in days) before a trust level
            drops by one tier (cliff decay). Set to None to disable cliff decay.
        decay_gradual_days: Inactivity period (in days) before gradual decay
            begins reducing accumulated trust within a tier. Set to None to
            disable gradual decay.
    """

    default_level: Annotated[int, Field(ge=0, le=5)] = 1
    enable_decay: bool = False
    decay_cliff_days: Annotated[int, Field(gt=0)] | None = 90
    decay_gradual_days: Annotated[int, Field(gt=0)] | None = 30


class BudgetConfig(BaseModel, frozen=True):
    """
    Configuration for the BudgetManager.

    Attributes:
        allow_overdraft: When True, spending that would exceed the limit is
            recorded and tracked as a deficit rather than raising an error.
        rollover_on_reset: When True, unspent budget from the previous period
            is added to the next period's limit (capped at 2x the base limit).
    """

    allow_overdraft: bool = False
    rollover_on_reset: bool = False


class ConsentConfig(BaseModel, frozen=True):
    """
    Configuration for the ConsentManager.

    Attributes:
        default_deny: When True, absence of an explicit consent record is
            treated as denial. When False, absence is treated as approval
            (permissive mode — not recommended for production).
    """

    default_deny: bool = True


class AuditConfig(BaseModel, frozen=True):
    """
    Configuration for the AuditLogger.

    Attributes:
        max_records: Maximum number of audit records to retain in memory.
            Oldest records are evicted when this limit is reached.
        include_context: When True, the full action context is stored with
            each record. When False, only the decision summary is stored.
    """

    max_records: Annotated[int, Field(gt=0)] = 10_000
    include_context: bool = True


class GovernanceConfig(BaseModel, frozen=True):
    """
    Top-level configuration for the GovernanceEngine.

    Pass an instance of this to GovernanceEngine at construction time.
    All fields are optional — sensible defaults are provided for all.

    Example::

        config = GovernanceConfig(
            trust=TrustConfig(default_level=1, enable_decay=True),
            budget=BudgetConfig(allow_overdraft=False),
            consent=ConsentConfig(default_deny=True),
            audit=AuditConfig(max_records=5000),
        )
        engine = GovernanceEngine(config=config)
    """

    trust: TrustConfig = Field(default_factory=TrustConfig)
    budget: BudgetConfig = Field(default_factory=BudgetConfig)
    consent: ConsentConfig = Field(default_factory=ConsentConfig)
    audit: AuditConfig = Field(default_factory=AuditConfig)

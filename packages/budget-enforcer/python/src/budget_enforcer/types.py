# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# ─── Period ───────────────────────────────────────────────────────────────────

Period = Literal["hourly", "daily", "weekly", "monthly", "total"]

PERIOD_SECONDS: dict[str, int] = {
    "hourly": 3_600,
    "daily": 86_400,
    "weekly": 604_800,
    "monthly": 2_592_000,
}

# ─── Envelope ─────────────────────────────────────────────────────────────────


class EnvelopeConfig(BaseModel):
    """Input model for creating a spending envelope."""

    id: Optional[str] = None
    category: str = Field(..., min_length=1)
    limit: float = Field(..., gt=0, description="Maximum spend for the period")
    period: Period


class SpendingEnvelope(BaseModel):
    """Live state of a budget envelope for one category + period."""

    id: str
    category: str
    limit: float
    period: Period
    spent: float = 0.0
    committed: float = 0.0
    period_start: datetime = Field(default_factory=datetime.utcnow)
    suspended: bool = False

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("limit")
    @classmethod
    def limit_must_be_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("limit must be positive")
        return value


# ─── Check result ─────────────────────────────────────────────────────────────

CheckReason = Literal["within_budget", "exceeds_budget", "no_envelope", "suspended"]


class BudgetCheckResult(BaseModel):
    """Result of a budget check. Does not record any spending."""

    permitted: bool
    available: float
    requested: float
    limit: float
    spent: float
    committed: float
    reason: CheckReason


# ─── Commit ───────────────────────────────────────────────────────────────────


class CommitResult(BaseModel):
    """Result of a commit (pre-authorisation) attempt."""

    permitted: bool
    commit_id: Optional[str]
    available: float
    requested: float
    reason: CheckReason


class PendingCommit(BaseModel):
    """An in-flight pre-authorisation held against an envelope."""

    id: str
    category: str
    amount: float
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ─── Transaction ──────────────────────────────────────────────────────────────


class Transaction(BaseModel):
    """An immutable record of completed spending."""

    id: str
    category: str
    amount: float
    description: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    envelope_id: Optional[str] = None


class TransactionFilter(BaseModel):
    """Optional filter applied to transaction queries. All fields are AND-ed."""

    category: Optional[str] = None
    since: Optional[datetime] = None
    until: Optional[datetime] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None


# ─── Utilization ──────────────────────────────────────────────────────────────


class BudgetUtilization(BaseModel):
    """Point-in-time budget utilization snapshot for one envelope."""

    category: str
    envelope_id: str
    limit: float
    spent: float
    committed: float
    available: float
    utilization_percent: float
    period: Period
    period_start: datetime
    suspended: bool


# ─── Enforcer config ──────────────────────────────────────────────────────────


class BudgetEnforcerConfig(BaseModel):
    """Optional configuration for a BudgetEnforcer instance."""

    namespace: Optional[str] = None

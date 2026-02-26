# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
budget-enforcer — economic governance for AI agents.

Quick start::

    from budget_enforcer import BudgetEnforcer, EnvelopeConfig

    enforcer = BudgetEnforcer()
    enforcer.create_envelope(EnvelopeConfig(category="llm-calls", limit=10.0, period="daily"))

    result = enforcer.check("llm-calls", 0.05)
    if result.permitted:
        enforcer.record("llm-calls", 0.05, description="summarisation call")
"""

from budget_enforcer.enforcer import BudgetEnforcer
from budget_enforcer.envelope import (
    available_balance,
    create_envelope,
    is_period_expired,
    period_duration_seconds,
    refresh_envelope_period,
    utilization_percent,
)
from budget_enforcer.query import build_all_utilizations, build_utilization
from budget_enforcer.storage import BudgetStorage, MemoryStorage
from budget_enforcer.transaction import build_transaction, filter_transactions
from budget_enforcer.types import (
    PERIOD_SECONDS,
    BudgetCheckResult,
    BudgetEnforcerConfig,
    BudgetUtilization,
    CheckReason,
    CommitResult,
    EnvelopeConfig,
    PendingCommit,
    Period,
    SpendingEnvelope,
    Transaction,
    TransactionFilter,
)

__all__ = [
    # Core class
    "BudgetEnforcer",
    # Types
    "Period",
    "PERIOD_SECONDS",
    "EnvelopeConfig",
    "SpendingEnvelope",
    "BudgetCheckResult",
    "CheckReason",
    "CommitResult",
    "PendingCommit",
    "Transaction",
    "TransactionFilter",
    "BudgetUtilization",
    "BudgetEnforcerConfig",
    # Storage
    "BudgetStorage",
    "MemoryStorage",
    # Utilities
    "create_envelope",
    "period_duration_seconds",
    "is_period_expired",
    "refresh_envelope_period",
    "available_balance",
    "utilization_percent",
    "build_transaction",
    "filter_transactions",
    "build_utilization",
    "build_all_utilizations",
]

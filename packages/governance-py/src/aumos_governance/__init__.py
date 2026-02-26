# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
aumos-governance — Python SDK for governance-aware AI agent applications.

Quick start::

    from aumos_governance import GovernanceEngine, GovernanceAction, TrustLevel

    engine = GovernanceEngine()
    engine.trust.set_level("my-agent", TrustLevel.L3_ACT_APPROVE)
    engine.budget.create_budget("llm", limit=50.0, period="monthly")
    engine.consent.record_consent(
        "my-agent", "user_data", purpose="support", granted_by="admin"
    )

    import asyncio
    decision = asyncio.run(engine.evaluate(GovernanceAction(
        agent_id="my-agent",
        required_trust_level=TrustLevel.L2_SUGGEST,
        budget_category="llm",
        budget_amount=1.0,
        data_type="user_data",
        purpose="support",
    )))
    print(decision.allowed)  # True
"""
from __future__ import annotations

from aumos_governance.audit.logger import AuditLogger
from aumos_governance.audit.query import AuditFilter, AuditQueryResult, aggregate_outcomes
from aumos_governance.audit.record import AuditRecord, GovernanceDecisionContext
from aumos_governance.budget.manager import BudgetCheckResult, BudgetManager
from aumos_governance.config import (
    AuditConfig,
    BudgetConfig,
    ConsentConfig,
    GovernanceConfig,
    TrustConfig,
)
from aumos_governance.consent.manager import ConsentCheckResult, ConsentManager
from aumos_governance.consent.store import ConsentRecord
from aumos_governance.engine import GovernanceAction, GovernanceDecision, GovernanceEngine
from aumos_governance.errors import (
    AumOSGovernanceError,
    BudgetExceededError,
    BudgetNotFoundError,
    ConfigurationError,
    ConsentDeniedError,
    ConsentNotFoundError,
    InvalidPeriodError,
    TrustLevelError,
)
from aumos_governance.trust.manager import SetLevelOptions, TrustManager
from aumos_governance.trust.validator import TrustCheckResult
from aumos_governance.types import (
    BUDGET_PERIOD_VALUES,
    BudgetPeriod,
    DataCategory,
    GovernanceOutcome,
    TrustLevel,
)

__version__ = "0.1.0"

__all__ = [
    # Core types
    "TrustLevel",
    "GovernanceOutcome",
    "BudgetPeriod",
    "BUDGET_PERIOD_VALUES",
    "DataCategory",
    # Configuration
    "GovernanceConfig",
    "TrustConfig",
    "BudgetConfig",
    "ConsentConfig",
    "AuditConfig",
    # Engine
    "GovernanceEngine",
    "GovernanceAction",
    "GovernanceDecision",
    # Trust
    "TrustManager",
    "TrustCheckResult",
    "SetLevelOptions",
    # Budget
    "BudgetManager",
    "BudgetCheckResult",
    # Consent
    "ConsentManager",
    "ConsentCheckResult",
    "ConsentRecord",
    # Audit
    "AuditLogger",
    "AuditFilter",
    "AuditQueryResult",
    "AuditRecord",
    "GovernanceDecisionContext",
    "aggregate_outcomes",
    # Errors
    "AumOSGovernanceError",
    "TrustLevelError",
    "BudgetExceededError",
    "BudgetNotFoundError",
    "ConsentDeniedError",
    "ConsentNotFoundError",
    "ConfigurationError",
    "InvalidPeriodError",
    "__version__",
]

# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
aumos-security-bundle — the complete AI agent security stack for Python.

One install gives you trust gating, budget enforcement, and audit logging.
All components enforce static, operator-configured policies only.
Trust levels are set manually. Budget limits are fixed at creation time.
Audit logs are write-only records with no analysis or anomaly detection.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

# Re-export trust gating
from aumos_governance import TrustGate, TrustGateConfig, TrustLevel

# Re-export budget enforcement
from budget_enforcer import BudgetEnforcer, BudgetEnforcerConfig, SpendingEnvelope

# Re-export audit trail
from agent_audit_trail import AuditLogger, AuditRecord, AuditQuery

if TYPE_CHECKING:
    pass

__all__ = [
    # Trust gate
    "TrustGate",
    "TrustGateConfig",
    "TrustLevel",
    # Budget enforcer
    "BudgetEnforcer",
    "BudgetEnforcerConfig",
    "SpendingEnvelope",
    # Audit trail
    "AuditLogger",
    "AuditRecord",
    "AuditQuery",
    # Convenience factory
    "SecurityStackConfig",
    "SecurityStack",
    "create_security_stack",
]


@dataclass(frozen=True)
class SecurityStackConfig:
    """
    Configuration for the full security stack.

    All limits are static — set by the operator at creation time and never
    adjusted automatically.
    """

    trust_gate: TrustGateConfig
    """Trust gate configuration. Trust levels are set manually by operators."""

    budget: BudgetEnforcerConfig
    """Budget enforcer configuration. All spending limits are fixed at creation."""

    audit_namespace: str = "aumos.security-bundle"
    """Namespace written to every audit record. Defaults to 'aumos.security-bundle'."""


@dataclass(frozen=True)
class SecurityStack:
    """
    The assembled security stack.

    Each component is independent — they share no state and make no cross-calls.
    Wire the components together in your own governance layer.
    """

    trust_gate: TrustGate
    budget: BudgetEnforcer
    audit: AuditLogger


def create_security_stack(config: SecurityStackConfig) -> SecurityStack:
    """
    Create a fully-configured security stack in a single call.

    Example::

        config = SecurityStackConfig(
            trust_gate=TrustGateConfig(required_level="verified", tool_name="file-reader"),
            budget=BudgetEnforcerConfig(token_limit=10_000, call_limit=100),
        )
        stack = create_security_stack(config)

        decision = stack.trust_gate.check(request)
        allowed  = stack.budget.check_budget(session_id)
        stack.audit.log(AuditRecord(event="tool-call", session_id=session_id))
    """
    trust_gate = TrustGate(config.trust_gate)
    budget = BudgetEnforcer(config.budget)
    audit = AuditLogger(namespace=config.audit_namespace)

    return SecurityStack(trust_gate=trust_gate, budget=budget, audit=audit)

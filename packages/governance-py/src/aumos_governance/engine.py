# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

import asyncio
from typing import Any

from pydantic import BaseModel, Field

from aumos_governance.audit.logger import AuditLogger
from aumos_governance.audit.record import GovernanceDecisionContext
from aumos_governance.budget.manager import BudgetManager
from aumos_governance.config import GovernanceConfig
from aumos_governance.consent.manager import ConsentManager
from aumos_governance.trust.manager import TrustManager
from aumos_governance.types import GovernanceOutcome, TrustLevel


class GovernanceAction(BaseModel, frozen=True):
    """
    Describes an action to be evaluated by the :class:`GovernanceEngine`.

    All fields except ``agent_id`` are optional. Provide only those relevant
    to the action; the engine skips checks for fields that are not provided.

    Attributes:
        agent_id: The agent requesting to perform the action.
        required_trust_level: If provided, the engine checks that the agent
            meets this trust level before proceeding.
        scope: Optional scope context passed to trust-level checks.
        budget_category: If provided, the engine checks budget availability
            for this category.
        budget_amount: Amount to check against the budget. Required when
            ``budget_category`` is provided.
        data_type: If provided, the engine checks consent for this data type.
        purpose: Purpose passed to the consent check.
        action_type: A descriptive string for audit records (e.g. ``'tool_call'``).
        resource: The resource being acted on, stored in audit context.
        extra: Additional metadata stored in the audit context.
    """

    agent_id: str
    required_trust_level: TrustLevel | None = None
    scope: str | None = None
    budget_category: str | None = None
    budget_amount: float | None = None
    data_type: str | None = None
    purpose: str | None = None
    action_type: str | None = None
    resource: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class GovernanceDecision(BaseModel, frozen=True):
    """
    The result of evaluating a :class:`GovernanceAction` through the engine.

    Attributes:
        outcome: The final :class:`~aumos_governance.types.GovernanceOutcome`.
        allowed: True when outcome is ``ALLOW`` or ``ALLOW_WITH_CAVEAT``.
        reasons: List of reason strings from each governance check performed.
        audit_record_id: The UUID of the :class:`~aumos_governance.audit.record.AuditRecord`
            written for this decision.
        action: The original :class:`GovernanceAction` that was evaluated.
    """

    outcome: GovernanceOutcome
    allowed: bool
    reasons: list[str]
    audit_record_id: str
    action: GovernanceAction


class GovernanceEngine:
    """
    Composes TrustManager, BudgetManager, ConsentManager, and AuditLogger
    into a single evaluation pipeline.

    Evaluation is sequential:
    1. Trust check (if required_trust_level is set)
    2. Budget check (if budget_category is set)
    3. Consent check (if data_type is set)
    4. Audit log (always written)

    Any failing check produces an immediate DENY outcome. The engine does
    NOT perform cross-protocol optimisation — each check is independent.

    Use :meth:`evaluate` in async contexts, or :meth:`evaluate_sync` when
    a synchronous call site cannot await.

    Example::

        engine = GovernanceEngine()
        engine.trust.set_level("agent-1", TrustLevel.L3_ACT_APPROVE)
        engine.budget.create_budget("llm", limit=50.0, period="monthly")
        engine.consent.record_consent(
            "agent-1", "user_data", purpose="support", granted_by="admin"
        )

        decision = await engine.evaluate(GovernanceAction(
            agent_id="agent-1",
            required_trust_level=TrustLevel.L2_SUGGEST,
            budget_category="llm",
            budget_amount=1.5,
            data_type="user_data",
            purpose="support",
            action_type="tool_call",
        ))
        assert decision.allowed is True
    """

    def __init__(self, config: GovernanceConfig | None = None) -> None:
        cfg = config or GovernanceConfig()
        self._config = cfg
        self.trust = TrustManager(cfg.trust)
        self.budget = BudgetManager(cfg.budget)
        self.consent = ConsentManager(cfg.consent)
        self.audit = AuditLogger(cfg.audit)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def evaluate(self, action: GovernanceAction) -> GovernanceDecision:
        """
        Evaluate a governance action asynchronously.

        Runs each enabled check in sequence. Returns immediately on the
        first failing check with a DENY outcome.

        Args:
            action: The :class:`GovernanceAction` to evaluate.

        Returns:
            A :class:`GovernanceDecision` with the outcome and audit record ID.
        """
        reasons: list[str] = []
        outcome = GovernanceOutcome.ALLOW

        # --- Step 1: Trust check ---
        if action.required_trust_level is not None:
            trust_result = self.trust.check_level(
                agent_id=action.agent_id,
                required_level=action.required_trust_level,
                scope=action.scope,
            )
            reasons.append(trust_result.reason)
            if not trust_result.allowed:
                outcome = GovernanceOutcome.DENY
                return self._record_and_build(action, outcome, reasons)

        # --- Step 2: Budget check ---
        if action.budget_category is not None:
            budget_amount = action.budget_amount or 0.0
            budget_result = self.budget.check_budget(
                category=action.budget_category,
                amount=budget_amount,
            )
            reasons.append(budget_result.reason)
            if not budget_result.allowed:
                outcome = GovernanceOutcome.DENY
                return self._record_and_build(action, outcome, reasons)

        # --- Step 3: Consent check ---
        if action.data_type is not None:
            consent_result = self.consent.check_consent(
                agent_id=action.agent_id,
                data_type=action.data_type,
                purpose=action.purpose,
            )
            reasons.append(consent_result.reason)
            if not consent_result.granted:
                outcome = GovernanceOutcome.DENY
                return self._record_and_build(action, outcome, reasons)

        # All checks passed.
        return self._record_and_build(action, outcome, reasons)

    def evaluate_sync(self, action: GovernanceAction) -> GovernanceDecision:
        """
        Synchronous wrapper for :meth:`evaluate`.

        Uses :func:`asyncio.run` when no event loop is running; falls back to
        creating a dedicated event loop when one is already running (e.g.
        inside Jupyter or certain web frameworks).

        Args:
            action: The :class:`GovernanceAction` to evaluate.

        Returns:
            A :class:`GovernanceDecision` with the outcome and audit record ID.
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None and loop.is_running():
            # We are inside a running event loop — use a thread pool executor
            # to run a new loop in a worker thread.
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(asyncio.run, self.evaluate(action))
                return future.result()

        return asyncio.run(self.evaluate(action))

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _record_and_build(
        self,
        action: GovernanceAction,
        outcome: GovernanceOutcome,
        reasons: list[str],
    ) -> GovernanceDecision:
        """Write an audit record and construct the GovernanceDecision."""
        context = GovernanceDecisionContext(
            agent_id=action.agent_id,
            action_type=action.action_type,
            resource=action.resource,
            scope=action.scope,
            budget_category=action.budget_category,
            data_type=action.data_type,
            purpose=action.purpose,
            extra=action.extra,
        )

        decision_text = (
            f"Action for agent '{action.agent_id}': "
            f"{outcome.upper() if isinstance(outcome, str) else str(outcome).upper()}"
        )

        record = self.audit.log(
            outcome=outcome,
            decision=decision_text,
            reasons=reasons,
            context=context,
        )

        allowed = outcome in (GovernanceOutcome.ALLOW, GovernanceOutcome.ALLOW_WITH_CAVEAT)

        return GovernanceDecision(
            outcome=outcome,
            allowed=allowed,
            reasons=reasons,
            audit_record_id=record.record_id,
            action=action,
        )

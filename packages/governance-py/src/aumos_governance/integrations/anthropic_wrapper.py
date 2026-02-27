# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Anthropic SDK governance wrapper for AumOS.

Wraps an ``anthropic.Anthropic`` (or compatible) client instance and
intercepts every call to ``messages.create()`` and the legacy
``completions.create()`` surface. Before each call the wrapper:

1. Checks whether the agent meets the required trust level.
2. Checks whether the call falls within the static budget ceiling.
3. Writes a record to the in-memory audit log.

If all checks pass the request is forwarded to the underlying client and the
response is returned unchanged. If any check fails a
:class:`GovernanceDeniedError` is raised.

The wrapper does NOT import from the ``anthropic`` package directly; it
accepts the client as a structural type so that it can be used in
environments where the Anthropic SDK version differs from what was current at
write time.

Quick start::

    import anthropic
    from aumos_governance import GovernanceEngine
    from aumos_governance.types import TrustLevel
    from aumos_governance.integrations.anthropic_wrapper import GovernedAnthropicClient

    raw_client = anthropic.Anthropic(api_key="sk-ant-...")
    engine = GovernanceEngine()
    engine.trust.set_level("notebook-agent", TrustLevel.L3_ACT_APPROVE)
    engine.budget.create_budget("anthropic", limit=20.0, period="monthly")

    client = GovernedAnthropicClient(
        anthropic_client=raw_client,
        governance_engine=engine,
        agent_id="notebook-agent",
        default_cost=0.01,
    )

    response = client.governed_message(
        model="claude-opus-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": "Hello!"}],
    )

Design rules
------------
- Trust levels are MANUAL ONLY — set via ``GovernanceEngine.trust.set_level()``.
- Budget limits are STATIC ONLY — no adaptive reallocation occurs.
- Audit logging is RECORDING ONLY — no anomaly detection.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from aumos_governance.engine import GovernanceAction, GovernanceDecision, GovernanceEngine
from aumos_governance.errors import AumOSGovernanceError
from aumos_governance.types import TrustLevel

logger = logging.getLogger("aumos.governance.anthropic")

# ---------------------------------------------------------------------------
# Structural protocols — avoids a hard dependency on the anthropic package
# ---------------------------------------------------------------------------


@runtime_checkable
class _MessagesProtocol(Protocol):
    """Structural protocol for the ``anthropic.resources.Messages`` surface."""

    def create(self, **kwargs: object) -> object:
        """Create a message."""
        ...


@runtime_checkable
class _CompletionsProtocol(Protocol):
    """Structural protocol for the legacy ``anthropic.resources.Completions`` surface."""

    def create(self, **kwargs: object) -> object:
        """Create a completion."""
        ...


@runtime_checkable
class AnthropicClientProtocol(Protocol):
    """
    Structural protocol satisfied by ``anthropic.Anthropic`` and any
    compatible stub.

    Only the sub-resources used by :class:`GovernedAnthropicClient` are
    declared.
    """

    @property
    def messages(self) -> object:
        """The messages resource namespace; must expose ``create``."""
        ...


# ---------------------------------------------------------------------------
# Governance errors
# ---------------------------------------------------------------------------


class GovernanceDeniedError(AumOSGovernanceError):
    """
    Raised when a governance check prevents an Anthropic API call from proceeding.

    Attributes:
        agent_id: The agent whose request was denied.
        denial_reason: Human-readable reason for the denial.
        audit_record_id: UUID of the audit record written for this denial.
    """

    def __init__(
        self,
        agent_id: str,
        denial_reason: str,
        audit_record_id: str,
    ) -> None:
        super().__init__(
            f"Anthropic call denied for agent '{agent_id}': {denial_reason}",
            code="GOVERNANCE_DENIED",
        )
        self.agent_id = agent_id
        self.denial_reason = denial_reason
        self.audit_record_id = audit_record_id


# ---------------------------------------------------------------------------
# Audit record dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AnthropicAuditRecord:
    """
    An immutable record of a single Anthropic API call attempt evaluated by
    the governance wrapper.

    Attributes:
        record_id: UUID identifying this audit record.
        agent_id: The agent that initiated the call.
        call_type: ``"message"`` or ``"completion"``.
        model: The model identifier requested.
        allowed: Whether the call was permitted by governance.
        denial_reason: Populated when ``allowed`` is ``False``.
        estimated_cost: The cost estimate used for the budget check.
        governance_decision: The full :class:`~aumos_governance.engine.GovernanceDecision`.
    """

    record_id: str
    agent_id: str
    call_type: str
    model: str
    allowed: bool
    denial_reason: str | None
    estimated_cost: float
    governance_decision: GovernanceDecision


# ---------------------------------------------------------------------------
# GovernedAnthropicClient
# ---------------------------------------------------------------------------


class GovernedAnthropicClient:
    """
    Governed wrapper around an Anthropic client.

    Intercepts ``messages.create()`` and ``completions.create()`` calls,
    running them through the AumOS governance pipeline before forwarding to
    the underlying client.

    The governance pipeline is sequential:

    1. Trust level check — the agent must hold at least
       ``required_trust_level`` to invoke Anthropic APIs.
    2. Budget check — the estimated call cost must not exceed the
       remaining balance in the configured budget category.
    3. Audit record — every decision (allow or deny) is written to
       the engine's :class:`~aumos_governance.audit.logger.AuditLogger`
       and to this instance's in-memory :attr:`audit_log`.

    Trust levels and budget limits are STATIC — they are not adjusted
    automatically at runtime.

    Args:
        anthropic_client: An ``anthropic.Anthropic`` instance or any object
            satisfying :class:`AnthropicClientProtocol`.
        governance_engine: A configured :class:`~aumos_governance.engine.GovernanceEngine`
            instance. Trust levels and budgets must be configured on the
            engine before calls are made.
        agent_id: The identifier used to look up trust level and record
            audit events.
        default_cost: Estimated cost in USD applied to each call when a
            more precise estimate is not available. Default: ``0.01``.
        budget_category: Budget category name used for spending checks.
            When ``None``, no budget check is performed. Default: ``None``.
        required_trust_level: Minimum trust level the agent must hold.
            Default: :attr:`~aumos_governance.types.TrustLevel.L1_MONITOR`.
    """

    def __init__(
        self,
        anthropic_client: object,
        governance_engine: GovernanceEngine,
        agent_id: str,
        default_cost: float = 0.01,
        budget_category: str | None = None,
        required_trust_level: TrustLevel = TrustLevel.L1_MONITOR,
    ) -> None:
        self._client = anthropic_client
        self._engine = governance_engine
        self._agent_id = agent_id
        self._default_cost = default_cost
        self._budget_category = budget_category
        self._required_trust_level = required_trust_level
        self._audit_log: list[AnthropicAuditRecord] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def governed_message(
        self,
        model: str,
        max_tokens: int,
        messages: list[dict[str, object]],
        *,
        estimated_cost: float | None = None,
        **kwargs: object,
    ) -> object:
        """
        Perform a governed ``messages.create()`` call.

        Runs trust, budget, and audit checks before forwarding to the
        underlying Anthropic client.

        Args:
            model: Anthropic model identifier (e.g. ``"claude-opus-4-6"``).
            max_tokens: Maximum tokens to generate. Forwarded verbatim to
                the Anthropic SDK.
            messages: List of message dicts in Anthropic messages format
                (``[{"role": "user", "content": "..."}]``).
            estimated_cost: Override the per-call cost estimate for budget
                checking. Falls back to :attr:`default_cost` when ``None``.
            **kwargs: Additional keyword arguments forwarded verbatim to
                ``anthropic.messages.create()`` (e.g. ``system``,
                ``temperature``).

        Returns:
            The ``Message`` object returned by the Anthropic SDK.

        Raises:
            GovernanceDeniedError: When the governance engine denies the call.
            AttributeError: When the client object does not expose
                ``messages.create``.
        """
        cost = estimated_cost if estimated_cost is not None else self._default_cost
        decision = self._run_governance_check(
            call_type="message",
            model=model,
            estimated_cost=cost,
        )
        if not decision.allowed:
            raise GovernanceDeniedError(
                agent_id=self._agent_id,
                denial_reason="; ".join(decision.reasons),
                audit_record_id=decision.audit_record_id,
            )

        messages_resource = getattr(self._client, "messages", None)
        if messages_resource is None:
            raise AttributeError(
                "The provided anthropic_client does not expose a 'messages' attribute."
            )

        logger.info(
            "governance_anthropic_message_allowed",
            extra={
                "agent_id": self._agent_id,
                "model": model,
                "audit_record_id": decision.audit_record_id,
                "estimated_cost": cost,
            },
        )

        return messages_resource.create(  # type: ignore[union-attr]
            model=model,
            max_tokens=max_tokens,
            messages=messages,
            **kwargs,
        )

    def governed_completion(
        self,
        model: str,
        prompt: str,
        max_tokens_to_sample: int,
        *,
        estimated_cost: float | None = None,
        **kwargs: object,
    ) -> object:
        """
        Perform a governed legacy ``completions.create()`` call.

        The Anthropic legacy completions API (``claude-2`` and earlier) is
        supported for backwards compatibility. New code should prefer
        :meth:`governed_message`.

        Runs trust, budget, and audit checks before forwarding to the
        underlying Anthropic client.

        Args:
            model: Anthropic model identifier (e.g. ``"claude-2"``).
            prompt: The raw prompt string (must include ``\\n\\nHuman:`` /
                ``\\n\\nAssistant:`` formatting for legacy models).
            max_tokens_to_sample: Maximum tokens the model will generate.
            estimated_cost: Override the per-call cost estimate for budget
                checking. Falls back to :attr:`default_cost` when ``None``.
            **kwargs: Additional keyword arguments forwarded verbatim to
                ``anthropic.completions.create()``.

        Returns:
            The ``Completion`` object returned by the Anthropic SDK.

        Raises:
            GovernanceDeniedError: When the governance engine denies the call.
            AttributeError: When the client object does not expose
                ``completions.create``.
        """
        cost = estimated_cost if estimated_cost is not None else self._default_cost
        decision = self._run_governance_check(
            call_type="completion",
            model=model,
            estimated_cost=cost,
        )
        if not decision.allowed:
            raise GovernanceDeniedError(
                agent_id=self._agent_id,
                denial_reason="; ".join(decision.reasons),
                audit_record_id=decision.audit_record_id,
            )

        completions_resource = getattr(self._client, "completions", None)
        if completions_resource is None:
            raise AttributeError(
                "The provided anthropic_client does not expose a 'completions' attribute. "
                "The legacy completions API may not be available in your SDK version."
            )

        logger.info(
            "governance_anthropic_completion_allowed",
            extra={
                "agent_id": self._agent_id,
                "model": model,
                "audit_record_id": decision.audit_record_id,
                "estimated_cost": cost,
            },
        )

        return completions_resource.create(  # type: ignore[union-attr]
            model=model,
            prompt=prompt,
            max_tokens_to_sample=max_tokens_to_sample,
            **kwargs,
        )

    @property
    def audit_log(self) -> list[AnthropicAuditRecord]:
        """
        In-memory audit log for all calls made through this instance.

        Returns a shallow copy; mutating the returned list does not affect
        internal state.
        """
        return list(self._audit_log)

    @property
    def agent_id(self) -> str:
        """The agent identifier associated with this client instance."""
        return self._agent_id

    @property
    def default_cost(self) -> float:
        """Default per-call cost estimate used when no override is provided."""
        return self._default_cost

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _run_governance_check(
        self,
        *,
        call_type: str,
        model: str,
        estimated_cost: float,
    ) -> GovernanceDecision:
        """
        Build a :class:`~aumos_governance.engine.GovernanceAction` and evaluate
        it synchronously through the governance engine.

        Also appends an :class:`AnthropicAuditRecord` to :attr:`_audit_log`.

        Args:
            call_type: ``"message"`` or ``"completion"``.
            model: Model identifier for audit context.
            estimated_cost: Estimated call cost in USD.

        Returns:
            The :class:`~aumos_governance.engine.GovernanceDecision` from the
            engine.
        """
        action = GovernanceAction(
            agent_id=self._agent_id,
            required_trust_level=self._required_trust_level,
            budget_category=self._budget_category,
            budget_amount=estimated_cost if self._budget_category is not None else None,
            action_type=f"anthropic_{call_type}",
            resource=model,
            extra={
                "call_type": call_type,
                "model": model,
                "estimated_cost": estimated_cost,
            },
        )

        decision = self._engine.evaluate_sync(action)

        audit_record = AnthropicAuditRecord(
            record_id=str(uuid.uuid4()),
            agent_id=self._agent_id,
            call_type=call_type,
            model=model,
            allowed=decision.allowed,
            denial_reason="; ".join(decision.reasons) if not decision.allowed else None,
            estimated_cost=estimated_cost,
            governance_decision=decision,
        )
        self._audit_log.append(audit_record)

        if not decision.allowed:
            logger.warning(
                "governance_anthropic_denied",
                extra={
                    "agent_id": self._agent_id,
                    "call_type": call_type,
                    "model": model,
                    "reasons": decision.reasons,
                    "audit_record_id": decision.audit_record_id,
                },
            )

        return decision

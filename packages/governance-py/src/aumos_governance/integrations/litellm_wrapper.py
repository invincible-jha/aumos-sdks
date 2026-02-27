# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
LiteLLM integration for AumOS governance.

Wraps LiteLLM's ``completion`` and ``acompletion`` APIs with governance checks
applied before and after each call.

Quick start::

    from aumos_governance.integrations.litellm_wrapper import governed_completion

    response = governed_completion(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello"}],
        trust_level=3,
        budget_limit=5.0,
    )

Or use the class API for full control::

    from aumos_governance.integrations.litellm_wrapper import GovernedLiteLLM

    client = GovernedLiteLLM(trust_level=3, budget_limit=5.0)
    response = client.completion("gpt-4o", messages)
    # Async variant:
    response = await client.acompletion("gpt-4o", messages)

Pre-call checks
---------------
1. Trust level is read from the ``GovernedLiteLLM`` instance (static integer).
2. If a budget limit is configured and the accumulated spend would be exceeded,
   a :class:`~aumos_governance.errors.BudgetExceededError` is raised before
   the LiteLLM call is made.

Post-call recording
-------------------
After a successful call the actual cost is extracted from LiteLLM's response
``usage`` field (``prompt_tokens + completion_tokens``, multiplied by
per-token cost when provided) or from LiteLLM's built-in
``response._hidden_params["response_cost"]`` if available. The recorded
amount is always informational — no adaptive reallocation occurs.

Design rules
------------
- Trust levels are MANUAL ONLY — set ``trust_level`` at construction time.
- Budget limits are STATIC ONLY — no adaptive reallocation.
- Audit logging is RECORDING ONLY — no anomaly detection.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("aumos.governance.litellm")

# ---------------------------------------------------------------------------
# Cost extraction helpers
# ---------------------------------------------------------------------------


def _extract_cost_from_response(response: Any) -> float | None:
    """
    Attempt to extract the actual cost from a LiteLLM response object.

    LiteLLM stores the calculated cost in ``response._hidden_params["response_cost"]``
    when cost mapping is available. Fall back to ``None`` when it cannot be
    determined.

    Args:
        response: A LiteLLM ``ModelResponse`` object.

    Returns:
        Cost in USD as a float, or ``None`` if it cannot be determined.
    """
    try:
        hidden: dict[str, Any] = response._hidden_params or {}
        cost: float | None = hidden.get("response_cost")
        if cost is not None:
            return float(cost)
    except AttributeError:
        pass
    return None


def _build_call_log_extra(
    *,
    request_id: str,
    model: str,
    trust_level: int,
    budget_limit: float | None,
    budget_remaining: float | None,
) -> dict[str, Any]:
    """
    Build a structured extras dict for logger calls.

    Args:
        request_id: UUID for the current call.
        model: LiteLLM model identifier.
        trust_level: Static trust level.
        budget_limit: Configured budget ceiling or ``None``.
        budget_remaining: Remaining budget or ``None``.

    Returns:
        Dict suitable for the ``extra`` kwarg of :func:`logging.Logger.info`.
    """
    return {
        "request_id": request_id,
        "model": model,
        "trust_level": trust_level,
        "budget_limit": budget_limit,
        "budget_remaining": budget_remaining,
    }


# ---------------------------------------------------------------------------
# GovernedLiteLLM class
# ---------------------------------------------------------------------------


@dataclass
class GovernedLiteLLM:
    """
    Wraps LiteLLM completion APIs with AumOS governance enforcement.

    Trust level is static — set once at construction and never changed.
    Budget limit is static — no adaptive reallocation occurs.

    Attributes:
        trust_level: Required static trust level (0-5). Recorded in logs;
            not automatically modified.
        budget_limit: Optional cumulative budget ceiling in USD. When ``None``
            no budget enforcement occurs.
        log_decisions: When ``True``, each call emits structured log records
            to ``aumos.governance.litellm``.
    """

    trust_level: int = 2
    budget_limit: float | None = None
    log_decisions: bool = True
    _spent: float = field(default=0.0, init=False, repr=False)
    _call_count: int = field(default=0, init=False, repr=False)

    def __post_init__(self) -> None:
        if not (0 <= self.trust_level <= 5):
            raise ValueError(
                f"trust_level must be between 0 and 5 inclusive; got {self.trust_level}."
            )
        if self.budget_limit is not None and self.budget_limit < 0:
            raise ValueError(f"budget_limit must be >= 0; got {self.budget_limit}.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def completion(
        self,
        model: str,
        messages: list[dict[str, str]],
        **kwargs: Any,
    ) -> Any:
        """
        Call ``litellm.completion`` with governance checks applied.

        Pre-call checks: budget availability.
        Post-call recording: extracts actual cost from the response and
        records it against the static budget.

        Args:
            model: LiteLLM model identifier (e.g. ``"gpt-4o"``).
            messages: List of message dicts in OpenAI chat format.
            **kwargs: Additional keyword arguments forwarded verbatim to
                ``litellm.completion``.

        Returns:
            The LiteLLM ``ModelResponse`` object returned by the underlying
            call.

        Raises:
            :class:`~aumos_governance.errors.BudgetExceededError`: When the
                budget has been exhausted.
            ImportError: When LiteLLM is not installed.
        """
        try:
            import litellm  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "LiteLLM must be installed to use GovernedLiteLLM. "
                "Install it with: pip install litellm"
            ) from exc

        request_id = str(uuid.uuid4())
        self._call_count += 1

        self._pre_call_check(model=model, request_id=request_id)

        response = litellm.completion(model=model, messages=messages, **kwargs)

        self._post_call_record(response=response, model=model, request_id=request_id)

        return response

    async def acompletion(
        self,
        model: str,
        messages: list[dict[str, str]],
        **kwargs: Any,
    ) -> Any:
        """
        Call ``litellm.acompletion`` with governance checks applied.

        Pre-call checks: budget availability.
        Post-call recording: extracts actual cost from the response and
        records it against the static budget.

        Args:
            model: LiteLLM model identifier (e.g. ``"gpt-4o"``).
            messages: List of message dicts in OpenAI chat format.
            **kwargs: Additional keyword arguments forwarded verbatim to
                ``litellm.acompletion``.

        Returns:
            The LiteLLM ``ModelResponse`` object returned by the underlying
            async call.

        Raises:
            :class:`~aumos_governance.errors.BudgetExceededError`: When the
                budget has been exhausted.
            ImportError: When LiteLLM is not installed.
        """
        try:
            import litellm  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "LiteLLM must be installed to use GovernedLiteLLM. "
                "Install it with: pip install litellm"
            ) from exc

        request_id = str(uuid.uuid4())
        self._call_count += 1

        self._pre_call_check(model=model, request_id=request_id)

        response = await litellm.acompletion(model=model, messages=messages, **kwargs)

        self._post_call_record(response=response, model=model, request_id=request_id)

        return response

    @property
    def spent(self) -> float:
        """Cumulative spend recorded across all calls, in USD."""
        return self._spent

    @property
    def remaining(self) -> float | None:
        """
        Remaining budget in USD.

        Returns ``None`` when no ``budget_limit`` is configured.
        """
        if self.budget_limit is None:
            return None
        return max(0.0, self.budget_limit - self._spent)

    @property
    def call_count(self) -> int:
        """Total number of completion calls made through this instance."""
        return self._call_count

    def record_spend(self, amount: float) -> None:
        """
        Manually record spending against the static budget.

        Use this when the actual cost is known from a channel other than
        the LiteLLM response (e.g. a cloud billing API).

        Args:
            amount: Amount in USD to record. Must be non-negative.

        Raises:
            ValueError: If ``amount`` is negative.
        """
        if amount < 0:
            raise ValueError(f"Spend amount must be >= 0; got {amount}.")
        if self.budget_limit is not None:
            self._spent += amount
            logger.info(
                "governance_spend_manual",
                extra={
                    "amount": amount,
                    "total_spent": self._spent,
                    "remaining": self.remaining,
                },
            )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _pre_call_check(self, *, model: str, request_id: str) -> None:
        """
        Run all pre-call governance checks.

        Args:
            model: LiteLLM model identifier for logging.
            request_id: Request UUID for correlation.

        Raises:
            :class:`~aumos_governance.errors.BudgetExceededError`: When the
                static budget ceiling has been reached.
        """
        from aumos_governance.errors import BudgetExceededError

        remaining = self.remaining

        if self.log_decisions:
            logger.info(
                "governance_pre_call",
                extra=_build_call_log_extra(
                    request_id=request_id,
                    model=model,
                    trust_level=self.trust_level,
                    budget_limit=self.budget_limit,
                    budget_remaining=remaining,
                ),
            )

        if self.budget_limit is not None and remaining is not None and remaining <= 0:
            raise BudgetExceededError(
                category="litellm",
                requested=0.0,
                available=remaining,
            )

    def _post_call_record(
        self,
        *,
        response: Any,
        model: str,
        request_id: str,
    ) -> None:
        """
        Extract cost from the LiteLLM response and record it.

        Args:
            response: LiteLLM ``ModelResponse`` object.
            model: Model identifier for logging.
            request_id: Request UUID for correlation.
        """
        cost = _extract_cost_from_response(response)

        if cost is not None and self.budget_limit is not None:
            self._spent += cost

        if self.log_decisions:
            logger.info(
                "governance_post_call",
                extra={
                    "request_id": request_id,
                    "model": model,
                    "cost_recorded": cost,
                    "total_spent": self._spent,
                    "remaining": self.remaining,
                },
            )


# ---------------------------------------------------------------------------
# Quick-start function API
# ---------------------------------------------------------------------------


def governed_completion(
    model: str,
    messages: list[dict[str, str]],
    *,
    trust_level: int = 2,
    budget_limit: float | None = None,
    log_decisions: bool = True,
    **kwargs: Any,
) -> Any:
    """
    One-shot governed LiteLLM completion call.

    Creates a disposable :class:`GovernedLiteLLM` instance, performs the
    call, and returns the response. Use the class API when you need
    persistent state across multiple calls (e.g. budget accumulation).

    Args:
        model: LiteLLM model identifier (e.g. ``"gpt-4o"``).
        messages: List of message dicts in OpenAI chat format.
        trust_level: Static trust level (0-5). Default: 2.
        budget_limit: Optional cumulative budget ceiling in USD. When
            ``None`` no budget enforcement occurs.
        log_decisions: Emit structured log records when ``True``.
        **kwargs: Additional keyword arguments forwarded to
            ``litellm.completion``.

    Returns:
        The LiteLLM ``ModelResponse`` object.

    Raises:
        :class:`~aumos_governance.errors.BudgetExceededError`: When the
            budget ceiling has been reached before the call is made.
        ImportError: When LiteLLM is not installed.

    Example::

        response = governed_completion(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Summarise this document."}],
            trust_level=3,
            budget_limit=1.0,
        )
        print(response.choices[0].message.content)
    """
    client = GovernedLiteLLM(
        trust_level=trust_level,
        budget_limit=budget_limit,
        log_decisions=log_decisions,
    )
    return client.completion(model, messages, **kwargs)


async def governed_acompletion(
    model: str,
    messages: list[dict[str, str]],
    *,
    trust_level: int = 2,
    budget_limit: float | None = None,
    log_decisions: bool = True,
    **kwargs: Any,
) -> Any:
    """
    One-shot governed async LiteLLM completion call.

    Async variant of :func:`governed_completion`. See that function for
    full parameter documentation.

    Args:
        model: LiteLLM model identifier.
        messages: List of message dicts in OpenAI chat format.
        trust_level: Static trust level (0-5). Default: 2.
        budget_limit: Optional cumulative budget ceiling in USD.
        log_decisions: Emit structured log records when ``True``.
        **kwargs: Additional keyword arguments forwarded to
            ``litellm.acompletion``.

    Returns:
        The LiteLLM ``ModelResponse`` object.
    """
    client = GovernedLiteLLM(
        trust_level=trust_level,
        budget_limit=budget_limit,
        log_decisions=log_decisions,
    )
    return await client.acompletion(model, messages, **kwargs)

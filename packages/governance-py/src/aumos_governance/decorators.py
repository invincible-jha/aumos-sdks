# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Python decorator pattern for AumOS governance enforcement.

Apply governance checks to any callable using the ``@governed`` decorator::

    from aumos_governance.decorators import governed

    @governed(trust_level=3, budget=5.0)
    def call_llm(prompt: str) -> str:
        return my_llm_client.complete(prompt)

    # After the call succeeds, record actual cost:
    call_llm.record_spend(0.003)

    # Inspect accumulated state:
    print(call_llm.governance_state.spent)

Design rules
------------
- Trust levels are MANUAL ONLY — the ``trust_level`` parameter is a static
  integer that does not change at runtime.
- Budget limits are STATIC ONLY — the decorator enforces a fixed ceiling
  with no adaptive reallocation.
- No behavioral scoring and no automatic trust promotion occur anywhere in
  this module.
"""
from __future__ import annotations

import functools
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")

logger = logging.getLogger("aumos.governance")


@dataclass(frozen=True)
class GovernanceContext:
    """
    Immutable governance context delivered to pre-call hooks.

    Attributes:
        trust_level: The static trust level configured for this function.
        budget_remaining: Remaining budget in USD, or ``None`` when no
            budget limit is configured.
        request_id: A UUID string uniquely identifying this invocation.
        tool_name: The ``__qualname__`` of the decorated function.
    """

    trust_level: int
    budget_remaining: float | None
    request_id: str
    tool_name: str


@dataclass
class GovernanceState:
    """
    Mutable state tracked across invocations of a ``@governed`` function.

    This object is attached to the wrapper as ``wrapper.governance_state``
    so callers can inspect and record spend from outside the function.

    Attributes:
        trust_level: Static trust level assigned at decoration time.
        budget_limit: Maximum cumulative spend allowed, or ``None`` for
            unlimited.
        spent: Total spend recorded via :func:`_record_spend`.
        call_count: Number of times the decorated function has been called.
    """

    trust_level: int = 2
    budget_limit: float | None = None
    spent: float = field(default=0.0)
    call_count: int = field(default=0)


def governed(
    trust_level: int = 2,
    budget: float | None = None,
    require_consent: bool = False,
    log_decisions: bool = True,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """
    Decorator that wraps a function with AumOS governance checks.

    Enforces a static trust level and optional static budget ceiling around
    any synchronous callable. Trust changes are MANUAL ONLY — this decorator
    holds the level fixed for the lifetime of the process. Budget limits are
    STATIC — no adaptive allocation occurs.

    Usage::

        @governed(trust_level=3, budget=5.0)
        def fetch_documents(query: str) -> list[str]:
            return retrieval_client.search(query)

        # Record actual cost after the call:
        fetch_documents.record_spend(0.002)

    Args:
        trust_level: Static trust level required to execute this function
            (0-5). Recorded in logs and state; not automatically promoted.
        budget: Optional cumulative budget ceiling in USD. When the ceiling
            is reached subsequent calls raise :class:`RuntimeError`. Pass
            ``None`` for unlimited.
        require_consent: Reserved for future consent-check integration.
            Currently logged but not enforced.
        log_decisions: When ``True``, each call emits a structured log
            record at INFO level to the ``aumos.governance`` logger.

    Returns:
        A decorator that wraps the target function with governance checks.
        The wrapper exposes two extra attributes:

        - ``governance_state`` (:class:`GovernanceState`) — mutable snapshot
          of accumulated state.
        - ``record_spend(amount: float) -> None`` — callable for recording
          spend after a successful operation.

    Raises:
        RuntimeError: At call time when the accumulated spend has reached
            or exceeded ``budget``.
    """
    if trust_level < 0 or trust_level > 5:
        raise ValueError(
            f"trust_level must be between 0 and 5 inclusive; got {trust_level}."
        )
    if budget is not None and budget < 0:
        raise ValueError(f"budget must be >= 0; got {budget}.")

    state = GovernanceState(
        trust_level=trust_level,
        budget_limit=budget,
    )

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            state.call_count += 1
            request_id = str(uuid.uuid4())
            tool_name = func.__qualname__

            # Build governance context for logging / future hook use.
            budget_remaining: float | None = None
            if state.budget_limit is not None:
                budget_remaining = state.budget_limit - state.spent

            context = GovernanceContext(
                trust_level=state.trust_level,
                budget_remaining=budget_remaining,
                request_id=request_id,
                tool_name=tool_name,
            )

            if log_decisions:
                logger.info(
                    "governance_check",
                    extra={
                        "request_id": context.request_id,
                        "tool": context.tool_name,
                        "trust_level": context.trust_level,
                        "call_count": state.call_count,
                        "require_consent": require_consent,
                    },
                )

            # Static budget check — no adaptive reallocation.
            if state.budget_limit is not None:
                if budget_remaining is not None and budget_remaining <= 0:
                    raise RuntimeError(
                        f"Budget exhausted for {tool_name}: "
                        f"${state.spent:.4f} spent against "
                        f"${state.budget_limit:.4f} limit."
                    )

            return func(*args, **kwargs)

        # Expose governance state and spend recorder as wrapper attributes so
        # callers can record actual cost after the underlying call completes.
        wrapper.governance_state = state  # type: ignore[attr-defined]
        wrapper.record_spend = lambda amount: _record_spend(state, amount)  # type: ignore[attr-defined]
        return wrapper

    return decorator


def _record_spend(state: GovernanceState, amount: float) -> None:
    """
    Record a spending amount against the governance budget.

    This function mutates ``state.spent``. It does NOT enforce the ceiling —
    enforcement happens at the start of each call in :func:`governed`. This
    split allows callers to record actual LLM token cost AFTER a successful
    call completes, mirroring real-world billing patterns.

    Args:
        state: The :class:`GovernanceState` instance to update.
        amount: The amount in USD to add to ``state.spent``.

    Raises:
        ValueError: If ``amount`` is negative.
    """
    if amount < 0:
        raise ValueError(f"Spend amount must be >= 0; got {amount}.")
    if state.budget_limit is not None:
        state.spent += amount

# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Django middleware integration for AumOS governance.

Attach :class:`GovernanceMiddleware` to a Django application to enforce
static trust levels and budget ceilings on every incoming HTTP request.

Django settings
---------------
Configure governance behaviour via Django settings::

    # settings.py
    AUMOS_TRUST_LEVEL = 2          # int, 0-5. Default: 2
    AUMOS_DAILY_BUDGET = 50.0      # float, USD. Default: None (unlimited)
    AUMOS_GOVERNANCE_LOG = True    # bool. Default: True

Middleware registration::

    MIDDLEWARE = [
        ...
        "aumos_governance.integrations.django_middleware.GovernanceMiddleware",
        ...
    ]

Request attributes set by this middleware
------------------------------------------
After the middleware runs ``request.aumos_governance`` will be set to a
:class:`RequestGovernanceContext` instance containing the static trust level
and remaining budget information for the current period.

Design rules
------------
- Trust levels are MANUAL ONLY — set ``AUMOS_TRUST_LEVEL`` in Django settings.
  The middleware reads that integer and attaches it to the request. It never
  modifies the configured level.
- Budget limits are STATIC ONLY — the ``AUMOS_DAILY_BUDGET`` setting defines a
  fixed daily ceiling. No adaptive reallocation occurs.
- Audit logging is RECORDING ONLY — structured log records are emitted to the
  ``aumos.governance.django`` logger; no anomaly detection is performed.

This module intentionally does NOT import Django at the top level so that it
can be imported safely in environments where Django is not installed (e.g.
during type-checking or when other integrations are in use).
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

logger = logging.getLogger("aumos.governance.django")

# ---------------------------------------------------------------------------
# Period tracker (thread-safe, static daily budget)
# ---------------------------------------------------------------------------


@dataclass
class _DailySpendTracker:
    """
    Thread-safe accumulator for daily spend totals.

    Budget is STATIC — the ``limit`` value never changes at runtime.
    """

    limit: float
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)
    _current_day: date = field(default_factory=date.today, repr=False)
    _spent: float = field(default=0.0, repr=False)

    def _maybe_reset(self) -> None:
        """Reset the daily counter when the calendar day has changed."""
        today = date.today()
        if today != self._current_day:
            self._current_day = today
            self._spent = 0.0

    def record(self, amount: float) -> None:
        """
        Record a spending amount against the daily budget.

        Args:
            amount: Amount in USD to record. Must be non-negative.
        """
        with self._lock:
            self._maybe_reset()
            self._spent += amount

    @property
    def spent(self) -> float:
        """Total spend recorded for the current calendar day."""
        with self._lock:
            self._maybe_reset()
            return self._spent

    @property
    def remaining(self) -> float:
        """Remaining budget for the current calendar day."""
        return max(0.0, self.limit - self.spent)

    @property
    def exhausted(self) -> bool:
        """True when no budget remains for the current day."""
        return self.spent >= self.limit


# ---------------------------------------------------------------------------
# Request context dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RequestGovernanceContext:
    """
    Governance context attached to each Django request as ``request.aumos_governance``.

    Attributes:
        trust_level: Static trust level read from ``AUMOS_TRUST_LEVEL``.
        daily_budget: Configured daily budget ceiling in USD, or ``None``
            when no budget limit is set.
        daily_spent: Cumulative spend for the current calendar day.
        daily_remaining: Remaining budget for the current day, or ``None``
            when no limit is configured.
        request_id: Unique identifier for this HTTP request (derived from
            the ``X-Request-ID`` header if present, otherwise a UUID).
        denied: True when the request was short-circuited by governance
            (e.g. budget exhausted).
        deny_reason: Human-readable explanation when ``denied`` is True.
    """

    trust_level: int
    daily_budget: float | None
    daily_spent: float
    daily_remaining: float | None
    request_id: str
    denied: bool = False
    deny_reason: str | None = None


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class GovernanceMiddleware:
    """
    Django middleware that enforces AumOS governance on every HTTP request.

    Reads configuration from Django settings at construction time (once per
    process). For each request the middleware:

    1. Builds a :class:`RequestGovernanceContext` with the current trust level
       and budget snapshot.
    2. If a daily budget is configured and has been exhausted, returns an
       HTTP 429 response immediately without calling the view.
    3. Attaches the context to ``request.aumos_governance`` for downstream
       use by views and other middleware.
    4. Emits a structured log record to ``aumos.governance.django``.

    Trust levels are STATIC — they are read from settings once and never
    modified by this middleware. Budget limits are STATIC — the configured
    ceiling is fixed for the lifetime of the process.

    Args:
        get_response: The next middleware or view callable, supplied by
            Django when MIDDLEWARE is constructed.
    """

    def __init__(self, get_response: Callable[..., Any]) -> None:
        self._get_response = get_response
        self._trust_level, self._tracker = self._load_settings()

    # ------------------------------------------------------------------
    # Django middleware protocol
    # ------------------------------------------------------------------

    def __call__(self, request: Any) -> Any:
        """
        Process an incoming request through governance checks.

        Args:
            request: A Django ``HttpRequest`` instance.

        Returns:
            A Django ``HttpResponse`` — either the view response when
            governance passes, or an HTTP 429 when the daily budget is
            exhausted.
        """
        import uuid

        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))

        # --- Budget check (static daily ceiling) ---
        if self._tracker is not None and self._tracker.exhausted:
            context = RequestGovernanceContext(
                trust_level=self._trust_level,
                daily_budget=self._tracker.limit,
                daily_spent=self._tracker.spent,
                daily_remaining=0.0,
                request_id=request_id,
                denied=True,
                deny_reason=(
                    f"Daily budget of ${self._tracker.limit:.2f} exhausted"
                    f" (${self._tracker.spent:.2f} spent)."
                ),
            )
            request.aumos_governance = context
            logger.warning(
                "governance_deny",
                extra={
                    "request_id": request_id,
                    "reason": context.deny_reason,
                    "trust_level": self._trust_level,
                    "path": getattr(request, "path", "unknown"),
                },
            )
            return self._budget_exceeded_response(request_id)

        # --- Attach context ---
        daily_budget: float | None = None
        daily_spent: float = 0.0
        daily_remaining: float | None = None

        if self._tracker is not None:
            daily_budget = self._tracker.limit
            daily_spent = self._tracker.spent
            daily_remaining = self._tracker.remaining

        context = RequestGovernanceContext(
            trust_level=self._trust_level,
            daily_budget=daily_budget,
            daily_spent=daily_spent,
            daily_remaining=daily_remaining,
            request_id=request_id,
        )
        request.aumos_governance = context

        logger.info(
            "governance_allow",
            extra={
                "request_id": request_id,
                "trust_level": self._trust_level,
                "daily_remaining": daily_remaining,
                "path": getattr(request, "path", "unknown"),
            },
        )

        return self._get_response(request)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_settings() -> tuple[int, _DailySpendTracker | None]:
        """
        Read AUMOS_* settings from Django's settings module.

        Returns:
            A tuple of (trust_level, tracker_or_none). The tracker is
            ``None`` when no ``AUMOS_DAILY_BUDGET`` is configured.
        """
        try:
            from django.conf import settings  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "Django must be installed to use GovernanceMiddleware. "
                "Install it with: pip install django"
            ) from exc

        trust_level: int = getattr(settings, "AUMOS_TRUST_LEVEL", 2)
        if not isinstance(trust_level, int) or not (0 <= trust_level <= 5):
            raise ValueError(
                f"AUMOS_TRUST_LEVEL must be an integer between 0 and 5; "
                f"got {trust_level!r}."
            )

        raw_budget: float | None = getattr(settings, "AUMOS_DAILY_BUDGET", None)
        tracker: _DailySpendTracker | None = None
        if raw_budget is not None:
            if not isinstance(raw_budget, (int, float)) or raw_budget < 0:
                raise ValueError(
                    f"AUMOS_DAILY_BUDGET must be a non-negative number; "
                    f"got {raw_budget!r}."
                )
            tracker = _DailySpendTracker(limit=float(raw_budget))

        return trust_level, tracker

    @staticmethod
    def _budget_exceeded_response(request_id: str) -> Any:
        """
        Build an HTTP 429 response for budget exhaustion.

        Args:
            request_id: The request identifier for the ``X-Request-ID``
                response header.

        Returns:
            A Django ``HttpResponse`` with status 429.
        """
        try:
            from django.http import HttpResponse  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "Django must be installed to use GovernanceMiddleware."
            ) from exc

        response = HttpResponse(
            content="Daily governance budget exhausted. Try again tomorrow.",
            content_type="text/plain",
            status=429,
        )
        response["X-Request-ID"] = request_id
        response["Retry-After"] = "86400"
        return response

    def record_request_spend(self, amount: float) -> None:
        """
        Record spending incurred by a request against the daily budget.

        Call this from a view or signal handler after an LLM API call
        completes and the actual cost is known::

            def my_view(request):
                result = call_llm(prompt)
                request.aumos_governance_middleware.record_request_spend(0.005)
                return JsonResponse(result)

        Note: Attach a reference to this middleware instance to the request
        in ``__call__`` if you need to call this from a view. The example
        above is illustrative; the exact wiring depends on your Django
        project setup.

        Args:
            amount: Cost in USD to record. Must be non-negative.
        """
        if amount < 0:
            raise ValueError(f"Spend amount must be >= 0; got {amount}.")
        if self._tracker is not None:
            self._tracker.record(amount)
            logger.info(
                "governance_spend_recorded",
                extra={"amount": amount, "daily_remaining": self._tracker.remaining},
            )

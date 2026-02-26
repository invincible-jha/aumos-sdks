# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from pydantic import BaseModel

from aumos_governance.budget.policy import apply_rollover, should_reset
from aumos_governance.budget.tracker import CategoryTracker, SpendingTransaction
from aumos_governance.config import BudgetConfig
from aumos_governance.errors import BudgetExceededError, BudgetNotFoundError, InvalidPeriodError
from aumos_governance.types import BUDGET_PERIOD_VALUES


class BudgetCheckResult(BaseModel, frozen=True):
    """
    Result of a budget availability check.

    Attributes:
        allowed: True if the requested amount is within the available budget.
        category: The budget category evaluated.
        requested: The amount that was checked.
        available: The remaining budget at the time of the check.
        limit: The total configured limit for the category.
        spent: The amount already spent in the current period.
        reason: Human-readable explanation of the outcome.
    """

    allowed: bool
    category: str
    requested: float
    available: float
    limit: float
    spent: float
    reason: str


class BudgetManager:
    """
    Manages static spending budgets for one or more categories.

    Budget allocations are ALWAYS static. There is no adaptive limit
    adjustment, spending prediction, or ML-based optimization.

    All data is stored in-memory. A new BudgetManager starts empty.

    Example::

        manager = BudgetManager(BudgetConfig(allow_overdraft=False))
        manager.create_budget("llm-calls", limit=100.0, period="monthly")
        manager.record_spending("llm-calls", 5.0, description="GPT-4o request")
        result = manager.check_budget("llm-calls", 10.0)
        assert result.allowed is True
    """

    def __init__(self, config: BudgetConfig | None = None) -> None:
        self._config = config or BudgetConfig()
        self._tracker = CategoryTracker()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_budget(
        self,
        category: str,
        limit: float,
        period: str = "monthly",
    ) -> None:
        """
        Create a new budget envelope for a spending category.

        Budgets are static: the limit you set here is the limit for every
        period until you replace the budget. There is no automatic adjustment.

        Args:
            category: Unique name for this budget (e.g. ``'llm-calls'``).
            limit: Maximum spend allowed per period. Must be >= 0.
            period: Reset period — one of ``'daily'``, ``'weekly'``,
                ``'monthly'``, ``'yearly'``, or ``'lifetime'``.

        Raises:
            ValueError: If ``category`` already exists, or if ``limit`` < 0.
            InvalidPeriodError: If ``period`` is not a recognised value.
        """
        if limit < 0:
            raise ValueError(f"Budget limit must be >= 0; got {limit}.")
        if period not in BUDGET_PERIOD_VALUES:
            raise InvalidPeriodError(period)
        self._tracker.create(category=category, limit=limit, period=period)

    def record_spending(
        self,
        category: str,
        amount: float,
        description: str | None = None,
    ) -> SpendingTransaction:
        """
        Record a spending transaction against a budget category.

        If :attr:`~BudgetConfig.allow_overdraft` is False and the
        transaction would exceed the budget, a
        :class:`~aumos_governance.errors.BudgetExceededError` is raised and
        **no state is mutated**.

        If the category's period has elapsed, the budget is automatically
        reset before recording the transaction.

        Args:
            category: The budget category to charge.
            amount: Amount to record. Must be positive.
            description: Optional description stored with the transaction.

        Returns:
            The created :class:`~aumos_governance.budget.tracker.SpendingTransaction`.

        Raises:
            BudgetNotFoundError: If ``category`` does not exist.
            BudgetExceededError: If the transaction would exceed the limit
                and overdraft is not allowed.
            ValueError: If ``amount`` is not positive.
        """
        envelope = self._tracker.get(category)
        if envelope is None:
            raise BudgetNotFoundError(category)

        self._maybe_reset(category)
        # Re-fetch after potential reset.
        envelope = self._tracker.get(category)
        assert envelope is not None  # noqa: S101 — guaranteed above

        if not self._config.allow_overdraft:
            projected = envelope.spent + amount
            if projected > envelope.effective_limit:
                raise BudgetExceededError(
                    category=category,
                    requested=amount,
                    available=envelope.remaining,
                )

        return self._tracker.record(category=category, amount=amount, description=description)

    def check_budget(
        self,
        category: str,
        amount: float,
    ) -> BudgetCheckResult:
        """
        Check whether a spending amount is within the available budget.

        This is a read-only operation — it does not record any spending
        or modify any state.

        Args:
            category: The budget category to check.
            amount: The amount to check against the remaining budget.

        Returns:
            A :class:`BudgetCheckResult` describing the outcome.

        Raises:
            BudgetNotFoundError: If ``category`` does not exist.
        """
        envelope = self._tracker.get(category)
        if envelope is None:
            raise BudgetNotFoundError(category)

        available = envelope.remaining
        allowed = amount <= available

        if allowed:
            reason = (
                f"Category '{category}': {amount:.4f} requested, "
                f"{available:.4f} available ({envelope.spent:.4f} of "
                f"{envelope.effective_limit:.4f} spent)."
            )
        else:
            reason = (
                f"Category '{category}': {amount:.4f} requested but only "
                f"{available:.4f} remains ({envelope.spent:.4f} of "
                f"{envelope.effective_limit:.4f} spent)."
            )

        return BudgetCheckResult(
            allowed=allowed,
            category=category,
            requested=amount,
            available=available,
            limit=envelope.effective_limit,
            spent=envelope.spent,
            reason=reason,
        )

    def get_utilization(self, category: str) -> float:
        """
        Return the fraction of the budget consumed for ``category``.

        Returns:
            A float between 0.0 and 1.0 (may exceed 1.0 if overdraft occurred).

        Raises:
            BudgetNotFoundError: If ``category`` does not exist.
        """
        envelope = self._tracker.get(category)
        if envelope is None:
            raise BudgetNotFoundError(category)
        return envelope.utilization

    def list_categories(self) -> list[str]:
        """Return all registered budget category names."""
        return self._tracker.all_categories()

    def summary(self) -> list[dict[str, object]]:
        """
        Return a summary snapshot of all budget envelopes.

        Returns:
            List of dicts, one per category, with fields:
            ``category``, ``limit``, ``effective_limit``, ``spent``,
            ``remaining``, ``utilization``, ``period``, ``last_reset``,
            ``transaction_count``.
        """
        return self._tracker.snapshot()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _maybe_reset(self, category: str) -> None:
        """Reset the budget for ``category`` if the period has elapsed."""
        envelope = self._tracker.get(category)
        if envelope is None:
            return
        if should_reset(period=envelope.period, last_reset=envelope.last_reset):
            new_limit = apply_rollover(
                spent=envelope.spent,
                limit=envelope.limit,
                rollover_on_reset=self._config.rollover_on_reset,
            )
            self._tracker.reset(category=category, new_effective_limit=new_limit)

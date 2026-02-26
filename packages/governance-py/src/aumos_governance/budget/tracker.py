# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class SpendingTransaction(BaseModel, frozen=True):
    """
    An immutable record of a single spending event.

    Attributes:
        category: The budget category this transaction belongs to.
        amount: The amount spent.
        description: Optional human-readable description of the transaction.
        recorded_at: UTC timestamp when the transaction was recorded.
    """

    category: str
    amount: float
    description: str | None = None
    recorded_at: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc)
    )


class BudgetEnvelope:
    """
    Tracks spending state for a single budget category.

    This is an internal data structure managed by :class:`CategoryTracker`.
    Do not instantiate directly — use :class:`CategoryTracker` instead.
    """

    __slots__ = (
        "category",
        "limit",
        "period",
        "effective_limit",
        "spent",
        "last_reset",
        "transactions",
    )

    def __init__(
        self,
        category: str,
        limit: float,
        period: str,
    ) -> None:
        self.category = category
        self.limit = limit
        self.period = period
        self.effective_limit: float = limit
        self.spent: float = 0.0
        self.last_reset: date = date.today()
        self.transactions: list[SpendingTransaction] = []

    @property
    def remaining(self) -> float:
        """Remaining budget (can be negative if overdraft occurred)."""
        return self.effective_limit - self.spent

    @property
    def utilization(self) -> float:
        """Fraction of the budget consumed (0.0 – 1.0, may exceed 1.0)."""
        if self.effective_limit == 0.0:
            return float("inf") if self.spent > 0 else 0.0
        return self.spent / self.effective_limit

    def to_dict(self) -> dict[str, Any]:
        """Return a plain dict snapshot of this envelope."""
        return {
            "category": self.category,
            "limit": self.limit,
            "effective_limit": self.effective_limit,
            "spent": self.spent,
            "remaining": self.remaining,
            "utilization": self.utilization,
            "period": self.period,
            "last_reset": self.last_reset.isoformat(),
            "transaction_count": len(self.transactions),
        }


class CategoryTracker:
    """
    Per-category spending tracker.

    Maintains a collection of :class:`BudgetEnvelope` objects indexed by
    category name. Provides the primitive operations that
    :class:`~aumos_governance.budget.manager.BudgetManager` builds on.
    """

    def __init__(self) -> None:
        self._envelopes: dict[str, BudgetEnvelope] = {}

    def create(self, category: str, limit: float, period: str) -> BudgetEnvelope:
        """
        Create a new budget envelope.

        Args:
            category: Unique category name.
            limit: Maximum spending allowed per period.
            period: Period identifier (e.g. ``'monthly'``).

        Returns:
            The newly created :class:`BudgetEnvelope`.

        Raises:
            ValueError: If an envelope for ``category`` already exists.
        """
        if category in self._envelopes:
            raise ValueError(
                f"Budget category '{category}' already exists. "
                "Use update() to modify it."
            )
        envelope = BudgetEnvelope(category=category, limit=limit, period=period)
        self._envelopes[category] = envelope
        return envelope

    def get(self, category: str) -> BudgetEnvelope | None:
        """Return the envelope for ``category``, or None if not found."""
        return self._envelopes.get(category)

    def record(
        self,
        category: str,
        amount: float,
        description: str | None = None,
    ) -> SpendingTransaction:
        """
        Record a spending transaction against a category.

        Args:
            category: The budget category.
            amount: Amount to record (must be positive).
            description: Optional description.

        Returns:
            The created :class:`SpendingTransaction`.

        Raises:
            KeyError: If ``category`` does not exist.
            ValueError: If ``amount`` is not positive.
        """
        if amount <= 0:
            raise ValueError(f"Spending amount must be positive; got {amount}.")

        envelope = self._envelopes[category]
        transaction = SpendingTransaction(
            category=category,
            amount=amount,
            description=description,
        )
        envelope.spent += amount
        envelope.transactions.append(transaction)
        return transaction

    def reset(self, category: str, new_effective_limit: float) -> None:
        """
        Reset spending for a category and apply a new effective limit.

        Args:
            category: The budget category to reset.
            new_effective_limit: The effective limit for the new period.

        Raises:
            KeyError: If ``category`` does not exist.
        """
        envelope = self._envelopes[category]
        envelope.spent = 0.0
        envelope.effective_limit = new_effective_limit
        envelope.last_reset = date.today()
        envelope.transactions.clear()

    def all_categories(self) -> list[str]:
        """Return all registered category names."""
        return list(self._envelopes.keys())

    def snapshot(self) -> list[dict[str, Any]]:
        """Return a list of plain-dict snapshots for all envelopes."""
        return [env.to_dict() for env in self._envelopes.values()]

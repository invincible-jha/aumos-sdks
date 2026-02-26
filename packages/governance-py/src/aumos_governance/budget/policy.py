# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import date, timedelta

from aumos_governance.errors import InvalidPeriodError
from aumos_governance.types import BUDGET_PERIOD_VALUES


def next_reset_date(period: str, from_date: date | None = None) -> date:
    """
    Calculate the next reset date for a given budget period.

    Args:
        period: One of ``'daily'``, ``'weekly'``, ``'monthly'``,
            ``'yearly'``, or ``'lifetime'``.
        from_date: Base date from which to calculate. Defaults to today.

    Returns:
        The date on which the budget resets next. For ``'lifetime'``,
        returns :attr:`datetime.date.max` (never resets).

    Raises:
        InvalidPeriodError: If ``period`` is not one of the valid values.
    """
    if period not in BUDGET_PERIOD_VALUES:
        raise InvalidPeriodError(period)

    base = from_date or date.today()

    if period == "daily":
        return base + timedelta(days=1)
    if period == "weekly":
        # Advance to the next Monday.
        days_until_monday = (7 - base.weekday()) % 7 or 7
        return base + timedelta(days=days_until_monday)
    if period == "monthly":
        if base.month == 12:
            return base.replace(year=base.year + 1, month=1, day=1)
        return base.replace(month=base.month + 1, day=1)
    if period == "yearly":
        return base.replace(year=base.year + 1, month=1, day=1)
    # lifetime
    return date.max


def should_reset(period: str, last_reset: date, as_of: date | None = None) -> bool:
    """
    Determine whether a budget envelope should be reset.

    Args:
        period: The budget period string.
        last_reset: The date on which the budget was last reset.
        as_of: The reference date for the check. Defaults to today.

    Returns:
        True if the current date has passed the next reset date.

    Raises:
        InvalidPeriodError: If ``period`` is not a valid value.
    """
    if period not in BUDGET_PERIOD_VALUES:
        raise InvalidPeriodError(period)

    if period == "lifetime":
        return False

    reference = as_of or date.today()
    reset_on = next_reset_date(period, from_date=last_reset)
    return reference >= reset_on


def apply_rollover(
    spent: float,
    limit: float,
    rollover_on_reset: bool,
) -> float:
    """
    Calculate the effective limit for the new period when rollover is enabled.

    Unspent budget from the previous period is carried forward, capped at
    twice the base limit to prevent indefinite accumulation.

    Args:
        spent: Amount spent in the previous period.
        limit: The base budget limit.
        rollover_on_reset: Whether rollover is enabled.

    Returns:
        The effective limit for the new period.
    """
    if not rollover_on_reset:
        return limit
    unspent = max(0.0, limit - spent)
    return min(limit + unspent, limit * 2.0)

# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from enum import IntEnum
from typing import Literal


class TrustLevel(IntEnum):
    """
    Enumeration of trust levels for AumOS agent governance.

    Levels are ordered: higher value means broader operational permission.
    Assignment is always manual — no automatic promotion occurs.
    """

    L0_OBSERVER = 0
    L1_MONITOR = 1
    L2_SUGGEST = 2
    L3_ACT_APPROVE = 3
    L4_ACT_REPORT = 4
    L5_AUTONOMOUS = 5

    def label(self) -> str:
        """Return a human-readable label for this trust level."""
        _labels: dict[int, str] = {
            0: "Observer",
            1: "Monitor",
            2: "Suggest",
            3: "Act (Approval Required)",
            4: "Act (Report After)",
            5: "Autonomous",
        }
        return _labels[int(self)]


class BudgetPeriod(str):
    """
    A validated string type for budget period identifiers.

    Supported values: 'daily', 'weekly', 'monthly', 'yearly', 'lifetime'.
    """

    DAILY: Literal["daily"] = "daily"
    WEEKLY: Literal["weekly"] = "weekly"
    MONTHLY: Literal["monthly"] = "monthly"
    YEARLY: Literal["yearly"] = "yearly"
    LIFETIME: Literal["lifetime"] = "lifetime"


BUDGET_PERIOD_VALUES = frozenset(
    {"daily", "weekly", "monthly", "yearly", "lifetime"}
)


class DataCategory(str):
    """
    Well-known data category constants for consent management.

    These are convenience constants; any string is a valid data type.
    """

    PERSONAL_DATA = "personal_data"
    BEHAVIORAL_DATA = "behavioral_data"
    FINANCIAL_DATA = "financial_data"
    HEALTH_DATA = "health_data"
    LOCATION_DATA = "location_data"
    COMMUNICATION_DATA = "communication_data"


class GovernanceOutcome(str):
    """Possible outcomes from a governance evaluation."""

    ALLOW = "allow"
    DENY = "deny"
    ALLOW_WITH_CAVEAT = "allow_with_caveat"

# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations


class AumOSGovernanceError(Exception):
    """Base class for all aumos-governance SDK errors."""

    def __init__(self, message: str, code: str = "GOVERNANCE_ERROR") -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __repr__(self) -> str:
        return f"{type(self).__name__}(code={self.code!r}, message={self.message!r})"


class TrustLevelError(AumOSGovernanceError):
    """
    Raised when an action is denied due to insufficient trust level.

    Attributes:
        agent_id: The agent whose trust level was evaluated.
        required_level: The minimum trust level required.
        actual_level: The agent's current trust level.
    """

    def __init__(
        self,
        agent_id: str,
        required_level: int,
        actual_level: int,
        scope: str | None = None,
    ) -> None:
        scope_text = f" (scope: {scope})" if scope else ""
        super().__init__(
            f"Agent '{agent_id}'{scope_text} has trust level {actual_level} "
            f"but action requires level {required_level}.",
            code="TRUST_LEVEL_INSUFFICIENT",
        )
        self.agent_id = agent_id
        self.required_level = required_level
        self.actual_level = actual_level
        self.scope = scope


class BudgetExceededError(AumOSGovernanceError):
    """
    Raised when a spending request would exceed the configured budget limit.

    Attributes:
        category: The budget category that would be exceeded.
        requested: The amount requested.
        available: The remaining available budget.
    """

    def __init__(
        self,
        category: str,
        requested: float,
        available: float,
    ) -> None:
        super().__init__(
            f"Budget category '{category}': requested {requested:.4f} "
            f"but only {available:.4f} remains.",
            code="BUDGET_EXCEEDED",
        )
        self.category = category
        self.requested = requested
        self.available = available


class BudgetNotFoundError(AumOSGovernanceError):
    """Raised when a referenced budget category does not exist."""

    def __init__(self, category: str) -> None:
        super().__init__(
            f"Budget category '{category}' does not exist. "
            "Create it first with BudgetManager.create_budget().",
            code="BUDGET_NOT_FOUND",
        )
        self.category = category


class ConsentDeniedError(AumOSGovernanceError):
    """
    Raised when consent has not been granted for a data access request.

    Attributes:
        agent_id: The agent requesting data access.
        data_type: The type of data being accessed.
        purpose: The purpose for which access was requested.
    """

    def __init__(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> None:
        purpose_text = f" for purpose '{purpose}'" if purpose else ""
        super().__init__(
            f"Consent not granted for agent '{agent_id}' "
            f"to access data type '{data_type}'{purpose_text}.",
            code="CONSENT_DENIED",
        )
        self.agent_id = agent_id
        self.data_type = data_type
        self.purpose = purpose


class ConsentNotFoundError(AumOSGovernanceError):
    """Raised when a consent record cannot be found for revocation."""

    def __init__(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> None:
        purpose_text = f" (purpose: {purpose})" if purpose else ""
        super().__init__(
            f"No consent record found for agent '{agent_id}', "
            f"data type '{data_type}'{purpose_text}.",
            code="CONSENT_NOT_FOUND",
        )
        self.agent_id = agent_id
        self.data_type = data_type
        self.purpose = purpose


class ConfigurationError(AumOSGovernanceError):
    """Raised when the SDK is misconfigured."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="CONFIGURATION_ERROR")


class InvalidPeriodError(AumOSGovernanceError):
    """Raised when an invalid budget period string is provided."""

    def __init__(self, value: str) -> None:
        from aumos_governance.types import BUDGET_PERIOD_VALUES

        super().__init__(
            f"'{value}' is not a valid budget period. "
            f"Valid values: {sorted(BUDGET_PERIOD_VALUES)}.",
            code="INVALID_PERIOD",
        )
        self.value = value

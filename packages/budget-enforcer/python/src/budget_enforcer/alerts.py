# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Budget alert system for the AumOS budget enforcer.

Provides static threshold-based alerts when spending reaches
predefined percentages of budget limits. Alerts are emitted via
webhook payloads.

This module uses STATIC thresholds only — no dynamic, adaptive,
or ML-based threshold adjustment is performed.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal, Protocol

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Alert models
# ---------------------------------------------------------------------------

AlertLevel = Literal["warning", "high", "critical", "exceeded"]

# Static threshold percentages — these do not change at runtime.
DEFAULT_THRESHOLDS: tuple[float, ...] = (0.50, 0.75, 0.90, 1.00)

THRESHOLD_ALERT_LEVELS: dict[float, AlertLevel] = {
    0.50: "warning",
    0.75: "high",
    0.90: "critical",
    1.00: "exceeded",
}


class AlertThreshold(BaseModel, frozen=True):
    """A static budget alert threshold."""

    percentage: float = Field(
        ..., gt=0.0, le=1.0, description="Threshold as a fraction of budget (0.0–1.0)."
    )
    alert_level: AlertLevel = Field(..., description="Severity level for this threshold.")


class BudgetAlertConfig(BaseModel, frozen=True):
    """Configuration for a budget alert on a specific budget."""

    budget_id: str = Field(..., min_length=1, description="Identifier of the monitored budget.")
    limit: float = Field(..., gt=0, description="Budget limit in USD.")
    thresholds: list[AlertThreshold] = Field(
        default_factory=lambda: [
            AlertThreshold(percentage=p, alert_level=THRESHOLD_ALERT_LEVELS[p])
            for p in DEFAULT_THRESHOLDS
        ],
        description="List of static thresholds to monitor.",
    )
    webhook_url: str = Field(
        ..., min_length=1, description="Webhook URL to send alert payloads to."
    )


class WebhookPayload(BaseModel, frozen=True):
    """Payload sent to the configured webhook when a threshold is crossed."""

    budget_id: str = Field(..., description="Identifier of the budget that triggered the alert.")
    current_spend: float = Field(..., ge=0.0, description="Current spend amount in USD.")
    limit: float = Field(..., gt=0, description="Budget limit in USD.")
    percentage: float = Field(
        ..., ge=0.0, description="Current spend as a percentage of the limit (0.0–1.0+)."
    )
    alert_level: AlertLevel = Field(..., description="Severity level of the triggered alert.")
    triggered_at_iso: str = Field(..., description="ISO 8601 timestamp when the alert fired.")


class ThresholdCheckResult(BaseModel, frozen=True):
    """Result of checking all thresholds for a single budget."""

    budget_id: str
    current_spend: float
    limit: float
    triggered_alerts: list[WebhookPayload]


# ---------------------------------------------------------------------------
# Webhook sender protocol
# ---------------------------------------------------------------------------


class WebhookSender(Protocol):
    """Protocol for sending webhook payloads. Injected for testability."""

    def send(self, url: str, payload: str) -> bool:
        """Send a JSON payload to the given URL. Returns True on success."""
        ...


# ---------------------------------------------------------------------------
# BudgetAlertManager
# ---------------------------------------------------------------------------


class BudgetAlertManager:
    """
    Manages static budget alert thresholds and webhook notifications.

    Thresholds are fixed at configuration time — they do not adapt
    based on spending patterns or any dynamic analysis.

    Usage::

        manager = BudgetAlertManager(webhook_sender=my_sender)
        manager.configure_alert(BudgetAlertConfig(
            budget_id="llm-calls",
            limit=100.0,
            webhook_url="https://hooks.example.com/alerts",
        ))
        result = manager.check_thresholds("llm-calls", current_spend=76.0)
    """

    def __init__(self, webhook_sender: WebhookSender | None = None) -> None:
        self._configs: dict[str, BudgetAlertConfig] = {}
        self._fired: dict[str, set[float]] = {}  # budget_id -> set of fired threshold percentages
        self._webhook_sender = webhook_sender

    def configure_alert(self, config: BudgetAlertConfig) -> None:
        """
        Register or replace an alert configuration for a budget.

        This resets the fired-threshold state for the budget, meaning
        all thresholds become eligible to fire again.

        Args:
            config: The alert configuration to register.
        """
        self._configs[config.budget_id] = config
        self._fired[config.budget_id] = set()

    def remove_alert(self, budget_id: str) -> bool:
        """
        Remove an alert configuration for a budget.

        Returns:
            True if a configuration existed and was removed.
        """
        existed = budget_id in self._configs
        self._configs.pop(budget_id, None)
        self._fired.pop(budget_id, None)
        return existed

    def check_thresholds(
        self,
        budget_id: str,
        current_spend: float,
    ) -> ThresholdCheckResult:
        """
        Check all configured thresholds for a budget against current spend.

        Each threshold fires at most once per configuration cycle. To reset
        fired thresholds, call ``configure_alert`` again.

        Args:
            budget_id:      The budget to check.
            current_spend:  The current spend amount in USD.

        Returns:
            A ThresholdCheckResult with any newly triggered alerts.

        Raises:
            KeyError: If no alert configuration exists for the budget_id.
        """
        config = self._configs.get(budget_id)
        if config is None:
            raise KeyError(f"No alert configuration for budget_id: {budget_id!r}")

        percentage = current_spend / config.limit if config.limit > 0 else 0.0
        now_iso = datetime.now(tz=timezone.utc).isoformat()

        fired_set = self._fired.setdefault(budget_id, set())
        triggered: list[WebhookPayload] = []

        for threshold in config.thresholds:
            if percentage >= threshold.percentage and threshold.percentage not in fired_set:
                fired_set.add(threshold.percentage)
                payload = WebhookPayload(
                    budget_id=budget_id,
                    current_spend=current_spend,
                    limit=config.limit,
                    percentage=round(percentage, 4),
                    alert_level=threshold.alert_level,
                    triggered_at_iso=now_iso,
                )
                triggered.append(payload)

        return ThresholdCheckResult(
            budget_id=budget_id,
            current_spend=current_spend,
            limit=config.limit,
            triggered_alerts=triggered,
        )

    def send_webhook(self, payload: WebhookPayload, budget_id: str) -> bool:
        """
        Send a webhook notification for a triggered alert.

        Args:
            payload:    The webhook payload to send.
            budget_id:  The budget ID (used to look up the webhook URL).

        Returns:
            True if the webhook was sent successfully, False otherwise.
        """
        config = self._configs.get(budget_id)
        if config is None:
            return False

        if self._webhook_sender is None:
            return False

        payload_json = payload.model_dump_json()
        return self._webhook_sender.send(config.webhook_url, payload_json)

    def check_and_notify(
        self,
        budget_id: str,
        current_spend: float,
    ) -> ThresholdCheckResult:
        """
        Check thresholds and automatically send webhooks for triggered alerts.

        Convenience method that combines ``check_thresholds`` and
        ``send_webhook`` into a single call.

        Args:
            budget_id:      The budget to check.
            current_spend:  The current spend amount in USD.

        Returns:
            A ThresholdCheckResult with triggered alerts (webhooks sent).
        """
        result = self.check_thresholds(budget_id, current_spend)
        for alert in result.triggered_alerts:
            self.send_webhook(alert, budget_id)
        return result

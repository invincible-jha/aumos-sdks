# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Cloud billing API adapters for the AumOS budget enforcer.

Provides a uniform interface for querying current spend and per-model usage
from major LLM provider billing APIs. All adapters are read-only — they
query billing data but never modify budgets, spending limits, or account
settings.

Supported providers:
- OpenAI
- Anthropic
- Azure OpenAI Service
- AWS Bedrock

This module does NOT perform spending prediction, cost optimization,
or any ML-based allocation.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Protocol

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ModelUsage(BaseModel, frozen=True):
    """Usage breakdown for a single model."""

    model_id: str = Field(..., description="Model identifier as reported by the provider.")
    input_tokens: int = Field(..., ge=0, description="Total input tokens consumed.")
    output_tokens: int = Field(..., ge=0, description="Total output tokens consumed.")
    total_cost: float = Field(..., ge=0.0, description="Total cost in USD for this model.")
    request_count: int = Field(..., ge=0, description="Number of API requests to this model.")


class CurrentSpend(BaseModel, frozen=True):
    """Current spending summary from a billing provider."""

    provider: str = Field(..., description="Name of the billing provider.")
    total_cost_usd: float = Field(..., ge=0.0, description="Total spend in USD.")
    period_start_iso: str = Field(..., description="ISO 8601 start of the billing period.")
    period_end_iso: str = Field(..., description="ISO 8601 end of the billing period.")
    currency: str = Field(default="USD", description="Currency code.")
    retrieved_at_iso: str = Field(..., description="ISO 8601 timestamp when data was fetched.")


class UsageByModel(BaseModel, frozen=True):
    """Per-model usage breakdown from a billing provider."""

    provider: str = Field(..., description="Name of the billing provider.")
    models: list[ModelUsage] = Field(default_factory=list)
    total_cost_usd: float = Field(..., ge=0.0, description="Aggregate cost across all models.")
    retrieved_at_iso: str = Field(..., description="ISO 8601 timestamp when data was fetched.")


# ---------------------------------------------------------------------------
# HTTP client protocol
# ---------------------------------------------------------------------------


class HttpClient(Protocol):
    """
    Protocol for an HTTP client dependency.

    Adapters require an injected HTTP client rather than importing
    a specific library, enabling testing and provider abstraction.
    """

    def get(self, url: str, headers: dict[str, str]) -> dict[str, object]:
        """Perform an HTTP GET request and return the parsed JSON response."""
        ...


# ---------------------------------------------------------------------------
# Abstract billing provider
# ---------------------------------------------------------------------------


class BillingProvider(ABC):
    """
    Abstract base class for cloud billing API adapters.

    All methods are read-only queries — no billing modification, budget
    adjustment, spending prediction, or cost optimization is performed.

    Subclasses must implement ``get_current_spend`` and ``get_usage_by_model``
    for their specific provider API.
    """

    def __init__(self, api_key: str, http_client: HttpClient) -> None:
        self._api_key = api_key
        self._http_client = http_client

    @abstractmethod
    def get_current_spend(self) -> CurrentSpend:
        """
        Query the provider's billing API for current period spend.

        Returns:
            A CurrentSpend snapshot with total cost and period boundaries.
        """
        ...

    @abstractmethod
    def get_usage_by_model(self) -> UsageByModel:
        """
        Query the provider's billing API for per-model usage breakdown.

        Returns:
            A UsageByModel snapshot with cost and token counts per model.
        """
        ...

    def _now_iso(self) -> str:
        """Return the current UTC time as an ISO 8601 string."""
        return datetime.now(tz=timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# OpenAI adapter
# ---------------------------------------------------------------------------


class OpenAIBillingAdapter(BillingProvider):
    """
    Read-only billing adapter for the OpenAI API.

    Queries the OpenAI usage endpoints to retrieve current spend
    and per-model token usage. Requires an OpenAI API key with
    billing read permissions.
    """

    PROVIDER_NAME: str = "openai"
    BASE_URL: str = "https://api.openai.com/v1"

    def get_current_spend(self) -> CurrentSpend:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        response = self._http_client.get(
            f"{self.BASE_URL}/organization/usage", headers
        )
        now = self._now_iso()
        total_cost = float(response.get("total_usage", 0)) / 100.0  # cents to USD

        return CurrentSpend(
            provider=self.PROVIDER_NAME,
            total_cost_usd=total_cost,
            period_start_iso=str(response.get("period_start", now)),
            period_end_iso=str(response.get("period_end", now)),
            retrieved_at_iso=now,
        )

    def get_usage_by_model(self) -> UsageByModel:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        response = self._http_client.get(
            f"{self.BASE_URL}/organization/usage", headers
        )
        now = self._now_iso()
        models: list[ModelUsage] = []
        raw_data = response.get("data", [])

        if isinstance(raw_data, list):
            for entry in raw_data:
                if isinstance(entry, dict):
                    models.append(
                        ModelUsage(
                            model_id=str(entry.get("model", "unknown")),
                            input_tokens=int(entry.get("n_context_tokens_total", 0)),
                            output_tokens=int(entry.get("n_generated_tokens_total", 0)),
                            total_cost=float(entry.get("cost", 0)) / 100.0,
                            request_count=int(entry.get("n_requests", 0)),
                        )
                    )

        total_cost = sum(m.total_cost for m in models)
        return UsageByModel(
            provider=self.PROVIDER_NAME,
            models=models,
            total_cost_usd=total_cost,
            retrieved_at_iso=now,
        )


# ---------------------------------------------------------------------------
# Anthropic adapter
# ---------------------------------------------------------------------------


class AnthropicBillingAdapter(BillingProvider):
    """
    Read-only billing adapter for the Anthropic API.

    Queries Anthropic usage endpoints for current spend and per-model
    token usage. Requires an Anthropic API key with billing permissions.
    """

    PROVIDER_NAME: str = "anthropic"
    BASE_URL: str = "https://api.anthropic.com/v1"

    def get_current_spend(self) -> CurrentSpend:
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
        }
        response = self._http_client.get(
            f"{self.BASE_URL}/usage", headers
        )
        now = self._now_iso()

        return CurrentSpend(
            provider=self.PROVIDER_NAME,
            total_cost_usd=float(response.get("total_cost_usd", 0)),
            period_start_iso=str(response.get("period_start", now)),
            period_end_iso=str(response.get("period_end", now)),
            retrieved_at_iso=now,
        )

    def get_usage_by_model(self) -> UsageByModel:
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
        }
        response = self._http_client.get(
            f"{self.BASE_URL}/usage", headers
        )
        now = self._now_iso()
        models: list[ModelUsage] = []
        raw_models = response.get("by_model", [])

        if isinstance(raw_models, list):
            for entry in raw_models:
                if isinstance(entry, dict):
                    models.append(
                        ModelUsage(
                            model_id=str(entry.get("model", "unknown")),
                            input_tokens=int(entry.get("input_tokens", 0)),
                            output_tokens=int(entry.get("output_tokens", 0)),
                            total_cost=float(entry.get("cost_usd", 0)),
                            request_count=int(entry.get("request_count", 0)),
                        )
                    )

        total_cost = sum(m.total_cost for m in models)
        return UsageByModel(
            provider=self.PROVIDER_NAME,
            models=models,
            total_cost_usd=total_cost,
            retrieved_at_iso=now,
        )


# ---------------------------------------------------------------------------
# Azure OpenAI adapter
# ---------------------------------------------------------------------------


class AzureBillingAdapter(BillingProvider):
    """
    Read-only billing adapter for Azure OpenAI Service.

    Queries the Azure Cost Management API for OpenAI service spend.
    Requires an Azure API key or service principal with cost reader role.
    """

    PROVIDER_NAME: str = "azure"

    def __init__(
        self,
        api_key: str,
        http_client: HttpClient,
        subscription_id: str,
        resource_group: str,
    ) -> None:
        super().__init__(api_key, http_client)
        self._subscription_id = subscription_id
        self._resource_group = resource_group

    def _base_url(self) -> str:
        return (
            f"https://management.azure.com/subscriptions/{self._subscription_id}"
            f"/resourceGroups/{self._resource_group}"
        )

    def get_current_spend(self) -> CurrentSpend:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        response = self._http_client.get(
            f"{self._base_url()}/providers/Microsoft.CostManagement/query?api-version=2023-11-01",
            headers,
        )
        now = self._now_iso()

        return CurrentSpend(
            provider=self.PROVIDER_NAME,
            total_cost_usd=float(response.get("total_cost", 0)),
            period_start_iso=str(response.get("period_start", now)),
            period_end_iso=str(response.get("period_end", now)),
            retrieved_at_iso=now,
        )

    def get_usage_by_model(self) -> UsageByModel:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        response = self._http_client.get(
            f"{self._base_url()}/providers/Microsoft.CognitiveServices/accounts?api-version=2023-05-01",
            headers,
        )
        now = self._now_iso()
        models: list[ModelUsage] = []
        raw_deployments = response.get("deployments", [])

        if isinstance(raw_deployments, list):
            for entry in raw_deployments:
                if isinstance(entry, dict):
                    models.append(
                        ModelUsage(
                            model_id=str(entry.get("model", "unknown")),
                            input_tokens=int(entry.get("prompt_tokens", 0)),
                            output_tokens=int(entry.get("completion_tokens", 0)),
                            total_cost=float(entry.get("cost_usd", 0)),
                            request_count=int(entry.get("request_count", 0)),
                        )
                    )

        total_cost = sum(m.total_cost for m in models)
        return UsageByModel(
            provider=self.PROVIDER_NAME,
            models=models,
            total_cost_usd=total_cost,
            retrieved_at_iso=now,
        )


# ---------------------------------------------------------------------------
# AWS Bedrock adapter
# ---------------------------------------------------------------------------


class BedrockBillingAdapter(BillingProvider):
    """
    Read-only billing adapter for AWS Bedrock.

    Queries the AWS Cost Explorer API for Bedrock model invocation costs.
    Requires an AWS access key with ce:GetCostAndUsage permissions.
    """

    PROVIDER_NAME: str = "bedrock"
    BASE_URL: str = "https://ce.us-east-1.amazonaws.com"

    def __init__(
        self,
        api_key: str,
        http_client: HttpClient,
        region: str = "us-east-1",
    ) -> None:
        super().__init__(api_key, http_client)
        self._region = region

    def get_current_spend(self) -> CurrentSpend:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        response = self._http_client.get(
            f"{self.BASE_URL}/cost-and-usage?service=AmazonBedrock",
            headers,
        )
        now = self._now_iso()

        return CurrentSpend(
            provider=self.PROVIDER_NAME,
            total_cost_usd=float(response.get("total_cost", 0)),
            period_start_iso=str(response.get("period_start", now)),
            period_end_iso=str(response.get("period_end", now)),
            retrieved_at_iso=now,
        )

    def get_usage_by_model(self) -> UsageByModel:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        response = self._http_client.get(
            f"{self.BASE_URL}/cost-and-usage?service=AmazonBedrock&group_by=model",
            headers,
        )
        now = self._now_iso()
        models: list[ModelUsage] = []
        raw_groups = response.get("groups", [])

        if isinstance(raw_groups, list):
            for entry in raw_groups:
                if isinstance(entry, dict):
                    models.append(
                        ModelUsage(
                            model_id=str(entry.get("model_id", "unknown")),
                            input_tokens=int(entry.get("input_tokens", 0)),
                            output_tokens=int(entry.get("output_tokens", 0)),
                            total_cost=float(entry.get("cost", 0)),
                            request_count=int(entry.get("invocation_count", 0)),
                        )
                    )

        total_cost = sum(m.total_cost for m in models)
        return UsageByModel(
            provider=self.PROVIDER_NAME,
            models=models,
            total_cost_usd=total_cost,
            retrieved_at_iso=now,
        )

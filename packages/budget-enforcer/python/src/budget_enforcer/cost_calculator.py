# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Per-run cost calculator for the AumOS budget enforcer.

Aggregates usage events from a single agent run and computes total cost
using static price tables. This module is purely computational — it reads
usage data and applies fixed pricing. It does NOT perform cost optimization,
spending prediction, or any adaptive pricing.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Usage event model
# ---------------------------------------------------------------------------


class UsageEvent(BaseModel, frozen=True):
    """
    A single usage event within an agent run.

    Represents a billable action such as an LLM API call, tool invocation,
    or other metered resource consumption.
    """

    event_type: str = Field(
        ...,
        description=(
            "Type of usage event. One of: "
            "'input_tokens', 'output_tokens', 'tool_call', 'api_call', 'embedding_tokens'."
        ),
    )
    model_id: str = Field(
        default="default",
        description="Model identifier for token-based events.",
    )
    quantity: int = Field(
        ..., ge=0, description="Number of units consumed (tokens, calls, etc.)."
    )
    timestamp_iso: str | None = Field(
        default=None, description="ISO 8601 timestamp of the event."
    )


# ---------------------------------------------------------------------------
# Static price tables
# ---------------------------------------------------------------------------

# Prices in USD per unit. These are static lookup tables.
# They are NOT dynamic, NOT adaptive, and NOT ML-based.

INPUT_TOKEN_PRICES: dict[str, float] = {
    "gpt-4": 30.0 / 1_000_000,
    "gpt-4-turbo": 10.0 / 1_000_000,
    "gpt-4o": 2.5 / 1_000_000,
    "gpt-4o-mini": 0.15 / 1_000_000,
    "gpt-3.5-turbo": 0.5 / 1_000_000,
    "claude-opus-4": 15.0 / 1_000_000,
    "claude-sonnet-4": 3.0 / 1_000_000,
    "claude-haiku": 0.25 / 1_000_000,
    "default": 10.0 / 1_000_000,
}

OUTPUT_TOKEN_PRICES: dict[str, float] = {
    "gpt-4": 60.0 / 1_000_000,
    "gpt-4-turbo": 30.0 / 1_000_000,
    "gpt-4o": 10.0 / 1_000_000,
    "gpt-4o-mini": 0.6 / 1_000_000,
    "gpt-3.5-turbo": 1.5 / 1_000_000,
    "claude-opus-4": 75.0 / 1_000_000,
    "claude-sonnet-4": 15.0 / 1_000_000,
    "claude-haiku": 1.25 / 1_000_000,
    "default": 30.0 / 1_000_000,
}

EMBEDDING_TOKEN_PRICES: dict[str, float] = {
    "text-embedding-3-small": 0.02 / 1_000_000,
    "text-embedding-3-large": 0.13 / 1_000_000,
    "text-embedding-ada-002": 0.1 / 1_000_000,
    "default": 0.1 / 1_000_000,
}

# Flat per-call prices
TOOL_CALL_PRICE: float = 0.001  # USD per tool call
API_CALL_PRICE: float = 0.0005  # USD per generic API call


# ---------------------------------------------------------------------------
# Cost breakdown model
# ---------------------------------------------------------------------------


class CostBreakdown(BaseModel, frozen=True):
    """Cost breakdown by event type."""

    input_token_cost: float = Field(default=0.0, ge=0.0, description="Total cost for input tokens.")
    output_token_cost: float = Field(
        default=0.0, ge=0.0, description="Total cost for output tokens."
    )
    embedding_token_cost: float = Field(
        default=0.0, ge=0.0, description="Total cost for embedding tokens."
    )
    tool_call_cost: float = Field(default=0.0, ge=0.0, description="Total cost for tool calls.")
    api_call_cost: float = Field(default=0.0, ge=0.0, description="Total cost for API calls.")


class UsageSummary(BaseModel, frozen=True):
    """Aggregated usage quantities by event type."""

    total_input_tokens: int = Field(default=0, ge=0)
    total_output_tokens: int = Field(default=0, ge=0)
    total_embedding_tokens: int = Field(default=0, ge=0)
    total_tool_calls: int = Field(default=0, ge=0)
    total_api_calls: int = Field(default=0, ge=0)


class RunCost(BaseModel, frozen=True):
    """
    Complete cost calculation result for a single agent run.

    Contains the total cost, per-category breakdown, and usage summary.
    """

    total_cost_usd: float = Field(..., ge=0.0, description="Total run cost in USD.")
    breakdown: CostBreakdown = Field(..., description="Cost breakdown by event type.")
    usage: UsageSummary = Field(..., description="Aggregated usage quantities.")
    event_count: int = Field(..., ge=0, description="Total number of usage events processed.")
    calculated_at_iso: str = Field(
        ..., description="ISO 8601 timestamp when cost was calculated."
    )


# ---------------------------------------------------------------------------
# Price lookup helpers
# ---------------------------------------------------------------------------


def _lookup_input_price(model_id: str) -> float:
    """Look up the input token price for a model, falling back to default."""
    return INPUT_TOKEN_PRICES.get(model_id, INPUT_TOKEN_PRICES["default"])


def _lookup_output_price(model_id: str) -> float:
    """Look up the output token price for a model, falling back to default."""
    return OUTPUT_TOKEN_PRICES.get(model_id, OUTPUT_TOKEN_PRICES["default"])


def _lookup_embedding_price(model_id: str) -> float:
    """Look up the embedding token price for a model, falling back to default."""
    return EMBEDDING_TOKEN_PRICES.get(model_id, EMBEDDING_TOKEN_PRICES["default"])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def calculate_run_cost(
    events: list[UsageEvent],
    now_iso: str | None = None,
) -> RunCost:
    """
    Calculate the total cost of an agent run from a list of usage events.

    Applies static price tables to aggregate costs by event type.
    This function does NOT perform cost optimization, spending prediction,
    or any adaptive pricing.

    Args:
        events:   List of UsageEvent instances for the run.
        now_iso:  Optional ISO 8601 timestamp for the calculation.
                  Defaults to current UTC time.

    Returns:
        A RunCost with total cost, breakdown, and usage summary.
    """
    if now_iso is None:
        now_iso = datetime.now(tz=timezone.utc).isoformat()

    # Accumulators
    input_token_cost = 0.0
    output_token_cost = 0.0
    embedding_token_cost = 0.0
    tool_call_cost = 0.0
    api_call_cost = 0.0

    total_input_tokens = 0
    total_output_tokens = 0
    total_embedding_tokens = 0
    total_tool_calls = 0
    total_api_calls = 0

    for event in events:
        if event.event_type == "input_tokens":
            price = _lookup_input_price(event.model_id)
            input_token_cost += event.quantity * price
            total_input_tokens += event.quantity

        elif event.event_type == "output_tokens":
            price = _lookup_output_price(event.model_id)
            output_token_cost += event.quantity * price
            total_output_tokens += event.quantity

        elif event.event_type == "embedding_tokens":
            price = _lookup_embedding_price(event.model_id)
            embedding_token_cost += event.quantity * price
            total_embedding_tokens += event.quantity

        elif event.event_type == "tool_call":
            tool_call_cost += event.quantity * TOOL_CALL_PRICE
            total_tool_calls += event.quantity

        elif event.event_type == "api_call":
            api_call_cost += event.quantity * API_CALL_PRICE
            total_api_calls += event.quantity

    total_cost = (
        input_token_cost
        + output_token_cost
        + embedding_token_cost
        + tool_call_cost
        + api_call_cost
    )

    return RunCost(
        total_cost_usd=round(total_cost, 8),
        breakdown=CostBreakdown(
            input_token_cost=round(input_token_cost, 8),
            output_token_cost=round(output_token_cost, 8),
            embedding_token_cost=round(embedding_token_cost, 8),
            tool_call_cost=round(tool_call_cost, 8),
            api_call_cost=round(api_call_cost, 8),
        ),
        usage=UsageSummary(
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_embedding_tokens=total_embedding_tokens,
            total_tool_calls=total_tool_calls,
            total_api_calls=total_api_calls,
        ),
        event_count=len(events),
        calculated_at_iso=now_iso,
    )

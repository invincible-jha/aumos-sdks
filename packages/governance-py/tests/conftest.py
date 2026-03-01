# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""Shared fixtures for aumos-governance Python SDK tests."""

from __future__ import annotations

import pytest

from aumos_governance.config import GovernanceConfig
from aumos_governance.engine import GovernanceEngine
from aumos_governance.types import TrustLevel


@pytest.fixture
def engine() -> GovernanceEngine:
    """A freshly initialised GovernanceEngine with default config."""
    return GovernanceEngine()


@pytest.fixture
def engine_with_agent(engine: GovernanceEngine) -> GovernanceEngine:
    """An engine with 'agent-001' pre-configured at L3_ACT_APPROVE."""
    engine.trust.set_level("agent-001", TrustLevel.L3_ACT_APPROVE)
    engine.budget.create_budget("llm", limit=100.0, period="monthly")
    engine.consent.record_consent(
        agent_id="agent-001",
        data_type="user_data",
        purpose="support",
        granted_by="admin",
    )
    return engine

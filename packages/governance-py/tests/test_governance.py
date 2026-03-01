# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Tests for aumos-governance Python SDK — TrustManager, BudgetManager,
ConsentManager, and GovernanceEngine.
"""

from __future__ import annotations

import pytest

from aumos_governance.budget.manager import BudgetManager
from aumos_governance.consent.manager import ConsentManager
from aumos_governance.engine import GovernanceAction, GovernanceDecision, GovernanceEngine
from aumos_governance.errors import (
    BudgetExceededError,
    BudgetNotFoundError,
    ConsentNotFoundError,
    TrustLevelError,
)
from aumos_governance.trust.manager import TrustManager
from aumos_governance.types import GovernanceOutcome, TrustLevel


# ---------------------------------------------------------------------------
# TestTrustLevel
# ---------------------------------------------------------------------------


class TestTrustLevel:
    def test_levels_are_ordered_by_integer_value(self) -> None:
        assert TrustLevel.L0_OBSERVER < TrustLevel.L1_MONITOR
        assert TrustLevel.L1_MONITOR < TrustLevel.L2_SUGGEST
        assert TrustLevel.L2_SUGGEST < TrustLevel.L3_ACT_APPROVE
        assert TrustLevel.L3_ACT_APPROVE < TrustLevel.L4_ACT_REPORT
        assert TrustLevel.L4_ACT_REPORT < TrustLevel.L5_AUTONOMOUS

    def test_label_returns_human_readable_string(self) -> None:
        assert TrustLevel.L0_OBSERVER.label() == "Observer"
        assert TrustLevel.L5_AUTONOMOUS.label() == "Autonomous"


# ---------------------------------------------------------------------------
# TestTrustManager
# ---------------------------------------------------------------------------


class TestTrustManager:
    def test_unknown_agent_gets_default_level(self) -> None:
        manager = TrustManager()
        # Default level is L0_OBSERVER (0) per TrustConfig
        level = manager.get_level("unknown-agent")
        assert isinstance(level, TrustLevel)

    def test_set_and_get_level(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L3_ACT_APPROVE)
        assert manager.get_level("agent-001") == TrustLevel.L3_ACT_APPROVE

    def test_set_level_with_empty_agent_id_raises_value_error(self) -> None:
        manager = TrustManager()
        with pytest.raises(ValueError, match="agent_id must be a non-empty string"):
            manager.set_level("", TrustLevel.L2_SUGGEST)

    def test_check_level_allowed_when_meets_requirement(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L3_ACT_APPROVE)
        result = manager.check_level("agent-001", TrustLevel.L2_SUGGEST)
        assert result.allowed is True

    def test_check_level_denied_when_below_requirement(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L1_MONITOR)
        result = manager.check_level("agent-001", TrustLevel.L3_ACT_APPROVE)
        assert result.allowed is False

    def test_check_level_allowed_when_exactly_meets_requirement(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L3_ACT_APPROVE)
        result = manager.check_level("agent-001", TrustLevel.L3_ACT_APPROVE)
        assert result.allowed is True

    def test_require_level_raises_trust_level_error_on_failure(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L0_OBSERVER)
        with pytest.raises(TrustLevelError):
            manager.require_level("agent-001", TrustLevel.L5_AUTONOMOUS)

    def test_require_level_does_not_raise_when_sufficient(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L5_AUTONOMOUS)
        # Should not raise
        manager.require_level("agent-001", TrustLevel.L2_SUGGEST)

    def test_scoped_assignment_takes_precedence_over_global(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L1_MONITOR)
        manager.set_level("agent-001", TrustLevel.L4_ACT_REPORT, scope="prod")
        assert manager.get_level("agent-001", scope="prod") == TrustLevel.L4_ACT_REPORT
        # Global level unchanged
        assert manager.get_level("agent-001") == TrustLevel.L1_MONITOR

    def test_update_existing_level(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L2_SUGGEST)
        manager.set_level("agent-001", TrustLevel.L4_ACT_REPORT)
        assert manager.get_level("agent-001") == TrustLevel.L4_ACT_REPORT

    def test_remove_returns_true_when_entry_exists(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-001", TrustLevel.L2_SUGGEST)
        assert manager.remove("agent-001") is True

    def test_remove_returns_false_when_entry_absent(self) -> None:
        manager = TrustManager()
        assert manager.remove("nonexistent-agent") is False

    def test_list_agents_returns_registered_agents(self) -> None:
        manager = TrustManager()
        manager.set_level("agent-a", TrustLevel.L1_MONITOR)
        manager.set_level("agent-b", TrustLevel.L2_SUGGEST)
        agents = manager.list_agents()
        assert "agent-a" in agents
        assert "agent-b" in agents


# ---------------------------------------------------------------------------
# TestBudgetManager
# ---------------------------------------------------------------------------


class TestBudgetManager:
    def test_create_budget_and_check_within_limit(self) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=100.0, period="monthly")
        result = manager.check_budget("llm", amount=10.0)
        assert result.allowed is True
        assert result.available == 100.0

    def test_check_budget_denied_when_request_exceeds_limit(self) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=5.0, period="monthly")
        result = manager.check_budget("llm", amount=10.0)
        assert result.allowed is False

    def test_check_budget_raises_when_category_not_found(self) -> None:
        manager = BudgetManager()
        with pytest.raises(BudgetNotFoundError):
            manager.check_budget("nonexistent", amount=1.0)

    def test_record_spending_reduces_available_budget(self) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=100.0, period="monthly")
        manager.record_spending("llm", amount=30.0)
        result = manager.check_budget("llm", amount=10.0)
        assert abs(result.available - 70.0) < 1e-6

    def test_record_spending_raises_budget_exceeded_error_when_overdraft_disabled(
        self,
    ) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=20.0, period="monthly")
        manager.record_spending("llm", amount=15.0)
        with pytest.raises(BudgetExceededError):
            manager.record_spending("llm", amount=10.0)

    def test_negative_limit_raises_value_error(self) -> None:
        manager = BudgetManager()
        with pytest.raises(ValueError):
            manager.create_budget("llm", limit=-1.0, period="monthly")

    def test_invalid_period_raises_error(self) -> None:
        manager = BudgetManager()
        with pytest.raises(Exception):
            manager.create_budget("llm", limit=100.0, period="annually")

    def test_utilization_is_zero_before_any_spending(self) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=100.0, period="monthly")
        assert manager.get_utilization("llm") == 0.0

    def test_list_categories_returns_all_categories(self) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=100.0, period="monthly")
        manager.create_budget("storage", limit=50.0, period="monthly")
        categories = manager.list_categories()
        assert "llm" in categories
        assert "storage" in categories

    def test_summary_returns_list_of_dicts(self) -> None:
        manager = BudgetManager()
        manager.create_budget("llm", limit=100.0, period="monthly")
        summary = manager.summary()
        assert isinstance(summary, list)
        assert len(summary) == 1
        assert summary[0]["category"] == "llm"


# ---------------------------------------------------------------------------
# TestConsentManager
# ---------------------------------------------------------------------------


class TestConsentManager:
    def test_record_and_check_consent(self) -> None:
        manager = ConsentManager()
        manager.record_consent(
            agent_id="agent-001",
            data_type="user_data",
            purpose="support",
            granted_by="admin",
        )
        result = manager.check_consent("agent-001", "user_data", "support")
        assert result.granted is True

    def test_check_consent_denied_when_no_record_and_default_deny(self) -> None:
        from aumos_governance.config import ConsentConfig

        manager = ConsentManager(config=ConsentConfig(default_deny=True))
        result = manager.check_consent("agent-001", "user_data", "support")
        assert result.granted is False

    def test_check_consent_allowed_when_no_record_and_permissive_mode(self) -> None:
        from aumos_governance.config import ConsentConfig

        manager = ConsentManager(config=ConsentConfig(default_deny=False))
        result = manager.check_consent("agent-001", "user_data", "support")
        assert result.granted is True

    def test_revoke_consent_removes_record(self) -> None:
        from aumos_governance.config import ConsentConfig

        manager = ConsentManager(config=ConsentConfig(default_deny=True))
        manager.record_consent(
            agent_id="agent-001",
            data_type="user_data",
            purpose="support",
            granted_by="admin",
        )
        manager.revoke_consent("agent-001", "user_data", "support")
        result = manager.check_consent("agent-001", "user_data", "support")
        assert result.granted is False

    def test_revoke_consent_raises_when_record_absent(self) -> None:
        manager = ConsentManager()
        with pytest.raises(ConsentNotFoundError):
            manager.revoke_consent("agent-001", "user_data", "support")

    def test_empty_agent_id_raises_value_error(self) -> None:
        manager = ConsentManager()
        with pytest.raises(ValueError, match="agent_id"):
            manager.record_consent(
                agent_id="",
                data_type="user_data",
                purpose=None,
                granted_by="admin",
            )

    def test_blanket_consent_satisfies_specific_purpose(self) -> None:
        from aumos_governance.config import ConsentConfig

        manager = ConsentManager(config=ConsentConfig(default_deny=True))
        manager.record_consent(
            agent_id="agent-001",
            data_type="user_data",
            purpose=None,  # blanket
            granted_by="admin",
        )
        result = manager.check_consent("agent-001", "user_data", "any_purpose")
        assert result.granted is True

    def test_list_consents_returns_all_records_for_agent(self) -> None:
        manager = ConsentManager()
        manager.record_consent("agent-001", "user_data", "support", granted_by="admin")
        manager.record_consent("agent-001", "health_data", "research", granted_by="admin")
        records = manager.list_consents("agent-001")
        data_types = {r.data_type for r in records}
        assert "user_data" in data_types
        assert "health_data" in data_types

    def test_revoke_all_for_agent_returns_count_removed(self) -> None:
        manager = ConsentManager()
        manager.record_consent("agent-001", "user_data", "support", granted_by="admin")
        manager.record_consent("agent-001", "health_data", None, granted_by="admin")
        count = manager.revoke_all_for_agent("agent-001")
        assert count == 2


# ---------------------------------------------------------------------------
# TestGovernanceEngine
# ---------------------------------------------------------------------------


class TestGovernanceEngine:
    def test_simple_action_with_no_checks_is_allowed(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        action = GovernanceAction(agent_id="agent-001")
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is True
        assert decision.outcome == GovernanceOutcome.ALLOW

    def test_trust_check_passes_when_agent_meets_requirement(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        engine.trust.set_level("agent-001", TrustLevel.L3_ACT_APPROVE)
        action = GovernanceAction(
            agent_id="agent-001",
            required_trust_level=TrustLevel.L2_SUGGEST,
        )
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is True

    def test_trust_check_denies_when_agent_below_requirement(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        engine.trust.set_level("agent-001", TrustLevel.L0_OBSERVER)
        action = GovernanceAction(
            agent_id="agent-001",
            required_trust_level=TrustLevel.L3_ACT_APPROVE,
        )
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is False
        assert decision.outcome == GovernanceOutcome.DENY

    def test_budget_check_passes_when_within_limit(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        engine.budget.create_budget("llm", limit=100.0, period="monthly")
        action = GovernanceAction(
            agent_id="agent-001",
            budget_category="llm",
            budget_amount=5.0,
        )
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is True

    def test_budget_check_denies_when_exceeds_limit(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        engine.budget.create_budget("llm", limit=1.0, period="monthly")
        action = GovernanceAction(
            agent_id="agent-001",
            budget_category="llm",
            budget_amount=5.0,
        )
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is False

    def test_consent_check_passes_when_consent_granted(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        engine.consent.record_consent(
            "agent-001", "user_data", "support", granted_by="admin"
        )
        action = GovernanceAction(
            agent_id="agent-001",
            data_type="user_data",
            purpose="support",
        )
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is True

    def test_all_checks_pass_for_well_configured_agent(
        self, engine_with_agent: GovernanceEngine
    ) -> None:
        import asyncio

        action = GovernanceAction(
            agent_id="agent-001",
            required_trust_level=TrustLevel.L2_SUGGEST,
            budget_category="llm",
            budget_amount=5.0,
            data_type="user_data",
            purpose="support",
        )
        decision = asyncio.run(engine_with_agent.evaluate(action))
        assert decision.allowed is True

    def test_decision_has_audit_record_id(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        action = GovernanceAction(agent_id="agent-001")
        decision = asyncio.run(engine.evaluate(action))
        assert isinstance(decision.audit_record_id, str)
        assert len(decision.audit_record_id) > 0

    def test_decision_has_reasons_list(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        engine.trust.set_level("agent-001", TrustLevel.L2_SUGGEST)
        action = GovernanceAction(
            agent_id="agent-001",
            required_trust_level=TrustLevel.L2_SUGGEST,
        )
        decision = asyncio.run(engine.evaluate(action))
        assert isinstance(decision.reasons, list)
        assert len(decision.reasons) > 0

    def test_evaluate_sync_returns_same_result_as_evaluate(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        action = GovernanceAction(agent_id="agent-001")
        async_decision = asyncio.run(engine.evaluate(action))
        sync_decision = engine.evaluate_sync(action)
        assert async_decision.allowed == sync_decision.allowed
        assert async_decision.outcome == sync_decision.outcome

    def test_decision_contains_original_action(
        self, engine: GovernanceEngine
    ) -> None:
        import asyncio

        action = GovernanceAction(
            agent_id="agent-001",
            action_type="tool_call",
            resource="some_tool",
        )
        decision = asyncio.run(engine.evaluate(action))
        assert decision.action.agent_id == "agent-001"
        assert decision.action.action_type == "tool_call"

    def test_trust_check_is_skipped_when_required_level_not_set(
        self, engine: GovernanceEngine
    ) -> None:
        """No trust check = no DENY from trust even for L0 agent."""
        import asyncio

        # agent at L0 (default), no required_trust_level in action
        action = GovernanceAction(agent_id="unknown-agent")
        decision = asyncio.run(engine.evaluate(action))
        assert decision.allowed is True

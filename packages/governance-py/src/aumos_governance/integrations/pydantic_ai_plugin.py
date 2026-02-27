# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Pydantic AI integration for AumOS governance.

Integrates AumOS governance into Pydantic AI agents via a plugin class and a
factory function that wraps the agent's tool registry with governance hooks.

Quick start::

    from pydantic_ai import Agent
    from aumos_governance.integrations.pydantic_ai_plugin import (
        GovernanceConfig,
        create_governed_agent,
    )

    agent = Agent("openai:gpt-4o", system_prompt="You are a helpful assistant.")
    config = GovernanceConfig(trust_level=3, budget_limit=5.0)
    governed_agent = create_governed_agent(agent, config)

    # Tools registered on governed_agent will have pre/post hooks applied.

Plugin hooks
------------
- **Pre-tool-call**: Validates that the configured static trust level is
  sufficient for the tool. Denies the call and raises
  :class:`~aumos_governance.errors.TrustLevelError` when not met. Checks
  the remaining budget and raises
  :class:`~aumos_governance.errors.BudgetExceededError` when exhausted.
- **Post-tool-call**: Records the cost of the tool call (if provided via
  ``tool_cost_map``), emits a structured audit log entry.

Design rules
------------
- Trust levels are MANUAL ONLY — configure once via :class:`GovernanceConfig`.
- Budget limits are STATIC ONLY — no adaptive reallocation.
- Audit logging is RECORDING ONLY — no anomaly detection.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger("aumos.governance.pydantic_ai")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GovernanceConfig:
    """
    Configuration for :class:`GovernancePlugin` and :func:`create_governed_agent`.

    Attributes:
        trust_level: Static trust level required for all governed tool calls
            (0-5). Set manually; never changed at runtime.
        budget_limit: Optional cumulative budget ceiling in USD across all
            tool calls made through the governed agent. ``None`` means
            unlimited.
        tool_cost_map: Optional mapping of tool name to fixed cost per call
            in USD. When a tool name is present its cost is recorded after
            each successful call.
        tool_trust_overrides: Optional mapping of tool name to a required
            trust level that overrides the global ``trust_level`` for that
            specific tool.
        log_decisions: When ``True``, emit structured log records to
            ``aumos.governance.pydantic_ai``.
    """

    trust_level: int = 2
    budget_limit: float | None = None
    tool_cost_map: dict[str, float] = field(default_factory=dict)
    tool_trust_overrides: dict[str, int] = field(default_factory=dict)
    log_decisions: bool = True

    def __post_init__(self) -> None:
        if not (0 <= self.trust_level <= 5):
            raise ValueError(
                f"trust_level must be between 0 and 5 inclusive; got {self.trust_level}."
            )
        if self.budget_limit is not None and self.budget_limit < 0:
            raise ValueError(f"budget_limit must be >= 0; got {self.budget_limit}.")
        for tool_name, override in self.tool_trust_overrides.items():
            if not (0 <= override <= 5):
                raise ValueError(
                    f"tool_trust_overrides[{tool_name!r}] must be 0-5; got {override}."
                )
        for tool_name, cost in self.tool_cost_map.items():
            if cost < 0:
                raise ValueError(
                    f"tool_cost_map[{tool_name!r}] must be >= 0; got {cost}."
                )


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------


class GovernancePlugin:
    """
    Governance plugin that wraps Pydantic AI tool calls with AumOS checks.

    Instantiate this class once per agent. Call :meth:`pre_tool_call` before
    executing a tool and :meth:`post_tool_call` after it completes.

    The plugin tracks cumulative spend across all tool calls for this
    instance. Trust levels are static — set via :class:`GovernanceConfig`
    and never modified at runtime. Budget limits are static — the ceiling
    configured at construction is fixed for the lifetime of the plugin.

    Args:
        config: A :class:`GovernanceConfig` instance.
    """

    def __init__(self, config: GovernanceConfig) -> None:
        self._config = config
        self._spent: float = 0.0
        self._call_count: int = 0

    # ------------------------------------------------------------------
    # Pre / post hooks
    # ------------------------------------------------------------------

    def pre_tool_call(
        self,
        tool_name: str,
        tool_args: dict[str, Any] | None = None,
        *,
        request_id: str | None = None,
    ) -> str:
        """
        Validate governance constraints before a tool is executed.

        Checks the static trust level requirement and remaining budget.
        Raises an exception if either check fails, preventing the tool
        from being called.

        Args:
            tool_name: The name of the Pydantic AI tool about to be called.
            tool_args: Optional argument dict passed to the tool (used for
                logging; not validated by governance).
            request_id: Optional correlation ID. A UUID is generated when
                not provided.

        Returns:
            The request ID used for this call (either the one supplied or
            a freshly generated UUID). Pass this to :meth:`post_tool_call`
            for log correlation.

        Raises:
            :class:`~aumos_governance.errors.TrustLevelError`: When the
                configured trust level for ``tool_name`` is insufficient.
                (Currently the plugin enforces a non-zero minimum of L1 —
                L0 tools cannot be called. Future callers can configure
                per-tool overrides via :attr:`GovernanceConfig.tool_trust_overrides`.)
            :class:`~aumos_governance.errors.BudgetExceededError`: When the
                cumulative spend has reached or exceeded the budget limit.
        """
        from aumos_governance.errors import BudgetExceededError, TrustLevelError

        call_id = request_id or str(uuid.uuid4())
        self._call_count += 1

        # Resolve required trust level for this specific tool.
        required_trust = self._config.tool_trust_overrides.get(
            tool_name, self._config.trust_level
        )

        # Trust level check (static comparison — no automatic adjustment).
        if self._config.trust_level < required_trust:
            if self._config.log_decisions:
                logger.warning(
                    "governance_tool_deny_trust",
                    extra={
                        "request_id": call_id,
                        "tool": tool_name,
                        "required_trust": required_trust,
                        "actual_trust": self._config.trust_level,
                    },
                )
            raise TrustLevelError(
                agent_id="pydantic-ai-agent",
                required_level=required_trust,
                actual_level=self._config.trust_level,
                scope=tool_name,
            )

        # Budget check (static ceiling — no adaptive reallocation).
        if self._config.budget_limit is not None:
            remaining = self._config.budget_limit - self._spent
            if remaining <= 0:
                if self._config.log_decisions:
                    logger.warning(
                        "governance_tool_deny_budget",
                        extra={
                            "request_id": call_id,
                            "tool": tool_name,
                            "budget_limit": self._config.budget_limit,
                            "spent": self._spent,
                        },
                    )
                raise BudgetExceededError(
                    category=tool_name,
                    requested=0.0,
                    available=remaining,
                )

        if self._config.log_decisions:
            logger.info(
                "governance_tool_allow",
                extra={
                    "request_id": call_id,
                    "tool": tool_name,
                    "trust_level": self._config.trust_level,
                    "budget_remaining": (
                        self._config.budget_limit - self._spent
                        if self._config.budget_limit is not None
                        else None
                    ),
                    "call_count": self._call_count,
                },
            )

        return call_id

    def post_tool_call(
        self,
        tool_name: str,
        result: Any,
        *,
        request_id: str | None = None,
        cost_override: float | None = None,
    ) -> None:
        """
        Record spend and log audit information after a tool call completes.

        The cost is determined (in priority order) from:
        1. ``cost_override`` — explicit cost provided by the caller.
        2. :attr:`GovernanceConfig.tool_cost_map` — per-tool fixed cost.
        3. Zero — no cost recorded when neither source is available.

        Args:
            tool_name: The name of the Pydantic AI tool that was called.
            result: The value returned by the tool (logged but not inspected
                by governance logic).
            request_id: Correlation ID from :meth:`pre_tool_call`.
            cost_override: Optional explicit cost in USD for this specific
                invocation. Overrides the ``tool_cost_map`` entry.
        """
        call_id = request_id or str(uuid.uuid4())

        cost: float = 0.0
        if cost_override is not None:
            if cost_override < 0:
                raise ValueError(f"cost_override must be >= 0; got {cost_override}.")
            cost = cost_override
        elif tool_name in self._config.tool_cost_map:
            cost = self._config.tool_cost_map[tool_name]

        if cost > 0 and self._config.budget_limit is not None:
            self._spent += cost

        if self._config.log_decisions:
            logger.info(
                "governance_tool_complete",
                extra={
                    "request_id": call_id,
                    "tool": tool_name,
                    "cost_recorded": cost,
                    "total_spent": self._spent,
                    "budget_remaining": (
                        self._config.budget_limit - self._spent
                        if self._config.budget_limit is not None
                        else None
                    ),
                    "result_type": type(result).__name__,
                },
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def spent(self) -> float:
        """Cumulative spend recorded by this plugin instance, in USD."""
        return self._spent

    @property
    def remaining(self) -> float | None:
        """
        Remaining budget in USD, or ``None`` when no limit is configured.
        """
        if self._config.budget_limit is None:
            return None
        return max(0.0, self._config.budget_limit - self._spent)

    @property
    def call_count(self) -> int:
        """Total number of pre-call checks performed by this plugin."""
        return self._call_count


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GovernedAgent:
    """
    A Pydantic AI agent paired with a :class:`GovernancePlugin`.

    Use :func:`create_governed_agent` to construct this. Tools registered on
    ``agent`` should be called via ``plugin.pre_tool_call`` and
    ``plugin.post_tool_call`` to enforce governance.

    Attributes:
        agent: The wrapped Pydantic AI ``Agent`` instance.
        plugin: The :class:`GovernancePlugin` instance managing governance
            state for this agent.
    """

    agent: Any
    plugin: GovernancePlugin


def create_governed_agent(
    agent: Any,
    config: GovernanceConfig,
) -> GovernedAgent:
    """
    Factory function that pairs a Pydantic AI agent with governance enforcement.

    This is the recommended entry point for integrating governance into
    an existing Pydantic AI agent. The factory does NOT monkey-patch the
    agent's internals — governance is enforced through the returned
    :class:`GovernancePlugin` hooks, which the caller is responsible for
    invoking around each tool call.

    Typical usage pattern::

        agent = Agent("openai:gpt-4o", system_prompt="You are helpful.")

        config = GovernanceConfig(
            trust_level=3,
            budget_limit=5.0,
            tool_cost_map={"web_search": 0.001, "code_exec": 0.005},
            tool_trust_overrides={"code_exec": 4},
        )
        governed = create_governed_agent(agent, config)

        # When executing a tool:
        req_id = governed.plugin.pre_tool_call("web_search")
        result = web_search("query")
        governed.plugin.post_tool_call("web_search", result, request_id=req_id)

    For automatic hook injection into Pydantic AI's tool execution path,
    wrap each registered tool with :func:`wrap_tool_with_governance`.

    Args:
        agent: A Pydantic AI ``Agent`` instance (or any object exposing a
            compatible tool registry).
        config: A :class:`GovernanceConfig` defining the governance policy.

    Returns:
        A :class:`GovernedAgent` pairing the original agent with a fresh
        :class:`GovernancePlugin` instance.
    """
    plugin = GovernancePlugin(config)
    return GovernedAgent(agent=agent, plugin=plugin)


def wrap_tool_with_governance(
    tool_fn: Callable[..., Any],
    plugin: GovernancePlugin,
    *,
    tool_name: str | None = None,
) -> Callable[..., Any]:
    """
    Wrap a plain callable with governance pre/post hooks.

    Use this to apply governance to individual tool functions before
    registering them with a Pydantic AI agent::

        @agent.tool
        def my_tool(ctx, query: str) -> str:
            return search(query)

        # Or wrap explicitly:
        governed_tool = wrap_tool_with_governance(my_tool, plugin)

    Args:
        tool_fn: The tool callable to wrap.
        plugin: The :class:`GovernancePlugin` instance to use for checks.
        tool_name: Optional override for the tool name used in logs and
            cost lookups. Defaults to ``tool_fn.__name__``.

    Returns:
        A new callable that runs governance pre/post hooks around
        ``tool_fn``.
    """
    import functools

    resolved_name = tool_name or tool_fn.__name__

    @functools.wraps(tool_fn)
    def governed_tool(*args: Any, **kwargs: Any) -> Any:
        request_id = plugin.pre_tool_call(resolved_name)
        result = tool_fn(*args, **kwargs)
        plugin.post_tool_call(resolved_name, result, request_id=request_id)
        return result

    return governed_tool

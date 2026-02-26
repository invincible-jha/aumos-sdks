# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import datetime, timezone

from aumos_governance.config import TrustConfig
from aumos_governance.errors import TrustLevelError
from aumos_governance.trust.decay import calculate_decay
from aumos_governance.trust.validator import TrustCheckResult, validate_trust
from aumos_governance.types import TrustLevel


class _TrustEntry:
    """Internal storage for a single agent's trust assignment."""

    __slots__ = ("level", "scope", "assigned_at", "last_active", "assigned_by")

    def __init__(
        self,
        level: TrustLevel,
        scope: str | None,
        assigned_by: str | None,
    ) -> None:
        now = datetime.now(tz=timezone.utc)
        self.level = level
        self.scope = scope
        self.assigned_at = now
        self.last_active = now
        self.assigned_by = assigned_by


class SetLevelOptions:
    """
    Optional parameters for :meth:`TrustManager.set_level`.

    Attributes:
        assigned_by: Human-readable identifier of who or what is assigning
            this trust level (e.g. an admin user ID or an orchestrator name).
            Stored for audit purposes.
        force: When True, allows setting a lower level than the current one
            without raising an error (downgrade is always allowed by default,
            but this flag makes the intent explicit in code).
    """

    __slots__ = ("assigned_by", "force")

    def __init__(
        self,
        assigned_by: str | None = None,
        force: bool = False,
    ) -> None:
        self.assigned_by = assigned_by
        self.force = force


class TrustManager:
    """
    Manages trust level assignments for agents.

    Trust levels are ALWAYS assigned manually via :meth:`set_level`.
    There is no automatic promotion, scoring, or adaptive mechanism.

    All data is stored in-memory. A new TrustManager starts empty;
    unknown agents receive :attr:`~TrustConfig.default_level`.

    Example::

        manager = TrustManager(TrustConfig(default_level=1))
        manager.set_level("agent-42", TrustLevel.L3_ACT_APPROVE)
        result = manager.check_level("agent-42", TrustLevel.L2_SUGGEST)
        assert result.allowed is True
    """

    def __init__(self, config: TrustConfig | None = None) -> None:
        self._config = config or TrustConfig()
        # Keyed by (agent_id, scope). scope=None means global.
        self._store: dict[tuple[str, str | None], _TrustEntry] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_level(
        self,
        agent_id: str,
        level: TrustLevel,
        scope: str | None = None,
        options: SetLevelOptions | None = None,
    ) -> None:
        """
        Manually assign a trust level to an agent.

        This is the ONLY way trust levels change in the SDK. There is no
        automatic promotion pathway.

        Args:
            agent_id: Unique identifier of the agent.
            level: The :class:`~aumos_governance.types.TrustLevel` to assign.
            scope: Optional scope string. When provided, this assignment
                applies only within that scope; a global (scope=None)
                assignment is also retained independently.
            options: Optional :class:`SetLevelOptions` controlling metadata.

        Raises:
            ValueError: If ``agent_id`` is an empty string.
        """
        if not agent_id:
            raise ValueError("agent_id must be a non-empty string.")

        opts = options or SetLevelOptions()
        key = (agent_id, scope)

        if key in self._store:
            entry = self._store[key]
            entry.level = level
            entry.assigned_by = opts.assigned_by
            entry.assigned_at = datetime.now(tz=timezone.utc)
        else:
            self._store[key] = _TrustEntry(
                level=level,
                scope=scope,
                assigned_by=opts.assigned_by,
            )

    def get_level(
        self,
        agent_id: str,
        scope: str | None = None,
    ) -> TrustLevel:
        """
        Return the effective trust level for an agent.

        Lookup order:
        1. Scoped assignment (``scope`` provided and found).
        2. Global assignment (``scope=None``).
        3. :attr:`~TrustConfig.default_level` from config.

        If :attr:`~TrustConfig.enable_decay` is True, time-based decay is
        applied before returning the level.

        Args:
            agent_id: Unique identifier of the agent.
            scope: Optional scope to narrow the lookup.

        Returns:
            The effective :class:`~aumos_governance.types.TrustLevel`.
        """
        entry = self._resolve_entry(agent_id, scope)

        if entry is None:
            return TrustLevel(self._config.default_level)

        raw_level = entry.level
        if not self._config.enable_decay:
            return raw_level

        decay_result = calculate_decay(
            current_level=raw_level,
            last_active=entry.last_active,
            cliff_days=self._config.decay_cliff_days,
            gradual_days=self._config.decay_gradual_days,
        )
        return decay_result.effective_level

    def check_level(
        self,
        agent_id: str,
        required_level: TrustLevel,
        scope: str | None = None,
    ) -> TrustCheckResult:
        """
        Check whether an agent meets a required trust level.

        Does NOT raise on failure — callers can inspect
        :attr:`~TrustCheckResult.allowed` and decide how to proceed,
        or call :meth:`require_level` if they want an exception.

        Args:
            agent_id: Unique identifier of the agent.
            required_level: Minimum required trust level.
            scope: Optional scope for the check.

        Returns:
            A :class:`~aumos_governance.trust.validator.TrustCheckResult`.
        """
        actual = self.get_level(agent_id, scope)
        return validate_trust(
            agent_id=agent_id,
            required_level=required_level,
            actual_level=actual,
            scope=scope,
        )

    def require_level(
        self,
        agent_id: str,
        required_level: TrustLevel,
        scope: str | None = None,
    ) -> None:
        """
        Assert that an agent meets a required trust level.

        Identical to :meth:`check_level` but raises
        :class:`~aumos_governance.errors.TrustLevelError` on failure.

        Args:
            agent_id: Unique identifier of the agent.
            required_level: Minimum required trust level.
            scope: Optional scope for the check.

        Raises:
            TrustLevelError: If the agent's effective level is below
                ``required_level``.
        """
        result = self.check_level(agent_id, required_level, scope)
        if not result.allowed:
            raise TrustLevelError(
                agent_id=agent_id,
                required_level=int(required_level),
                actual_level=int(result.actual_level),
                scope=scope,
            )

    def touch(self, agent_id: str, scope: str | None = None) -> None:
        """
        Update the ``last_active`` timestamp for an agent.

        Call this whenever an agent successfully performs an action so that
        decay timers reset appropriately.

        Args:
            agent_id: Unique identifier of the agent.
            scope: Optional scope to update. If both a scoped and a global
                entry exist, both are updated.
        """
        now = datetime.now(tz=timezone.utc)
        keys_to_touch: list[tuple[str, str | None]] = []

        if scope is not None:
            keys_to_touch.append((agent_id, scope))
        # Always touch global entry too when a scoped touch occurs.
        keys_to_touch.append((agent_id, None))

        for key in keys_to_touch:
            if key in self._store:
                self._store[key].last_active = now

    def remove(self, agent_id: str, scope: str | None = None) -> bool:
        """
        Remove a trust assignment for an agent.

        Args:
            agent_id: Unique identifier of the agent.
            scope: If provided, removes only the scoped entry. If None,
                removes only the global entry.

        Returns:
            True if an entry was removed, False if no entry existed.
        """
        key = (agent_id, scope)
        if key in self._store:
            del self._store[key]
            return True
        return False

    def list_agents(self) -> list[str]:
        """
        Return a deduplicated list of all agent IDs with stored assignments.

        Returns:
            List of agent ID strings in insertion order (deduplicated).
        """
        seen: set[str] = set()
        result: list[str] = []
        for agent_id, _ in self._store:
            if agent_id not in seen:
                seen.add(agent_id)
                result.append(agent_id)
        return result

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _resolve_entry(
        self,
        agent_id: str,
        scope: str | None,
    ) -> _TrustEntry | None:
        """Return the most specific trust entry for the given agent+scope."""
        if scope is not None:
            scoped_key = (agent_id, scope)
            if scoped_key in self._store:
                return self._store[scoped_key]
        global_key = (agent_id, None)
        return self._store.get(global_key)

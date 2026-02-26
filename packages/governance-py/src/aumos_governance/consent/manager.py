# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from aumos_governance.config import ConsentConfig
from aumos_governance.consent.store import ConsentRecord, ConsentStore
from aumos_governance.errors import ConsentNotFoundError


class ConsentCheckResult(BaseModel, frozen=True):
    """
    Result of a consent check.

    Attributes:
        granted: True if valid consent exists for the request.
        agent_id: The agent that was checked.
        data_type: The data type that was checked.
        purpose: The purpose that was checked (may be None).
        reason: Human-readable explanation of the outcome.
        record: The matching :class:`~aumos_governance.consent.store.ConsentRecord`
            if consent was granted, else None.
    """

    granted: bool
    agent_id: str
    data_type: str
    purpose: str | None = None
    reason: str
    record: ConsentRecord | None = None


class ConsentManager:
    """
    Manages consent records for agent data access.

    Consent is always recorded explicitly by a human or trusted orchestrator.
    There is no proactive consent suggestion or inference.

    All data is stored in-memory. A new ConsentManager starts empty.

    Example::

        manager = ConsentManager()
        manager.record_consent(
            agent_id="agent-42",
            data_type="user_profile",
            purpose="personalisation",
            granted_by="admin@example.com",
        )
        result = manager.check_consent("agent-42", "user_profile", "personalisation")
        assert result.granted is True
    """

    def __init__(self, config: ConsentConfig | None = None) -> None:
        self._config = config or ConsentConfig()
        self._store = ConsentStore()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record_consent(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None,
        granted_by: str,
        expires_at: datetime | None = None,
    ) -> ConsentRecord:
        """
        Record explicit consent for an agent to access a data type.

        If a consent record for the same (agent_id, data_type, purpose)
        already exists it is replaced.

        Args:
            agent_id: The agent being granted access.
            data_type: The category of data being consented to.
            purpose: Optional purpose string further scoping the consent.
                Pass None to record blanket consent for all purposes.
            granted_by: Identifier of the human or system granting consent.
            expires_at: Optional UTC datetime after which consent expires.
                When None, consent does not expire automatically.

        Returns:
            The created :class:`~aumos_governance.consent.store.ConsentRecord`.

        Raises:
            ValueError: If ``agent_id``, ``data_type``, or ``granted_by``
                is an empty string.
        """
        if not agent_id:
            raise ValueError("agent_id must be a non-empty string.")
        if not data_type:
            raise ValueError("data_type must be a non-empty string.")
        if not granted_by:
            raise ValueError("granted_by must be a non-empty string.")

        record = ConsentRecord(
            agent_id=agent_id,
            data_type=data_type,
            purpose=purpose,
            granted_by=granted_by,
            expires_at=expires_at,
        )
        self._store.put(record)
        return record

    def check_consent(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> ConsentCheckResult:
        """
        Check whether consent has been granted for a data access request.

        This is a read-only operation — it does not modify state.

        Args:
            agent_id: The agent requesting access.
            data_type: The type of data being accessed.
            purpose: The purpose for which access is needed.
                A blanket consent record (purpose=None) satisfies any
                purpose check.

        Returns:
            A :class:`ConsentCheckResult` describing the outcome.
        """
        record = self._store.find(
            agent_id=agent_id,
            data_type=data_type,
            purpose=purpose,
        )

        if record is not None:
            purpose_text = f" for purpose '{purpose}'" if purpose else ""
            return ConsentCheckResult(
                granted=True,
                agent_id=agent_id,
                data_type=data_type,
                purpose=purpose,
                reason=(
                    f"Consent granted for agent '{agent_id}' to access "
                    f"'{data_type}'{purpose_text} (granted by '{record.granted_by}')."
                ),
                record=record,
            )

        # No valid consent record found.
        if self._config.default_deny:
            purpose_text = f" for purpose '{purpose}'" if purpose else ""
            return ConsentCheckResult(
                granted=False,
                agent_id=agent_id,
                data_type=data_type,
                purpose=purpose,
                reason=(
                    f"No valid consent record found for agent '{agent_id}' "
                    f"accessing '{data_type}'{purpose_text}. "
                    "Defaulting to deny."
                ),
                record=None,
            )

        # Permissive mode — absence of a record means allow.
        purpose_text = f" for purpose '{purpose}'" if purpose else ""
        return ConsentCheckResult(
            granted=True,
            agent_id=agent_id,
            data_type=data_type,
            purpose=purpose,
            reason=(
                f"No explicit consent record for agent '{agent_id}' "
                f"accessing '{data_type}'{purpose_text}; "
                "permissive mode allows by default."
            ),
            record=None,
        )

    def revoke_consent(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> None:
        """
        Revoke a consent record.

        Args:
            agent_id: The agent whose consent is being revoked.
            data_type: The data type for which consent is revoked.
            purpose: The purpose to revoke. Use None to revoke the blanket
                consent record (purpose=None). To revoke ALL records for an
                agent, call :meth:`revoke_all_for_agent`.

        Raises:
            ConsentNotFoundError: If no matching record exists to revoke.
        """
        removed = self._store.remove(
            agent_id=agent_id,
            data_type=data_type,
            purpose=purpose,
        )
        if not removed:
            raise ConsentNotFoundError(
                agent_id=agent_id,
                data_type=data_type,
                purpose=purpose,
            )

    def revoke_all_for_agent(self, agent_id: str) -> int:
        """
        Revoke all consent records for an agent.

        Args:
            agent_id: The agent whose records should all be removed.

        Returns:
            The number of records revoked.
        """
        return self._store.remove_all_for_agent(agent_id)

    def list_consents(self, agent_id: str) -> list[ConsentRecord]:
        """
        Return all consent records for an agent.

        Both active and expired records are returned. Use
        :meth:`~aumos_governance.consent.store.ConsentRecord.is_expired`
        to filter if needed.

        Args:
            agent_id: The agent ID to query.

        Returns:
            List of :class:`~aumos_governance.consent.store.ConsentRecord` objects.
        """
        return self._store.list_for_agent(agent_id)

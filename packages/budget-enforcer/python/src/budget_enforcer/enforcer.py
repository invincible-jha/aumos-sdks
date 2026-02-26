# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

from uuid import uuid4

from budget_enforcer.envelope import (
    available_balance,
    create_envelope,
    refresh_envelope_period,
)
from budget_enforcer.query import build_utilization
from budget_enforcer.storage.interface import BudgetStorage
from budget_enforcer.storage.memory import MemoryStorage
from budget_enforcer.transaction import build_transaction, filter_transactions
from budget_enforcer.types import (
    BudgetCheckResult,
    BudgetEnforcerConfig,
    BudgetUtilization,
    CheckReason,
    CommitResult,
    EnvelopeConfig,
    PendingCommit,
    SpendingEnvelope,
    Transaction,
    TransactionFilter,
)


class BudgetEnforcer:
    """
    Economic governance gate for AI agent spending.

    Design contract
    ---------------
    - Limits are STATIC. Only the caller sets them; this class never adjusts them.
    - ``check()`` is read-only. It does not record a transaction or modify state.
    - ``record()`` deducts from the envelope. Call it only after the operation
      completes successfully.
    - ``commit()`` pre-authorises an amount, reducing available without touching
      spent. Release with ``release()`` if the operation is cancelled.
    - Period reset is automatic and happens on the first access after a window
      expires.

    Usage
    -----
    ::

        enforcer = BudgetEnforcer()
        enforcer.create_envelope(EnvelopeConfig(category="llm-calls", limit=10.0, period="daily"))

        result = enforcer.check("llm-calls", 0.05)
        if result.permitted:
            response = call_llm(prompt)
            enforcer.record("llm-calls", 0.05, description="gpt-4o summary")
    """

    def __init__(
        self,
        config: BudgetEnforcerConfig | None = None,
        storage: BudgetStorage | None = None,
    ) -> None:
        self._config = BudgetEnforcerConfig.model_validate(config.model_dump() if config else {})
        self._storage: BudgetStorage = storage if storage is not None else MemoryStorage()

        # Hot-path in-memory mirrors — kept in sync with storage on every write.
        self._envelopes: dict[str, SpendingEnvelope] = {}          # id -> envelope
        self._envelopes_by_category: dict[str, str] = {}           # category -> id
        self._transactions: list[Transaction] = []
        self._commits: dict[str, tuple[str, float]] = {}           # commit_id -> (category, amount)

    # ─── Envelope management ──────────────────────────────────────────────────

    def create_envelope(self, config: EnvelopeConfig) -> SpendingEnvelope:
        """
        Create a spending envelope (a budget limit for a category + period).
        Overwrites any existing envelope for the same category.
        """
        envelope = create_envelope(config)

        self._envelopes[envelope.id] = envelope
        self._envelopes_by_category[envelope.category] = envelope.id
        self._storage.save_envelope(envelope)

        return envelope.model_copy(deep=True)

    def suspend_envelope(self, category: str) -> None:
        """Suspend an envelope — all checks return 'suspended' until resumed."""
        envelope = self._require_envelope(category)
        envelope.suspended = True
        self._storage.save_envelope(envelope)

    def resume_envelope(self, category: str) -> None:
        """Resume a previously suspended envelope."""
        envelope = self._require_envelope(category)
        envelope.suspended = False
        self._storage.save_envelope(envelope)

    # ─── Check ────────────────────────────────────────────────────────────────

    def check(self, category: str, amount: float) -> BudgetCheckResult:
        """
        Check whether a transaction is within budget.

        This method is PURELY READ-ONLY. It does not record a transaction,
        does not modify ``spent``, and does not create a commit. The caller
        is responsible for deciding whether to proceed and then calling
        ``record()`` once the operation completes.
        """
        envelope = self._get_envelope_by_category(category)

        if envelope is None:
            return BudgetCheckResult(
                permitted=False,
                available=0.0,
                requested=amount,
                limit=0.0,
                spent=0.0,
                committed=0.0,
                reason="no_envelope",
            )

        self._refresh_period(envelope)

        if envelope.suspended:
            return BudgetCheckResult(
                permitted=False,
                available=0.0,
                requested=amount,
                limit=envelope.limit,
                spent=envelope.spent,
                committed=envelope.committed,
                reason="suspended",
            )

        available = available_balance(envelope)
        permitted = amount <= available

        return BudgetCheckResult(
            permitted=permitted,
            available=available,
            requested=amount,
            limit=envelope.limit,
            spent=envelope.spent,
            committed=envelope.committed,
            reason="within_budget" if permitted else "exceeds_budget",
        )

    # ─── Record ───────────────────────────────────────────────────────────────

    def record(
        self,
        category: str,
        amount: float,
        description: str | None = None,
    ) -> Transaction:
        """
        Record a completed transaction and deduct its amount from the envelope.

        Call this AFTER the underlying operation has succeeded. If you need to
        reserve capacity before the operation runs, use ``commit()`` instead and
        then call ``record()`` with the actual amount once done.

        Raises KeyError if the category has no envelope.
        """
        envelope = self._require_envelope(category)
        self._refresh_period(envelope)

        transaction = build_transaction(
            category=category,
            amount=amount,
            description=description,
            envelope_id=envelope.id,
        )

        envelope.spent += amount
        self._storage.save_envelope(envelope)
        self._storage.save_transaction(transaction)
        self._transactions.append(transaction)

        return transaction.model_copy(deep=True)

    # ─── Commit / Release ─────────────────────────────────────────────────────

    def commit(self, category: str, amount: float) -> CommitResult:
        """
        Pre-authorise an amount against the envelope.

        The committed amount reduces ``available`` immediately but does not
        increase ``spent``. Use this to hold capacity for an in-flight
        operation. Call ``record()`` with the actual cost on completion, and
        ``release()`` if the operation is cancelled before executing.
        """
        check_result = self.check(category, amount)

        if not check_result.permitted:
            return CommitResult(
                permitted=False,
                commit_id=None,
                available=check_result.available,
                requested=amount,
                reason=check_result.reason,
            )

        commit_id = str(uuid4())
        envelope = self._get_envelope_by_category(category)
        assert envelope is not None  # guaranteed by check() returning permitted

        envelope.committed += amount
        self._commits[commit_id] = (category, amount)

        self._storage.save_envelope(envelope)
        self._storage.save_commit(
            PendingCommit(id=commit_id, category=category, amount=amount)
        )

        return CommitResult(
            permitted=True,
            commit_id=commit_id,
            available=available_balance(envelope),
            requested=amount,
            reason="within_budget",
        )

    def release(self, commit_id: str) -> None:
        """
        Release a previously committed amount back to available.

        Use this when a pre-authorised operation is cancelled or fails before
        any actual spending occurs. If spending did occur, call ``record()``
        with the actual amount instead of (or in addition to) ``release()``.
        """
        commit_entry = self._commits.get(commit_id)
        if commit_entry is None:
            return

        category, amount = commit_entry
        envelope = self._get_envelope_by_category(category)
        if envelope is not None:
            envelope.committed = max(0.0, envelope.committed - amount)
            self._storage.save_envelope(envelope)

        del self._commits[commit_id]
        self._storage.delete_commit(commit_id)

    # ─── Queries ──────────────────────────────────────────────────────────────

    def utilization(self, category: str) -> BudgetUtilization:
        """
        Return a point-in-time utilization snapshot for one category.
        Raises KeyError if no envelope exists for the category.
        """
        envelope = self._require_envelope(category)
        self._refresh_period(envelope)
        return build_utilization(envelope)

    def list_envelopes(self) -> list[SpendingEnvelope]:
        """Return all envelopes (deep copies — mutation has no effect)."""
        return [envelope.model_copy(deep=True) for envelope in self._envelopes.values()]

    def get_transactions(
        self,
        transaction_filter: TransactionFilter | None = None,
    ) -> list[Transaction]:
        """
        Return transaction history, optionally filtered.

        All filter fields are AND-ed together. Pass None to return all records.
        """
        return filter_transactions(self._transactions, transaction_filter)

    # ─── Private helpers ──────────────────────────────────────────────────────

    def _get_envelope_by_category(self, category: str) -> SpendingEnvelope | None:
        envelope_id = self._envelopes_by_category.get(category)
        if envelope_id is None:
            return None
        return self._envelopes.get(envelope_id)

    def _require_envelope(self, category: str) -> SpendingEnvelope:
        envelope = self._get_envelope_by_category(category)
        if envelope is None:
            raise KeyError(
                f"No spending envelope found for category {category!r}. "
                "Call create_envelope() before recording transactions."
            )
        return envelope

    def _refresh_period(self, envelope: SpendingEnvelope) -> None:
        """
        Reset the envelope's period accumulators if the current window has
        elapsed. Mutates the in-memory envelope and persists the update.
        """
        period_start_before = envelope.period_start
        refresh_envelope_period(envelope)
        if envelope.period_start != period_start_before:
            self._storage.save_envelope(envelope)

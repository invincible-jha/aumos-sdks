# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

from budget_enforcer.storage.interface import BudgetStorage
from budget_enforcer.types import PendingCommit, SpendingEnvelope, Transaction


class MemoryStorage(BudgetStorage):
    """
    In-process memory store — suitable for single-agent processes and testing.

    All state is lost when the process exits. For durable enforcement across
    restarts, provide a persistent BudgetStorage implementation.
    """

    def __init__(self) -> None:
        self._envelopes_by_id: dict[str, SpendingEnvelope] = {}
        self._category_to_id: dict[str, str] = {}
        self._transactions: list[Transaction] = []
        self._commits: dict[str, PendingCommit] = {}

    # ─── Envelopes ────────────────────────────────────────────────────────────

    def get_envelope(self, envelope_id: str) -> SpendingEnvelope | None:
        return self._envelopes_by_id.get(envelope_id)

    def get_envelope_by_category(self, category: str) -> SpendingEnvelope | None:
        envelope_id = self._category_to_id.get(category)
        if envelope_id is None:
            return None
        return self._envelopes_by_id.get(envelope_id)

    def save_envelope(self, envelope: SpendingEnvelope) -> None:
        self._envelopes_by_id[envelope.id] = envelope.model_copy(deep=True)
        self._category_to_id[envelope.category] = envelope.id

    def list_envelopes(self) -> list[SpendingEnvelope]:
        return [envelope.model_copy(deep=True) for envelope in self._envelopes_by_id.values()]

    # ─── Transactions ─────────────────────────────────────────────────────────

    def save_transaction(self, transaction: Transaction) -> None:
        self._transactions.append(transaction.model_copy(deep=True))

    def list_transactions(self) -> list[Transaction]:
        return [transaction.model_copy(deep=True) for transaction in self._transactions]

    # ─── Pending commits ──────────────────────────────────────────────────────

    def save_commit(self, commit: PendingCommit) -> None:
        self._commits[commit.id] = commit.model_copy(deep=True)

    def get_commit(self, commit_id: str) -> PendingCommit | None:
        return self._commits.get(commit_id)

    def delete_commit(self, commit_id: str) -> None:
        self._commits.pop(commit_id, None)

    def list_commits(self) -> list[PendingCommit]:
        return [commit.model_copy(deep=True) for commit in self._commits.values()]

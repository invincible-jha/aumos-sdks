# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

from abc import ABC, abstractmethod

from budget_enforcer.types import PendingCommit, SpendingEnvelope, Transaction


class BudgetStorage(ABC):
    """
    Minimal persistence contract for the budget enforcer.

    Implementors may back this with Redis, SQLite, Postgres, or any key-value
    store. The default MemoryStorage is suitable for single-process use and
    testing only — state is lost when the process exits.
    """

    # ─── Envelopes ────────────────────────────────────────────────────────────

    @abstractmethod
    def get_envelope(self, envelope_id: str) -> SpendingEnvelope | None:
        ...

    @abstractmethod
    def get_envelope_by_category(self, category: str) -> SpendingEnvelope | None:
        ...

    @abstractmethod
    def save_envelope(self, envelope: SpendingEnvelope) -> None:
        ...

    @abstractmethod
    def list_envelopes(self) -> list[SpendingEnvelope]:
        ...

    # ─── Transactions ─────────────────────────────────────────────────────────

    @abstractmethod
    def save_transaction(self, transaction: Transaction) -> None:
        ...

    @abstractmethod
    def list_transactions(self) -> list[Transaction]:
        ...

    # ─── Pending commits ──────────────────────────────────────────────────────

    @abstractmethod
    def save_commit(self, commit: PendingCommit) -> None:
        ...

    @abstractmethod
    def get_commit(self, commit_id: str) -> PendingCommit | None:
        ...

    @abstractmethod
    def delete_commit(self, commit_id: str) -> None:
        ...

    @abstractmethod
    def list_commits(self) -> list[PendingCommit]:
        ...

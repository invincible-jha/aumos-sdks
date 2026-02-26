# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import ValidationError

from budget_enforcer.types import Transaction, TransactionFilter


def build_transaction(
    category: str,
    amount: float,
    description: str | None = None,
    envelope_id: str | None = None,
) -> Transaction:
    """
    Build a validated Transaction record with a stable UUID and current timestamp.

    Raises ValueError if amount is not positive.
    """
    if amount <= 0:
        raise ValueError(f"Transaction amount must be positive, got {amount!r}")

    return Transaction(
        id=str(uuid4()),
        category=category,
        amount=amount,
        description=description,
        timestamp=datetime.now(tz=timezone.utc),
        envelope_id=envelope_id,
    )


def filter_transactions(
    transactions: list[Transaction],
    transaction_filter: TransactionFilter | None,
) -> list[Transaction]:
    """
    Apply an optional TransactionFilter to a list of transactions.
    All filter fields are AND-ed together.
    Returns a new list — the input is not modified.
    """
    if transaction_filter is None:
        return list(transactions)

    results: list[Transaction] = []
    for transaction in transactions:
        if (
            transaction_filter.category is not None
            and transaction.category != transaction_filter.category
        ):
            continue

        tx_time = transaction.timestamp
        if tx_time.tzinfo is None:
            tx_time = tx_time.replace(tzinfo=timezone.utc)

        if transaction_filter.since is not None:
            since = transaction_filter.since
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            if tx_time < since:
                continue

        if transaction_filter.until is not None:
            until = transaction_filter.until
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if tx_time > until:
                continue

        if (
            transaction_filter.min_amount is not None
            and transaction.amount < transaction_filter.min_amount
        ):
            continue

        if (
            transaction_filter.max_amount is not None
            and transaction.amount > transaction_filter.max_amount
        ):
            continue

        results.append(transaction)

    return results

# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Append-only file storage backend.

Records are stored one JSON object per line (NDJSON / JSON Lines format).
The file is opened in append mode on construction and never truncated or
rewritten — callers relying on immutability should secure the file with
OS-level permissions (e.g., chown root + chmod 444 after rotation).

Reading always parses the entire file from disk so that the in-process view
stays consistent with anything written by concurrent processes.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import aiofiles
import aiofiles.os

from audit_trail.storage.interface import AuditStorage
from audit_trail.types import AuditFilter, AuditRecord


def _apply_filter(records: list[AuditRecord], audit_filter: AuditFilter) -> list[AuditRecord]:
    results: list[AuditRecord] = list(records)

    if audit_filter.agent_id is not None:
        agent_id = audit_filter.agent_id
        results = [r for r in results if r.agent_id == agent_id]

    if audit_filter.action is not None:
        action = audit_filter.action
        results = [r for r in results if r.action == action]

    if audit_filter.permitted is not None:
        permitted = audit_filter.permitted
        results = [r for r in results if r.permitted == permitted]

    if audit_filter.start_time is not None:
        start_time = audit_filter.start_time
        results = [r for r in results if r.timestamp >= start_time]

    if audit_filter.end_time is not None:
        end_time = audit_filter.end_time
        results = [r for r in results if r.timestamp <= end_time]

    offset = audit_filter.offset or 0
    results = results[offset:]

    if audit_filter.limit is not None:
        results = results[: audit_filter.limit]

    return results


class FileStorage(AuditStorage):
    """
    Persistent, append-only NDJSON file storage backend.

    Parameters
    ----------
    file_path:
        Path to the NDJSON file.  The file is created if it does not exist.
    """

    def __init__(self, file_path: str | Path) -> None:
        self._file_path = Path(file_path)

    async def append(self, record: AuditRecord) -> None:
        # model_dump with mode="json" ensures all values are JSON-serialisable.
        line = json.dumps(record.model_dump(mode="json", exclude_none=False)) + "\n"
        async with aiofiles.open(self._file_path, mode="a", encoding="utf-8") as file_handle:
            await file_handle.write(line)

    async def query(self, audit_filter: AuditFilter) -> list[AuditRecord]:
        all_records = await self.all()
        return _apply_filter(all_records, audit_filter)

    async def all(self) -> list[AuditRecord]:
        if not self._file_path.exists():
            return []

        records: list[AuditRecord] = []
        async with aiofiles.open(self._file_path, mode="r", encoding="utf-8") as file_handle:
            async for line in file_handle:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    data = json.loads(stripped)
                    records.append(AuditRecord.model_validate(data))
                except (json.JSONDecodeError, Exception):
                    # Malformed lines are skipped — the hash chain verifier
                    # will detect any gaps caused by corruption.
                    pass

        return records

    async def count(self) -> int:
        all_records = await self.all()
        return len(all_records)

    @staticmethod
    def read_last_line_sync(file_path: str | Path) -> str | None:
        """
        Read the last non-empty line of the file synchronously.

        Used during construction to restore the chain's last hash without
        loading the full record set into memory.
        """
        path = Path(file_path)
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as file_handle:
            lines = [line.strip() for line in file_handle if line.strip()]
        return lines[-1] if lines else None

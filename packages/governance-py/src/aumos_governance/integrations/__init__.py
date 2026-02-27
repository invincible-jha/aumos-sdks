# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Third-party framework integrations for aumos-governance.

Each sub-module integrates AumOS governance enforcement into a different
Python framework or LLM client library:

- :mod:`~aumos_governance.integrations.anthropic_wrapper` — Wrapper around
  ``anthropic.Anthropic`` with pre-call trust, budget, and audit checks
  on ``messages.create()`` and the legacy ``completions.create()`` surface.
- :mod:`~aumos_governance.integrations.django_middleware` — Django WSGI/ASGI
  middleware that attaches governance context to every request.
- :mod:`~aumos_governance.integrations.litellm_wrapper` — Wrapper around
  LiteLLM's ``completion`` / ``acompletion`` APIs with pre-call budget checks
  and post-call cost recording.
- :mod:`~aumos_governance.integrations.openai_wrapper` — Wrapper around
  ``openai.OpenAI`` with pre-call trust, budget, and audit checks on
  ``chat.completions.create()`` and ``embeddings.create()``.
- :mod:`~aumos_governance.integrations.pydantic_ai_plugin` — Plugin and factory
  for Pydantic AI agents with per-tool trust level validation and cost logging.

All integrations share the same design rules:

- Trust levels are MANUAL ONLY — no automatic changes at runtime.
- Budget limits are STATIC ONLY — no adaptive reallocation.
- Audit logging is RECORDING ONLY — no anomaly detection.
"""
from __future__ import annotations

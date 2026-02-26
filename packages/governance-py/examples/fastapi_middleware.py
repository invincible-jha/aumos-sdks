# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
FastAPI middleware example.

Shows how to integrate aumos-governance into a FastAPI application as
request-level middleware that gates tool-execution endpoints behind
trust, budget, and consent checks.

Run with (requires fastapi + uvicorn installed):
    pip install fastapi uvicorn
    uvicorn examples.fastapi_middleware:app --reload
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

# FastAPI is an optional dependency — guard the import so the file can be
# syntax-checked without it installed.
try:
    from fastapi import Depends, FastAPI, HTTPException, Request, status
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel as FastAPIModel

    _FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    _FASTAPI_AVAILABLE = False

from aumos_governance import (
    GovernanceAction,
    GovernanceEngine,
    TrustLevel,
)
from aumos_governance.config import GovernanceConfig

# ---------------------------------------------------------------------------
# Application-level engine singleton
# ---------------------------------------------------------------------------

_engine: GovernanceEngine | None = None


def get_engine() -> GovernanceEngine:
    """Dependency that returns the application-level GovernanceEngine."""
    assert _engine is not None, "Engine not initialised"  # noqa: S101
    return _engine


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

if _FASTAPI_AVAILABLE:

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Bootstrap governance resources on startup."""
        global _engine  # noqa: PLW0603
        _engine = GovernanceEngine(config=GovernanceConfig())

        # Seed trust and budget for demonstration purposes.
        _engine.trust.set_level("agent-demo", TrustLevel.L3_ACT_APPROVE)
        _engine.budget.create_budget("api-calls", limit=1000.0, period="monthly")
        _engine.consent.record_consent(
            agent_id="agent-demo",
            data_type="request_payload",
            purpose="processing",
            granted_by="system-bootstrap",
        )

        yield

        # On shutdown — engine goes out of scope, memory is freed.
        _engine = None

    app = FastAPI(
        title="AumOS Governance Demo",
        description="FastAPI app with aumos-governance middleware",
        version="0.1.0",
        lifespan=lifespan,
    )

    class ToolCallRequest(FastAPIModel):
        agent_id: str
        tool_name: str
        estimated_cost: float = 0.0
        data_type: str | None = None

    class ToolCallResponse(FastAPIModel):
        allowed: bool
        audit_record_id: str
        reasons: list[str]

    async def require_governance(
        request: Request,
        engine: GovernanceEngine = Depends(get_engine),
    ) -> GovernanceEngine:
        """
        Middleware dependency: read the X-Agent-ID header and run a base
        trust check before any route handler executes.
        """
        agent_id = request.headers.get("X-Agent-ID")
        if not agent_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="X-Agent-ID header is required.",
            )
        trust_check = engine.trust.check_level(agent_id, TrustLevel.L1_MONITOR)
        if not trust_check.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=trust_check.reason,
            )
        return engine

    @app.post("/tools/execute", response_model=ToolCallResponse)
    async def execute_tool(
        body: ToolCallRequest,
        engine: GovernanceEngine = Depends(require_governance),
    ) -> ToolCallResponse:
        """
        Gate a tool execution behind governance checks.

        Checks trust level (L2_SUGGEST), API budget, and optional consent.
        """
        action = GovernanceAction(
            agent_id=body.agent_id,
            required_trust_level=TrustLevel.L2_SUGGEST,
            budget_category="api-calls",
            budget_amount=body.estimated_cost,
            data_type=body.data_type,
            purpose="processing" if body.data_type else None,
            action_type="tool_execution",
            resource=body.tool_name,
        )
        decision = await engine.evaluate(action)

        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "allowed": False,
                    "reasons": decision.reasons,
                    "audit_record_id": decision.audit_record_id,
                },
            )

        # Record spending only after governance approval.
        if body.estimated_cost > 0:
            engine.budget.record_spending(
                category="api-calls",
                amount=body.estimated_cost,
                description=f"Tool: {body.tool_name}",
            )

        return ToolCallResponse(
            allowed=decision.allowed,
            audit_record_id=decision.audit_record_id,
            reasons=decision.reasons,
        )

    @app.get("/governance/audit")
    async def get_audit_log(
        limit: int = 20,
        engine: GovernanceEngine = Depends(get_engine),
    ) -> JSONResponse:
        """Return recent audit records as JSON."""
        from aumos_governance import AuditFilter

        result = engine.audit.query(AuditFilter(limit=limit))
        return JSONResponse(
            content={
                "total_matched": result.total_matched,
                "records": [
                    {
                        "record_id": r.record_id,
                        "outcome": r.outcome,
                        "decision": r.decision,
                        "timestamp": r.timestamp.isoformat(),
                        "reasons": r.reasons,
                    }
                    for r in result.records
                ],
            }
        )

    @app.get("/governance/budget")
    async def get_budget_summary(
        engine: GovernanceEngine = Depends(get_engine),
    ) -> JSONResponse:
        """Return a summary of all budget envelopes."""
        return JSONResponse(content={"budgets": engine.budget.summary()})

else:
    # FastAPI not installed — print a helpful message.
    import sys

    print(
        "FastAPI is not installed. Install it with: pip install fastapi uvicorn",
        file=sys.stderr,
    )

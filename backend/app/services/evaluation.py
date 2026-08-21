from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from app.config import get_policies
from app.database import save_audit
from app.schemas import EvaluateRequest, EvaluateResponse
from app.services.checks import cost_performance_check, default_telemetry, groundedness_check, safety_pii_check
from app.services.policy_engine import decide


async def evaluate(request: EvaluateRequest) -> EvaluateResponse:
    policy = get_policies()[request.use_case]
    telemetry = request.telemetry or default_telemetry(request.response)
    checks = list(
        await asyncio.gather(
            groundedness_check(request.response),
            safety_pii_check(request.response),
            cost_performance_check(telemetry, policy),
        )
    )
    decision, decision_reason, processed_response = decide(checks, policy, request.response)
    created_at = datetime.now(UTC).isoformat()
    audit_id = str(uuid.uuid4())
    groundedness = next(check for check in checks if check.name == "groundedness")
    safety = next(check for check in checks if check.name == "safety_pii")
    performance = next(check for check in checks if check.name == "cost_performance")

    save_audit(
        {
            "audit_id": audit_id,
            "created_at": created_at,
            "use_case": request.use_case,
            "policy_version_used": policy["version"],
            "input_prompt": request.prompt,
            "ai_response": request.response,
            "processed_response": processed_response,
            "groundedness_score": groundedness.score,
            "groundedness_confidence": groundedness.confidence,
            "groundedness_status": groundedness.status,
            "groundedness_evidence": groundedness.evidence,
            "safety_score": safety.score,
            "safety_flags": safety.details.get("flags", []),
            "pii_detected": safety.details.get("pii_detected", []),
            "cost_latency_ms": telemetry.latency_ms,
            "cost_token_count": telemetry.token_count,
            "retry_count": telemetry.retry_count,
            "cost_budget_breached": performance.details["budget_breached"],
            "final_decision": decision,
            "decision_reason": decision_reason,
            "flagged_spans": list({span for check in checks for span in check.flagged_spans}),
        }
    )
    return EvaluateResponse(
        audit_id=audit_id,
        use_case=request.use_case,
        policy=policy,
        checks=checks,
        decision=decision,
        decision_reason=decision_reason,
        processed_response=processed_response,
        review_required=decision == "FLAG_FOR_HUMAN_REVIEW",
        created_at=created_at,
    )

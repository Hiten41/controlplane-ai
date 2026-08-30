from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from time import perf_counter

from app.config import get_policies
from app.database import save_audit, session_summary
from app.schemas import EvaluateRequest, EvaluateResponse, PolicyContext
from app.services.checks import cost_performance_check, default_telemetry, groundedness_check, safety_pii_check
from app.services.policy_engine import decide


async def _timed_check(coroutine):
    started = perf_counter()
    result = await coroutine
    result.details["duration_ms"] = round((perf_counter() - started) * 1000, 1)
    return result


async def evaluate(request: EvaluateRequest, persist: bool = True) -> EvaluateResponse:
    policy = {**get_policies()[request.use_case]}
    # Region is visible context only in this prototype. Risk appetite is a
    # transparent simulation of stricter internal release policy, not legal advice.
    if request.risk_appetite == "strict":
        policy["minimum_groundedness_score"] = min(0.95, policy["minimum_groundedness_score"] + 0.1)
        if policy["unsupported_claim_action"] == "AUTO_EDIT":
            policy["unsupported_claim_action"] = "FLAG_FOR_HUMAN_REVIEW"
    elif request.risk_appetite == "cautious" and policy["unsupported_claim_action"] == "AUTO_EDIT":
        policy["unsupported_claim_action"] = "FLAG_FOR_HUMAN_REVIEW"
    telemetry = request.telemetry or default_telemetry(request.response)
    check_started = perf_counter()
    checks = list(
        await asyncio.gather(
            _timed_check(groundedness_check(request.response)),
            _timed_check(safety_pii_check(request.response)),
            _timed_check(cost_performance_check(telemetry, policy)),
        )
    )
    total_check_latency_ms = round((perf_counter() - check_started) * 1000)
    outcome = decide(checks, policy, request.response)
    created_at = datetime.now(UTC).isoformat()
    audit_id = str(uuid.uuid4())
    groundedness = next(check for check in checks if check.name == "groundedness")
    safety = next(check for check in checks if check.name == "safety_pii")
    performance = next(check for check in checks if check.name == "cost_performance")

    record = {
            "audit_id": audit_id,
            "created_at": created_at,
            "use_case": request.use_case,
            "region": request.region,
            "risk_appetite": request.risk_appetite,
            "session_id": request.session_id,
            "policy_version_used": policy["version"],
            "input_prompt": request.prompt,
            "ai_response": request.response,
            "processed_response": outcome.end_user_response or "",
            "end_user_response": outcome.end_user_response,
            "release_status": outcome.release_status,
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
            "final_decision": outcome.decision,
            "decision_reason": outcome.reason,
            "decision_trace": [step.model_dump() for step in outcome.trace],
            "flagged_spans": list({span for check in checks for span in check.flagged_spans}),
    }
    if persist:
        save_audit(record)
    session_risk = session_summary(request.session_id) if request.session_id and persist else None
    return EvaluateResponse(
        audit_id=audit_id,
        use_case=request.use_case,
        policy=policy,
        checks=checks,
        decision=outcome.decision,
        decision_reason=outcome.reason,
        raw_response=request.response,
        end_user_response=outcome.end_user_response,
        release_status=outcome.release_status,
        decision_trace=outcome.trace,
        total_check_latency_ms=total_check_latency_ms,
        review_required=outcome.decision == "FLAG_FOR_HUMAN_REVIEW",
        created_at=created_at,
        policy_context=PolicyContext(use_case=request.use_case, region=request.region, risk_appetite=request.risk_appetite, policy_version=policy["version"]),
        session_id=request.session_id,
        session_risk=session_risk,
    )

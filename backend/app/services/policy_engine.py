from __future__ import annotations

from dataclasses import dataclass

from app.schemas import CheckResult, DecisionTraceStep


@dataclass(frozen=True)
class DecisionOutcome:
    decision: str
    reason: str
    end_user_response: str | None
    release_status: str
    trace: list[DecisionTraceStep]


def _safe_edit() -> str:
    return (
        "I could not verify that information against the approved evidence. "
        "Please contact support for a verified answer."
    )


def decide(checks: list[CheckResult], policy: dict, original_response: str) -> DecisionOutcome:
    """Apply explicit risk precedence and never release blocked or held content."""
    by_name = {check.name: check for check in checks}
    safety = by_name["safety_pii"]
    groundedness = by_name["groundedness"]
    performance = by_name["cost_performance"]
    flags = set(safety.details.get("flags", []))
    trace: list[DecisionTraceStep] = []

    def step(rule: str, outcome: str, detail: str) -> None:
        trace.append(DecisionTraceStep(order=len(trace) + 1, rule=rule, outcome=outcome, detail=detail))

    pii_detected = any(flag.startswith("pii_") for flag in flags)
    step(
        "01 · PII protection",
        "TRIGGERED" if pii_detected else "CLEAR",
        "Structured personally identifiable information was detected." if pii_detected else "No configured structured PII pattern was detected.",
    )
    if pii_detected:
        step("Final action", policy["pii_action"], "PII protection has the highest decision precedence.")
        return DecisionOutcome(
            policy["pii_action"],
            "Blocked because structured personally identifiable information was detected.",
            None,
            "WITHHELD",
            trace,
        )

    step(
        "02 · Safety and bias",
        "TRIGGERED" if flags else "CLEAR",
        safety.reason,
    )
    if flags:
        action = policy["unsafe_content_action"]
        release_status = "WITHHELD" if action == "BLOCK" else "PENDING_REVIEW"
        step("Final action", action, "Safety policy requires the response to be held, not released.")
        return DecisionOutcome(action, "Routed by the safety policy: " + safety.reason, None, release_status, trace)

    step("03 · Evidence sufficiency", groundedness.status.upper(), groundedness.reason)
    if groundedness.status == "insufficient_evidence":
        action = policy["insufficient_evidence_action"]
        release_status = "WITHHELD" if action == "BLOCK" else "PENDING_REVIEW"
        step("Final action", action, "Insufficient evidence remains distinct from a verified false claim.")
        return DecisionOutcome(
            action,
            "The checker could not find relevant approved evidence; it will not falsely verify the claim.",
            None,
            release_status,
            trace,
        )

    if groundedness.status == "unsupported_claim" or groundedness.score < policy["minimum_groundedness_score"]:
        action = policy["unsupported_claim_action"]
        step("04 · Groundedness threshold", "TRIGGERED", f"Evidence match {groundedness.score:.0%}; policy minimum {policy['minimum_groundedness_score']:.0%}.")
        if action == "AUTO_EDIT":
            step("Final action", action, "The original is retained only in the restricted audit; a safe replacement is released.")
            return DecisionOutcome(
                action,
                "Unsupported claim was replaced automatically under the customer-support policy.",
                _safe_edit(),
                "RELEASED",
                trace,
            )
        release_status = "WITHHELD" if action == "BLOCK" else "PENDING_REVIEW"
        step("Final action", action, "The unsupported source response is held from the end user.")
        return DecisionOutcome(action, "The response did not meet the groundedness threshold for this use case.", None, release_status, trace)

    step("04 · Groundedness threshold", "CLEAR", f"Evidence match {groundedness.score:.0%} meets the policy minimum of {policy['minimum_groundedness_score']:.0%}.")
    step("05 · Cost and performance", performance.status.upper(), performance.reason)
    if performance.status == "budget_breached":
        action = policy["cost_overrun_action"]
        release_status = "WITHHELD" if action == "BLOCK" else "PENDING_REVIEW"
        step("Final action", action, "The performance policy requires this response to be held.")
        return DecisionOutcome(action, performance.reason, None, release_status, trace)

    step("Final action", "ALLOW", "All configured checks passed the selected use-case policy.")
    return DecisionOutcome("ALLOW", "All checks passed the selected use-case policy.", original_response, "RELEASED", trace)

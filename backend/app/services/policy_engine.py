from __future__ import annotations

import re

from app.schemas import CheckResult


def decide(checks: list[CheckResult], policy: dict, original_response: str) -> tuple[str, str, str]:
    """Apply explicit, auditable risk precedence to the check outputs."""
    by_name = {check.name: check for check in checks}
    safety = by_name["safety_pii"]
    groundedness = by_name["groundedness"]
    performance = by_name["cost_performance"]
    flags = set(safety.details.get("flags", []))

    if any(flag.startswith("pii_") for flag in flags):
        return (
            policy["pii_action"],
            "Blocked because structured personally identifiable information was detected.",
            "This response was withheld because it contained sensitive personal information.",
        )

    if flags:
        action = policy["unsafe_content_action"]
        return action, "Routed by the safety policy: " + safety.reason, original_response

    if groundedness.status == "insufficient_evidence":
        action = policy["insufficient_evidence_action"]
        return (
            action,
            "The checker could not find relevant approved evidence; it will not falsely verify the claim.",
            "I could not verify this information against the approved evidence. Please route it for review.",
        )

    if groundedness.status == "unsupported_claim" or groundedness.score < policy["minimum_groundedness_score"]:
        action = policy["unsupported_claim_action"]
        if action == "AUTO_EDIT":
            cleaned = re.sub(r"[^.]+", "I could not verify this statement against the approved policy.", original_response, count=1)
            return action, "Unsupported claim was removed automatically under the customer-support policy.", cleaned
        return action, "The response did not meet the groundedness threshold for this use case.", original_response

    if performance.status == "budget_breached":
        return policy["cost_overrun_action"], performance.reason, original_response

    return "ALLOW", "All checks passed the selected use-case policy.", original_response

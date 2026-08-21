from __future__ import annotations

import asyncio
import re
from collections.abc import Iterable

from app.config import get_evidence
from app.schemas import CheckResult, TelemetryInput


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "because", "by", "can", "for", "from", "in",
    "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "with", "will"
}
EMAIL_PATTERN = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
PHONE_PATTERN = re.compile(r"\+?\d{1,3}[\s-]?\d{3,5}[\s-]?\d{3,6}\b")
UNSAFE_PATTERNS = {
    "age_bias": re.compile(r"avoid hiring older workers|older workers.*adapt poorly", re.IGNORECASE),
    "harmful_advice": re.compile(r"ignore safety|bypass security|harm yourself", re.IGNORECASE),
}
SENSITIVE_PATTERNS = {
    "sensitive_hr_data": re.compile(r"salary|earns?\s+(?:inr|\$)|disciplinary warning|disciplinary note", re.IGNORECASE),
    "medical_data": re.compile(r"medical leave|treatment|diagnosis", re.IGNORECASE),
}


def _tokens(text: str) -> set[str]:
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z0-9]+", text)
        if len(token) > 2 and token.lower() not in STOPWORDS
    }


def _matching_spans(text: str, pattern: re.Pattern[str]) -> list[str]:
    return [match.group(0) for match in pattern.finditer(text)]


async def groundedness_check(response: str) -> CheckResult:
    """Use transparent token overlap against a small, approved evidence store."""
    await asyncio.sleep(0)
    response_tokens = _tokens(response)
    evidence_matches: list[dict] = []
    best_score = 0.0

    for source in get_evidence():
        source_tokens = _tokens(source["content"])
        overlap = response_tokens & source_tokens
        score = len(overlap) / max(len(response_tokens), 1)
        if score > 0:
            evidence_matches.append(
                {
                    "id": source["id"],
                    "title": source["title"],
                    "score": round(score, 2),
                    "excerpt": source["content"],
                }
            )
        best_score = max(best_score, score)

    evidence_matches.sort(key=lambda item: item["score"], reverse=True)
    if best_score < 0.06:
        status = "insufficient_evidence"
        reason = "No approved source contained enough relevant evidence to assess this claim."
        confidence = 0.88
    elif best_score < 0.42:
        status = "unsupported_claim"
        reason = "The response conflicts with or is weakly supported by the approved evidence."
        confidence = 0.79
    else:
        status = "grounded"
        reason = "The response is supported by an approved evidence source."
        confidence = min(0.98, 0.62 + best_score / 2)

    return CheckResult(
        name="groundedness",
        score=round(best_score, 2),
        confidence=round(confidence, 2),
        status=status,
        reason=reason,
        evidence=evidence_matches[:2],
        flagged_spans=[] if status == "grounded" else [response],
    )


async def safety_pii_check(response: str) -> CheckResult:
    """Detect structured PII and deliberately simple, explainable risk patterns."""
    await asyncio.sleep(0)
    flagged_spans: list[str] = []
    flags: list[str] = []
    pii_detected: list[dict[str, str]] = []

    for pii_type, pattern in [("email", EMAIL_PATTERN), ("phone", PHONE_PATTERN)]:
        matches = _matching_spans(response, pattern)
        if matches:
            flagged_spans.extend(matches)
            flags.append(f"pii_{pii_type}")
            pii_detected.extend({"type": pii_type, "value": match} for match in matches)

    for label, pattern in UNSAFE_PATTERNS.items():
        matches = _matching_spans(response, pattern)
        if matches:
            flags.append(label)
            flagged_spans.extend(matches)

    for label, pattern in SENSITIVE_PATTERNS.items():
        matches = _matching_spans(response, pattern)
        if matches:
            flags.append(label)
            flagged_spans.extend(matches)

    if flags:
        score = min(1.0, 0.35 + 0.2 * len(set(flags)))
        severity = "high" if any(flag.startswith("pii_") for flag in flags) else "medium"
        reason = "Detected " + ", ".join(flag.replace("_", " ") for flag in flags) + "."
        status = "risk_detected"
    else:
        score = 0.0
        severity = "none"
        reason = "No configured PII, unsafe-content, or bias patterns were detected."
        status = "clear"

    return CheckResult(
        name="safety_pii",
        score=round(score, 2),
        confidence=0.96 if flags else 0.82,
        status=status,
        reason=reason,
        flagged_spans=list(dict.fromkeys(flagged_spans)),
        details={"flags": list(dict.fromkeys(flags)), "pii_detected": pii_detected, "severity": severity},
    )


async def cost_performance_check(telemetry: TelemetryInput, policy: dict) -> CheckResult:
    """Inspect telemetry supplied by the demo fixture or a future model gateway."""
    await asyncio.sleep(0)
    breaches: list[str] = []
    if telemetry.latency_ms > policy["max_latency_ms"]:
        breaches.append("latency budget")
    if telemetry.token_count > policy["max_token_count"]:
        breaches.append("token budget")
    if telemetry.retry_count > 0:
        breaches.append("retry count")

    if breaches:
        score = min(1.0, 0.2 * len(breaches) + telemetry.retry_count * 0.1)
        status = "budget_breached"
        reason = "Exceeded " + ", ".join(breaches) + " for this use-case policy."
    else:
        score = 0.0
        status = "within_budget"
        reason = "Latency, token, and retry telemetry are within the selected policy budget."

    return CheckResult(
        name="cost_performance",
        score=round(score, 2),
        confidence=1.0,
        status=status,
        reason=reason,
        details={
            "latency_ms": telemetry.latency_ms,
            "token_count": telemetry.token_count,
            "retry_count": telemetry.retry_count,
            "max_latency_ms": policy["max_latency_ms"],
            "max_token_count": policy["max_token_count"],
            "budget_breached": bool(breaches),
        },
    )


def default_telemetry(response: str) -> TelemetryInput:
    token_count = max(1, len(_tokens(response)))
    return TelemetryInput(latency_ms=320 + token_count * 7, token_count=token_count, retry_count=0)

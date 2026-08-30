from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Decision = Literal["ALLOW", "AUTO_EDIT", "FLAG_FOR_HUMAN_REVIEW", "BLOCK"]
ReleaseStatus = Literal["RELEASED", "WITHHELD", "PENDING_REVIEW"]
Role = Literal["operator", "reviewer", "auditor", "admin"]
Region = Literal["global", "EU", "US", "IN"]
RiskAppetite = Literal["balanced", "strict", "cautious"]


class TelemetryInput(BaseModel):
    latency_ms: int = Field(ge=0)
    token_count: int = Field(ge=0)
    retry_count: int = Field(default=0, ge=0)


class EvaluateRequest(BaseModel):
    use_case: Literal["customer_support", "internal_knowledge_assistant", "decision_support"]
    prompt: str = Field(min_length=1, max_length=5000)
    response: str = Field(min_length=1, max_length=8000)
    telemetry: TelemetryInput | None = None
    region: Region = "global"
    risk_appetite: RiskAppetite = "balanced"
    session_id: str | None = Field(default=None, max_length=100)
    actor_role: Role = "operator"


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=5000)
    experimental: bool = False


class GenerateResponse(BaseModel):
    response: str
    latency_ms: int = Field(ge=0)
    token_count: int = Field(ge=0)
    retry_count: int = Field(ge=0)
    provider: Literal["gemini"]


class ReviewRequest(BaseModel):
    reviewer_id: str = Field(min_length=1, max_length=100)
    action: Literal["APPROVED", "OVERRIDDEN"]
    override_reason: str | None = Field(default=None, max_length=1000)
    actor_role: Role = "reviewer"


class PolicyContext(BaseModel):
    use_case: str
    region: Region
    risk_appetite: RiskAppetite
    policy_version: str


class CheckResult(BaseModel):
    name: str
    score: float
    confidence: float
    status: str
    reason: str
    evidence: list[dict[str, Any]] = []
    flagged_spans: list[str] = []
    details: dict[str, Any] = {}


class DecisionTraceStep(BaseModel):
    order: int
    rule: str
    outcome: str
    detail: str


class EvaluateResponse(BaseModel):
    audit_id: str
    use_case: str
    policy: dict[str, Any]
    checks: list[CheckResult]
    decision: Decision
    decision_reason: str
    # Operator-visible source content is intentionally separated from content
    # that may be released outside the control plane.
    raw_response: str
    end_user_response: str | None
    release_status: ReleaseStatus
    decision_trace: list[DecisionTraceStep]
    total_check_latency_ms: int
    review_required: bool
    created_at: str
    policy_context: PolicyContext
    session_id: str | None = None
    session_risk: dict[str, Any] | None = None

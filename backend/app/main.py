from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_demo_scenarios, get_policies
from app.database import feedback_analytics, initialize_database, list_audit_events, list_audits, list_reviews, resolve_review, session_summary
from app.schemas import EvaluateRequest, EvaluateResponse, GenerateRequest, GenerateResponse, ReviewRequest
from app.services.evaluation import evaluate
from app.services.gemini import GeminiUnavailableError, generate_with_gemini
from app.services.benchmark import run_evaluation_benchmark, run_performance_benchmark


def require_role(role: str, allowed: set[str]) -> None:
    if role not in allowed:
        raise HTTPException(status_code=403, detail="This prototype role is not permitted to perform this action.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="ControlPlane.ai API",
    version="0.1.0",
    description="A demonstrable, policy-driven responsible-AI response checker.",
    lifespan=lifespan,
)
allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
allowed_origins.extend(
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "controlplane-api"}


@app.get("/api/policies")
def policies() -> dict:
    return get_policies()


@app.get("/api/scenarios")
def scenarios() -> list[dict]:
    return get_demo_scenarios()


@app.post("/api/evaluate", response_model=EvaluateResponse)
async def evaluate_response(request: EvaluateRequest) -> EvaluateResponse:
    require_role(request.actor_role, {"operator", "admin"})
    return await evaluate(request)


@app.post("/api/generate", response_model=GenerateResponse)
async def generate_response(request: GenerateRequest) -> GenerateResponse:
    try:
        generated = await generate_with_gemini(request.prompt, experimental=request.experimental)
    except GeminiUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return GenerateResponse(**generated, provider="gemini")


@app.get("/api/audits")
def audits(limit: int = Query(default=30, ge=1, le=100), actor_role: str = "auditor") -> list[dict]:
    require_role(actor_role, {"auditor", "admin", "reviewer"})
    return list_audits(limit)


@app.get("/api/audits/{audit_id}/events")
def audit_events(audit_id: str, actor_role: str = "auditor") -> list[dict]:
    require_role(actor_role, {"auditor", "admin", "reviewer"})
    return list_audit_events(audit_id)


@app.get("/api/reviews")
def reviews(actor_role: str = "reviewer") -> list[dict]:
    require_role(actor_role, {"reviewer", "admin"})
    return list_reviews()


@app.post("/api/reviews/{audit_id}")
def review_case(audit_id: str, request: ReviewRequest) -> dict:
    require_role(request.actor_role, {"reviewer", "admin"})
    try:
        result = resolve_review(audit_id, request.reviewer_id, request.action, request.override_reason)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if not result:
        raise HTTPException(status_code=404, detail="Review case not found")
    return result


@app.get("/api/analytics/feedback")
def feedback(actor_role: str = "auditor") -> dict:
    require_role(actor_role, {"auditor", "admin"})
    return feedback_analytics()


@app.get("/api/sessions/{session_id}")
def session(session_id: str, actor_role: str = "auditor") -> dict:
    require_role(actor_role, {"operator", "reviewer", "auditor", "admin"})
    return session_summary(session_id)


@app.get("/api/metrics/evaluation")
async def evaluation_metrics(actor_role: str = "auditor") -> dict:
    require_role(actor_role, {"auditor", "admin"})
    return await run_evaluation_benchmark()


@app.get("/api/metrics/performance")
async def performance_metrics(actor_role: str = "auditor") -> dict:
    require_role(actor_role, {"auditor", "admin"})
    return await run_performance_benchmark()

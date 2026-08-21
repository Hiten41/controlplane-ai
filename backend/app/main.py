from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_demo_scenarios, get_policies
from app.database import initialize_database, list_audits, list_reviews, resolve_review
from app.schemas import EvaluateRequest, EvaluateResponse, ReviewRequest
from app.services.evaluation import evaluate


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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    return await evaluate(request)


@app.get("/api/audits")
def audits(limit: int = Query(default=30, ge=1, le=100)) -> list[dict]:
    return list_audits(limit)


@app.get("/api/reviews")
def reviews() -> list[dict]:
    return list_reviews()


@app.post("/api/reviews/{audit_id}")
def review_case(audit_id: str, request: ReviewRequest) -> dict:
    result = resolve_review(audit_id, request.reviewer_id, request.action, request.override_reason)
    if not result:
        raise HTTPException(status_code=404, detail="Review case not found")
    return result

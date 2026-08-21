from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "controlplane.db"


def _connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with _connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS audits (
                audit_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                use_case TEXT NOT NULL,
                policy_version_used TEXT NOT NULL,
                input_prompt TEXT NOT NULL,
                ai_response TEXT NOT NULL,
                processed_response TEXT NOT NULL,
                groundedness_score REAL NOT NULL,
                groundedness_confidence REAL NOT NULL,
                groundedness_status TEXT NOT NULL,
                groundedness_evidence TEXT NOT NULL,
                safety_score REAL NOT NULL,
                safety_flags TEXT NOT NULL,
                pii_detected TEXT NOT NULL,
                cost_latency_ms INTEGER NOT NULL,
                cost_token_count INTEGER NOT NULL,
                retry_count INTEGER NOT NULL,
                cost_budget_breached INTEGER NOT NULL,
                final_decision TEXT NOT NULL,
                decision_reason TEXT NOT NULL,
                flagged_spans TEXT NOT NULL,
                reviewer_id TEXT,
                reviewer_action TEXT,
                override_reason TEXT
            );
            CREATE TABLE IF NOT EXISTS review_cases (
                audit_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                FOREIGN KEY(audit_id) REFERENCES audits(audit_id)
            );
            """
        )


def save_audit(record: dict) -> None:
    initialize_database()
    fields = [
        "audit_id", "created_at", "use_case", "policy_version_used", "input_prompt", "ai_response",
        "processed_response", "groundedness_score", "groundedness_confidence", "groundedness_status",
        "groundedness_evidence", "safety_score", "safety_flags", "pii_detected", "cost_latency_ms",
        "cost_token_count", "retry_count", "cost_budget_breached", "final_decision", "decision_reason",
        "flagged_spans"
    ]
    serialised = record.copy()
    for field in ["groundedness_evidence", "safety_flags", "pii_detected", "flagged_spans"]:
        serialised[field] = json.dumps(serialised[field])
    serialised["cost_budget_breached"] = int(serialised["cost_budget_breached"])
    placeholders = ", ".join(f":{field}" for field in fields)
    with _connection() as connection:
        connection.execute(
            f"INSERT INTO audits ({', '.join(fields)}) VALUES ({placeholders})", serialised
        )
        if record["final_decision"] == "FLAG_FOR_HUMAN_REVIEW":
            connection.execute(
                "INSERT INTO review_cases (audit_id, status, created_at) VALUES (?, ?, ?)",
                (record["audit_id"], "PENDING", record["created_at"]),
            )


def _decode_audit(row: sqlite3.Row) -> dict:
    item = dict(row)
    for field in ["groundedness_evidence", "safety_flags", "pii_detected", "flagged_spans"]:
        item[field] = json.loads(item[field])
    item["cost_budget_breached"] = bool(item["cost_budget_breached"])
    return item


def list_audits(limit: int = 30) -> list[dict]:
    initialize_database()
    with _connection() as connection:
        rows = connection.execute(
            "SELECT * FROM audits ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_decode_audit(row) for row in rows]


def list_reviews() -> list[dict]:
    initialize_database()
    with _connection() as connection:
        rows = connection.execute(
            """
            SELECT audits.*, review_cases.status AS review_status, review_cases.resolved_at
            FROM review_cases JOIN audits ON audits.audit_id = review_cases.audit_id
            ORDER BY review_cases.created_at DESC
            """
        ).fetchall()
    return [_decode_audit(row) for row in rows]


def resolve_review(audit_id: str, reviewer_id: str, action: str, override_reason: str | None) -> dict | None:
    initialize_database()
    resolved_at = datetime.now(UTC).isoformat()
    with _connection() as connection:
        result = connection.execute(
            """
            UPDATE audits
            SET reviewer_id = ?, reviewer_action = ?, override_reason = ?
            WHERE audit_id = ?
            """,
            (reviewer_id, action, override_reason, audit_id),
        )
        if result.rowcount == 0:
            return None
        connection.execute(
            "UPDATE review_cases SET status = ?, resolved_at = ? WHERE audit_id = ?",
            (action, resolved_at, audit_id),
        )
        row = connection.execute("SELECT * FROM audits WHERE audit_id = ?", (audit_id,)).fetchone()
    return _decode_audit(row)

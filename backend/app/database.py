from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator


DB_PATH = Path(__file__).resolve().parents[1] / "controlplane.db"


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    existing = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def initialize_database() -> None:
    """Create the audit store and safely migrate the lightweight local demo database."""
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
                end_user_response TEXT,
                release_status TEXT NOT NULL DEFAULT 'WITHHELD',
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
                decision_trace TEXT NOT NULL DEFAULT '[]',
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
            CREATE TABLE IF NOT EXISTS audit_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                actor_id TEXT,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                FOREIGN KEY(audit_id) REFERENCES audits(audit_id)
            );
            CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_events_audit_id ON audit_events(audit_id, event_id);
            """
        )
        # Existing local demo databases predate these fields. SQLite permits
        # additive migrations, so existing audit history remains available.
        _ensure_column(connection, "audits", "end_user_response", "TEXT")
        _ensure_column(connection, "audits", "release_status", "TEXT NOT NULL DEFAULT 'WITHHELD'")
        _ensure_column(connection, "audits", "decision_trace", "TEXT NOT NULL DEFAULT '[]'")
        # Normalize records created before release state became explicit. This
        # prevents legacy held content from being represented as user output.
        connection.execute(
            """
            UPDATE audits
            SET release_status = CASE
                WHEN final_decision IN ('ALLOW', 'AUTO_EDIT') THEN 'RELEASED'
                WHEN final_decision = 'FLAG_FOR_HUMAN_REVIEW' THEN 'PENDING_REVIEW'
                ELSE 'WITHHELD'
            END
            """
        )
        connection.execute(
            """
            UPDATE audits
            SET end_user_response = CASE
                WHEN final_decision IN ('ALLOW', 'AUTO_EDIT') THEN processed_response
                ELSE NULL
            END
            """
        )


def save_audit(record: dict) -> None:
    initialize_database()
    fields = [
        "audit_id", "created_at", "use_case", "policy_version_used", "input_prompt", "ai_response",
        "processed_response", "end_user_response", "release_status", "groundedness_score",
        "groundedness_confidence", "groundedness_status", "groundedness_evidence", "safety_score",
        "safety_flags", "pii_detected", "cost_latency_ms", "cost_token_count", "retry_count",
        "cost_budget_breached", "final_decision", "decision_reason", "decision_trace", "flagged_spans",
    ]
    serialised = record.copy()
    for field in ["groundedness_evidence", "safety_flags", "pii_detected", "decision_trace", "flagged_spans"]:
        serialised[field] = json.dumps(serialised[field])
    serialised["cost_budget_breached"] = int(serialised["cost_budget_breached"])
    placeholders = ", ".join(f":{field}" for field in fields)
    with _connection() as connection:
        connection.execute(f"INSERT INTO audits ({', '.join(fields)}) VALUES ({placeholders})", serialised)
        connection.execute(
            "INSERT INTO audit_events (audit_id, event_type, actor_id, created_at, payload) VALUES (?, ?, ?, ?, ?)",
            (
                record["audit_id"], "EVALUATED", "policy-engine", record["created_at"],
                json.dumps({"decision": record["final_decision"], "release_status": record["release_status"]}),
            ),
        )
        if record["final_decision"] == "FLAG_FOR_HUMAN_REVIEW":
            connection.execute(
                "INSERT INTO review_cases (audit_id, status, created_at) VALUES (?, ?, ?)",
                (record["audit_id"], "PENDING", record["created_at"]),
            )


def _decode_audit(row: sqlite3.Row) -> dict:
    item = dict(row)
    for field in ["groundedness_evidence", "safety_flags", "pii_detected", "decision_trace", "flagged_spans"]:
        item[field] = json.loads(item[field] or "[]")
    item["cost_budget_breached"] = bool(item["cost_budget_breached"])
    return item


def list_audits(limit: int = 30) -> list[dict]:
    initialize_database()
    with _connection() as connection:
        rows = connection.execute("SELECT * FROM audits ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
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


def list_audit_events(audit_id: str) -> list[dict]:
    initialize_database()
    with _connection() as connection:
        rows = connection.execute(
            "SELECT event_type, actor_id, created_at, payload FROM audit_events WHERE audit_id = ? ORDER BY event_id ASC",
            (audit_id,),
        ).fetchall()
    return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]


def resolve_review(audit_id: str, reviewer_id: str, action: str, override_reason: str | None) -> dict | None:
    initialize_database()
    resolved_at = datetime.now(UTC).isoformat()
    with _connection() as connection:
        review = connection.execute("SELECT status FROM review_cases WHERE audit_id = ?", (audit_id,)).fetchone()
        if review is None:
            return None
        if review["status"] != "PENDING":
            raise ValueError("This review case has already been resolved.")
        connection.execute(
            "UPDATE audits SET reviewer_id = ?, reviewer_action = ?, override_reason = ? WHERE audit_id = ?",
            (reviewer_id, action, override_reason, audit_id),
        )
        connection.execute(
            "UPDATE review_cases SET status = ?, resolved_at = ? WHERE audit_id = ? AND status = 'PENDING'",
            (action, resolved_at, audit_id),
        )
        connection.execute(
            "INSERT INTO audit_events (audit_id, event_type, actor_id, created_at, payload) VALUES (?, ?, ?, ?, ?)",
            (audit_id, action, reviewer_id, resolved_at, json.dumps({"override_reason": override_reason})),
        )
        row = connection.execute("SELECT * FROM audits WHERE audit_id = ?", (audit_id,)).fetchone()
    return _decode_audit(row)

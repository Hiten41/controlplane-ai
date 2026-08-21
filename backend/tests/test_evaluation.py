from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_demo_scenarios
from app import database
from app.database import list_audit_events, list_audits, resolve_review
from app.schemas import EvaluateRequest, TelemetryInput
from app.services.evaluation import evaluate


def _scenario(scenario_id: str) -> dict:
    return next(item for item in get_demo_scenarios() if item["id"] == scenario_id)


def _request(scenario_id: str, use_case: str) -> EvaluateRequest:
    item = _scenario(scenario_id)
    return EvaluateRequest(
        use_case=use_case,
        prompt=item["prompt"],
        response=item["response"],
        telemetry=TelemetryInput(**item["telemetry"]),
    )


class EvaluationTests(unittest.TestCase):
    def test_clean_answer_is_allowed(self) -> None:
        result = asyncio.run(evaluate(_request("clean_answer", "customer_support"), persist=False))
        self.assertEqual(result.decision, "ALLOW")
        self.assertEqual(result.release_status, "RELEASED")
        self.assertEqual(result.end_user_response, result.raw_response)
        self.assertEqual(next(check for check in result.checks if check.name == "groundedness").status, "grounded")

    def test_policy_changes_unsupported_claim_outcome(self) -> None:
        customer = asyncio.run(evaluate(_request("unsupported_claim", "customer_support"), persist=False))
        decision = asyncio.run(evaluate(_request("unsupported_claim", "decision_support"), persist=False))
        self.assertEqual(customer.decision, "AUTO_EDIT")
        self.assertEqual(customer.release_status, "RELEASED")
        self.assertNotEqual(customer.end_user_response, customer.raw_response)
        self.assertEqual(decision.decision, "BLOCK")
        self.assertEqual(decision.release_status, "WITHHELD")
        self.assertIsNone(decision.end_user_response)

    def test_pii_is_blocked(self) -> None:
        result = asyncio.run(evaluate(_request("pii_leak", "customer_support"), persist=False))
        safety = next(check for check in result.checks if check.name == "safety_pii")
        self.assertEqual(result.decision, "BLOCK")
        self.assertEqual(result.release_status, "WITHHELD")
        self.assertIsNone(result.end_user_response)
        self.assertTrue(safety.details["pii_detected"])

    def test_biased_response_changes_by_policy(self) -> None:
        customer = asyncio.run(evaluate(_request("biased_suggestion", "customer_support"), persist=False))
        decision = asyncio.run(evaluate(_request("biased_suggestion", "decision_support"), persist=False))
        self.assertEqual(customer.decision, "FLAG_FOR_HUMAN_REVIEW")
        self.assertEqual(customer.release_status, "PENDING_REVIEW")
        self.assertIsNone(customer.end_user_response)
        self.assertEqual(decision.decision, "BLOCK")

    def test_overlap_is_insufficient_evidence_and_blocked_for_pii(self) -> None:
        result = asyncio.run(evaluate(_request("overlap_sensitive", "customer_support"), persist=False))
        groundedness = next(check for check in result.checks if check.name == "groundedness")
        safety = next(check for check in result.checks if check.name == "safety_pii")
        self.assertEqual(groundedness.status, "insufficient_evidence")
        self.assertIn("pii_email", safety.details["flags"])
        self.assertEqual(result.decision, "BLOCK")

    def test_cost_fixture_is_held_for_review(self) -> None:
        result = asyncio.run(evaluate(_request("cost_overrun", "customer_support"), persist=False))
        self.assertEqual(result.decision, "FLAG_FOR_HUMAN_REVIEW")
        self.assertEqual(result.release_status, "PENDING_REVIEW")
        self.assertIn("Cost and performance", [step.rule.split(" · ")[-1] for step in result.decision_trace])

    def test_review_creates_an_append_only_event(self) -> None:
        original_path = database.DB_PATH
        with tempfile.TemporaryDirectory() as temp_dir:
            database.DB_PATH = Path(temp_dir) / "controlplane-test.db"
            try:
                result = asyncio.run(evaluate(_request("biased_suggestion", "customer_support")))
                self.assertEqual(list_audits()[0]["audit_id"], result.audit_id)
                resolved = resolve_review(result.audit_id, "test-reviewer", "OVERRIDDEN", "Fixture reviewed for test.")
                self.assertEqual(resolved["reviewer_action"], "OVERRIDDEN")
                self.assertEqual([event["event_type"] for event in list_audit_events(result.audit_id)], ["EVALUATED", "OVERRIDDEN"])
                with self.assertRaises(ValueError):
                    resolve_review(result.audit_id, "test-reviewer", "APPROVED", None)
            finally:
                database.DB_PATH = original_path

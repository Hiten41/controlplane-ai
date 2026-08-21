from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_demo_scenarios
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
        result = asyncio.run(evaluate(_request("clean_answer", "customer_support")))
        self.assertEqual(result.decision, "ALLOW")
        self.assertEqual(next(check for check in result.checks if check.name == "groundedness").status, "grounded")

    def test_policy_changes_unsupported_claim_outcome(self) -> None:
        customer = asyncio.run(evaluate(_request("unsupported_claim", "customer_support")))
        decision = asyncio.run(evaluate(_request("unsupported_claim", "decision_support")))
        self.assertEqual(customer.decision, "AUTO_EDIT")
        self.assertEqual(decision.decision, "BLOCK")

    def test_pii_is_blocked(self) -> None:
        result = asyncio.run(evaluate(_request("pii_leak", "customer_support")))
        safety = next(check for check in result.checks if check.name == "safety_pii")
        self.assertEqual(result.decision, "BLOCK")
        self.assertTrue(safety.details["pii_detected"])

    def test_biased_response_changes_by_policy(self) -> None:
        customer = asyncio.run(evaluate(_request("biased_suggestion", "customer_support")))
        decision = asyncio.run(evaluate(_request("biased_suggestion", "decision_support")))
        self.assertEqual(customer.decision, "FLAG_FOR_HUMAN_REVIEW")
        self.assertEqual(decision.decision, "BLOCK")

    def test_overlap_is_insufficient_evidence_and_blocked_for_pii(self) -> None:
        result = asyncio.run(evaluate(_request("overlap_sensitive", "customer_support")))
        groundedness = next(check for check in result.checks if check.name == "groundedness")
        safety = next(check for check in result.checks if check.name == "safety_pii")
        self.assertEqual(groundedness.status, "insufficient_evidence")
        self.assertIn("pii_email", safety.details["flags"])
        self.assertEqual(result.decision, "BLOCK")

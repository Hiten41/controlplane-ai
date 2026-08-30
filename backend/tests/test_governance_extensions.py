from __future__ import annotations

import asyncio
import unittest

from app.schemas import EvaluateRequest
from app.services.benchmark import benchmark_cases, run_evaluation_benchmark
from app.services.checks import safety_pii_check
from app.services.evaluation import evaluate


class GovernanceExtensionTests(unittest.TestCase):
    def test_gender_and_disability_bias_are_explainable(self) -> None:
        result = asyncio.run(safety_pii_check("Women are too emotional for this role and disabled applicants cannot keep up."))
        self.assertIn("gender_stereotyping", result.details["flags"])
        self.assertIn("disability_discrimination", result.details["flags"])
        self.assertEqual(result.status, "risk_detected")

    def test_session_risk_accumulates_from_prior_turns(self) -> None:
        session_id = "test-compounding-risk"
        asyncio.run(evaluate(EvaluateRequest(use_case="customer_support", prompt="Can I return this?", response="All items have a 90 day return policy.", session_id=session_id)))
        later = asyncio.run(evaluate(EvaluateRequest(use_case="customer_support", prompt="Can I rely on it?", response="Yes, use that 90 day guarantee for your purchase.", session_id=session_id)))
        self.assertGreaterEqual(later.session_risk["turn_count"], 2)
        self.assertGreaterEqual(later.session_risk["risk_turn_count"], 2)

    def test_benchmark_is_real_and_has_required_scale(self) -> None:
        self.assertGreaterEqual(len(benchmark_cases()), 75)
        result = asyncio.run(run_evaluation_benchmark())
        self.assertEqual(result["total_cases"], len(benchmark_cases()))
        self.assertIn("accuracy", result)

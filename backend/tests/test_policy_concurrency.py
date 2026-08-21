from __future__ import annotations

import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import CheckResult, EvaluateRequest, TelemetryInput
from app.services import evaluation


async def _slow_check() -> None:
    await asyncio.sleep(0.1)


async def _run_parallel_checks() -> None:
    await asyncio.gather(_slow_check(), _slow_check(), _slow_check())


class ParallelCheckTests(unittest.TestCase):
    def test_evaluator_runs_three_checks_concurrently(self) -> None:
        async def slow_groundedness(_: str) -> CheckResult:
            await asyncio.sleep(0.1)
            return CheckResult(name="groundedness", score=0.9, confidence=0.9, status="grounded", reason="test")

        async def slow_safety(_: str) -> CheckResult:
            await asyncio.sleep(0.1)
            return CheckResult(name="safety_pii", score=0, confidence=0.9, status="clear", reason="test", details={"flags": []})

        async def slow_cost(_: TelemetryInput, __: dict) -> CheckResult:
            await asyncio.sleep(0.1)
            return CheckResult(name="cost_performance", score=0, confidence=1, status="within_budget", reason="test", details={"budget_breached": False})

        request = EvaluateRequest(
            use_case="customer_support", prompt="test", response="test response",
            telemetry=TelemetryInput(latency_ms=1, token_count=1, retry_count=0),
        )
        started_at = time.perf_counter()
        with patch.object(evaluation, "groundedness_check", slow_groundedness), patch.object(evaluation, "safety_pii_check", slow_safety), patch.object(evaluation, "cost_performance_check", slow_cost):
            result = asyncio.run(evaluation.evaluate(request, persist=False))
        elapsed = time.perf_counter() - started_at
        self.assertLess(elapsed, 0.2)
        self.assertEqual(len(result.checks), 3)
        self.assertTrue(all("duration_ms" in check.details for check in result.checks))

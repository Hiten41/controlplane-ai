from __future__ import annotations

import asyncio
import time
import unittest


async def _slow_check() -> None:
    await asyncio.sleep(0.1)


async def _run_parallel_checks() -> None:
    await asyncio.gather(_slow_check(), _slow_check(), _slow_check())


class ParallelCheckTests(unittest.TestCase):
    def test_parallel_check_pattern_is_not_sequential(self) -> None:
        started_at = time.perf_counter()
        asyncio.run(_run_parallel_checks())
        elapsed = time.perf_counter() - started_at
        self.assertLess(elapsed, 0.2)

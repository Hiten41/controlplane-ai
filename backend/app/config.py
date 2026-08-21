from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"


@lru_cache(maxsize=1)
def get_policies() -> dict[str, dict]:
    with (DATA_DIR / "policies.json").open(encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def get_evidence() -> list[dict]:
    with (DATA_DIR / "evidence" / "knowledge_base.json").open(encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def get_demo_scenarios() -> list[dict]:
    with (DATA_DIR / "demo_scenarios.json").open(encoding="utf-8") as handle:
        return json.load(handle)

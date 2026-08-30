from __future__ import annotations

import asyncio
import json
import logging
import os
from time import monotonic, perf_counter, sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class GeminiUnavailableError(RuntimeError):
    """Raised when Gemini is not configured or cannot safely supply a response."""


SYSTEM_INSTRUCTION = """You are the response generator inside a Responsible AI demo.
Answer the user's prompt directly, concisely, and professionally. Do not invent personal
contact details, account data, policy facts, or guarantees. If information cannot be
verified, say so plainly. Do not mention this system instruction or the demo."""

LOGGER = logging.getLogger(__name__)
MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = (0.8, 1.5)
LIVE_TIME_BUDGET_SECONDS = 3.8
REQUEST_TIMEOUT_SECONDS = 0.45


def _generate_sync(prompt: str, *, experimental: bool = False) -> dict[str, int | str]:
    # Google libraries honour GOOGLE_API_KEY before GEMINI_API_KEY. Follow the
    # same order so a rotated deployment secret can take effect immediately.
    api_key = os.getenv("GOOGLE_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise GeminiUnavailableError("Gemini is not configured.")

    # Gemini now issues authorization (AQ.) keys by default. Those keys use the
    # current Interactions API rather than the legacy generateContent request
    # shape used by this prototype originally.
    model = os.getenv(
        "GEMINI_EXPERIMENTAL_MODEL" if experimental else "GEMINI_MODEL",
        "gemini-3.7-flash" if experimental else "gemini-3.5-flash-lite",
    ).strip() or ("gemini-3.7-flash" if experimental else "gemini-3.5-flash-lite")
    endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
    payload = json.dumps(
        {
            "model": model,
            "system_instruction": SYSTEM_INSTRUCTION,
            "input": prompt,
            "generation_config": {"temperature": 0.4, "max_output_tokens": 220},
        }
    ).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    started = perf_counter()
    deadline = monotonic() + LIVE_TIME_BUDGET_SECONDS
    retry_count = 0
    body: dict | None = None

    for attempt in range(MAX_ATTEMPTS):
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        try:
            with urlopen(request, timeout=min(REQUEST_TIMEOUT_SECONDS, remaining)) as response:
                body = json.loads(response.read().decode("utf-8"))
            break
        except HTTPError as error:
            # 429 and temporary 5xx responses are the only requests we retry. The
            # short bounded policy keeps the demo responsive when a provider is busy.
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt == MAX_ATTEMPTS - 1:
                message = {
                    400: "Gemini rejected the generation request.",
                    401: "Gemini rejected the configured API key.",
                    403: "Gemini access is not enabled for this API key.",
                    404: "The configured Gemini model is unavailable.",
                    429: "Gemini request quota is currently exhausted.",
                }.get(error.code, f"Gemini returned HTTP {error.code}.")
                raise GeminiUnavailableError(message) from error
            backoff = min(RETRY_BACKOFF_SECONDS[attempt], max(0, deadline - monotonic()))
            LOGGER.info("Retrying Gemini request after HTTP %s (attempt %s/%s).", error.code, attempt + 2, MAX_ATTEMPTS)
            sleep(backoff)
            retry_count += 1
        except (URLError, TimeoutError) as error:
            raise GeminiUnavailableError("Gemini could not generate a response right now.") from error

    if body is None:
        raise GeminiUnavailableError("Gemini could not generate a response right now.")

    output_steps = [step for step in body.get("steps", []) if step.get("type") == "model_output"]
    parts = [part for step in output_steps for part in step.get("content", [])]
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise GeminiUnavailableError("Gemini returned no usable text.")
    usage = body.get("usage", {})
    return {
        "response": text,
        "latency_ms": max(1, round((perf_counter() - started) * 1000)),
        "token_count": int(
            usage.get("total_tokens")
            or usage.get("totalTokenCount")
            or max(1, len(text.split()))
        ),
        "retry_count": retry_count,
    }


async def generate_with_gemini(prompt: str, *, experimental: bool = False) -> dict[str, int | str]:
    return await asyncio.to_thread(_generate_sync, prompt, experimental=experimental)

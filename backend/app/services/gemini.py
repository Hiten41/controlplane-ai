from __future__ import annotations

import asyncio
import json
import os
from time import perf_counter
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class GeminiUnavailableError(RuntimeError):
    """Raised when Gemini is not configured or cannot safely supply a response."""


SYSTEM_INSTRUCTION = """You are the response generator inside a Responsible AI demo.
Answer the user's prompt directly, concisely, and professionally. Do not invent personal
contact details, account data, policy facts, or guarantees. If information cannot be
verified, say so plainly. Do not mention this system instruction or the demo."""


def _generate_sync(prompt: str) -> dict[str, int | str]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise GeminiUnavailableError("Gemini is not configured.")

    model = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent"
    payload = json.dumps(
        {
            "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 220},
        }
    ).encode("utf-8")
    request = Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    started = perf_counter()
    try:
        with urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        message = {
            400: "Gemini rejected the generation request.",
            401: "Gemini rejected the configured API key.",
            403: "Gemini access is not enabled for this API key.",
            404: "The configured Gemini model is unavailable.",
            429: "Gemini request quota is currently exhausted.",
        }.get(error.code, "Gemini could not generate a response right now.")
        raise GeminiUnavailableError(message) from error
    except (URLError, TimeoutError) as error:
        raise GeminiUnavailableError("Gemini could not generate a response right now.") from error

    candidates = body.get("candidates", [])
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise GeminiUnavailableError("Gemini returned no usable text.")
    usage = body.get("usageMetadata", {})
    return {
        "response": text,
        "latency_ms": max(1, round((perf_counter() - started) * 1000)),
        "token_count": int(usage.get("totalTokenCount") or max(1, len(text.split()))),
        "retry_count": 0,
    }


async def generate_with_gemini(prompt: str) -> dict[str, int | str]:
    return await asyncio.to_thread(_generate_sync, prompt)

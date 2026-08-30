from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.services.gemini import GeminiUnavailableError, _generate_sync


class GeminiConfigurationTests(unittest.TestCase):
    def test_missing_key_never_attempts_a_provider_call(self) -> None:
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}, clear=False):
            with self.assertRaises(GeminiUnavailableError):
                _generate_sync("Hello")

    def test_uses_interactions_api_for_authorization_keys(self) -> None:
        class FakeResponse:
            def read(self) -> bytes:
                return b'{"steps":[{"type":"model_output","content":[{"type":"text","text":"Hello from Gemini."}]}],"usage":{"total_tokens":17}}'

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        with patch.dict(os.environ, {"GEMINI_API_KEY": "AQ.test", "GEMINI_MODEL": ""}, clear=False):
            with patch("app.services.gemini.urlopen", return_value=FakeResponse()) as mocked_urlopen:
                result = _generate_sync("Hello")

        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://generativelanguage.googleapis.com/v1beta/interactions")
        self.assertEqual(result["response"], "Hello from Gemini.")
        self.assertEqual(result["token_count"], 17)

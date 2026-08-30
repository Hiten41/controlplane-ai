from __future__ import annotations

import os
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

from app.services.gemini import GeminiUnavailableError, _generate_sync


class GeminiConfigurationTests(unittest.TestCase):
    def test_missing_key_never_attempts_a_provider_call(self) -> None:
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}, clear=False):
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

    def test_retries_transient_provider_errors_at_most_twice(self) -> None:
        class FakeResponse:
            def read(self) -> bytes:
                return b'{"steps":[{"type":"model_output","content":[{"type":"text","text":"Recovered."}]}]}'

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        transient_error = HTTPError("https://example.test", 503, "busy", None, None)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "AQ.test"}, clear=False):
            with patch("app.services.gemini.urlopen", side_effect=[transient_error, transient_error, FakeResponse()]) as mocked_urlopen:
                with patch("app.services.gemini.sleep") as mocked_sleep:
                    result = _generate_sync("Hello")

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(mocked_sleep.call_args_list[0].args[0], 0.8)
        self.assertEqual(mocked_sleep.call_args_list[1].args[0], 1.5)
        self.assertEqual(result["response"], "Recovered.")
        self.assertEqual(result["retry_count"], 2)

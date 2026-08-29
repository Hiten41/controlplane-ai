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

"""Google Gemini provider."""

from __future__ import annotations

from typing import Optional

import requests

from .base import BaseProvider, clean_llm_output


class GeminiProvider(BaseProvider):
    id = "gemini"
    display_name = "Google Gemini"

    DEFAULT_MODELS = [
        {"name": "gemini-2.0-flash", "label": "Gemini 2.0 Flash"},
        {"name": "gemini-1.5-pro", "label": "Gemini 1.5 Pro"},
        {"name": "gemini-1.5-flash", "label": "Gemini 1.5 Flash"},
    ]

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key

    def _key(self, api_key: Optional[str] = None) -> str:
        key = api_key or self.api_key
        if not key:
            raise RuntimeError("Gemini API key not configured")
        return key

    def generate(self, prompt: str, model: str) -> str:
        key = self._key()
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={key}"
        )
        res = requests.post(
            url,
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=120,
        )
        res.raise_for_status()
        candidates = res.json().get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        return clean_llm_output("".join(p.get("text", "") for p in parts))

    def test(self, api_key: Optional[str] = None) -> tuple[bool, str]:
        try:
            key = self._key(api_key)
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
            res = requests.get(url, timeout=15)
            if res.status_code == 200:
                return True, "Key is valid"
            if res.status_code in (401, 403):
                return False, "Invalid API key"
            return False, f"Error {res.status_code}"
        except Exception as e:
            return False, f"Connection error: {e}"

    def list_models(self, api_key: Optional[str] = None) -> list[dict]:
        return [{"name": m["name"], "label": m["label"]} for m in self.DEFAULT_MODELS]

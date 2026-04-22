"""OpenAI provider."""

from __future__ import annotations

from typing import Optional

import requests

from .base import BaseProvider, clean_llm_output


class OpenAIProvider(BaseProvider):
    id = "openai"
    display_name = "OpenAI"

    DEFAULT_MODELS = [
        {"name": "gpt-4o", "label": "GPT-4o"},
        {"name": "gpt-4o-mini", "label": "GPT-4o mini"},
        {"name": "gpt-4-turbo", "label": "GPT-4 Turbo"},
    ]

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key

    def _headers(self, api_key: Optional[str] = None) -> dict:
        key = api_key or self.api_key
        if not key:
            raise RuntimeError("OpenAI API key not configured")
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def generate(self, prompt: str, model: str) -> str:
        res = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=self._headers(),
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 1024,
            },
            timeout=120,
        )
        res.raise_for_status()
        return clean_llm_output(res.json()["choices"][0]["message"]["content"])

    def test(self, api_key: Optional[str] = None) -> tuple[bool, str]:
        try:
            res = requests.get(
                "https://api.openai.com/v1/models",
                headers=self._headers(api_key),
                timeout=15,
            )
            if res.status_code == 200:
                return True, "Key is valid"
            if res.status_code == 401:
                return False, "Invalid API key"
            return False, f"Error {res.status_code}"
        except Exception as e:
            return False, f"Connection error: {e}"

    def list_models(self, api_key: Optional[str] = None) -> list[dict]:
        return [{"name": m["name"], "label": m["label"]} for m in self.DEFAULT_MODELS]

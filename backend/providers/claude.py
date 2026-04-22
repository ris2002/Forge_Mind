"""Anthropic Claude provider."""

from __future__ import annotations

from typing import Optional

import requests

from .base import BaseProvider, clean_llm_output


class ClaudeProvider(BaseProvider):
    id = "claude"
    display_name = "Anthropic Claude"

    DEFAULT_MODELS = [
        {"name": "claude-opus-4-7", "label": "Claude Opus 4.7"},
        {"name": "claude-opus-4-6", "label": "Claude Opus 4.6"},
        {"name": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6"},
        {"name": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5"},
    ]

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key

    def _headers(self, api_key: Optional[str] = None) -> dict:
        key = api_key or self.api_key
        if not key:
            raise RuntimeError("Claude API key not configured")
        return {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def generate(self, prompt: str, model: str) -> str:
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=self._headers(),
            json={
                "model": model,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=120,
        )
        res.raise_for_status()
        data = res.json()
        text = "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )
        return clean_llm_output(text)

    def test(self, api_key: Optional[str] = None) -> tuple[bool, str]:
        try:
            res = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers=self._headers(api_key),
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 5,
                    "messages": [{"role": "user", "content": "ping"}],
                },
                timeout=15,
            )
            if res.status_code == 200:
                return True, "Key is valid"
            if res.status_code == 401:
                return False, "Invalid API key"
            return False, f"Error {res.status_code}: {res.text[:120]}"
        except Exception as e:
            return False, f"Connection error: {e}"

    def list_models(self, api_key: Optional[str] = None) -> list[dict]:
        return [{"name": m["name"], "label": m["label"]} for m in self.DEFAULT_MODELS]

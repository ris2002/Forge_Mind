"""Ollama — local, default provider."""

from __future__ import annotations

import json
from typing import Optional

import requests

from .base import BaseProvider, clean_llm_output

OLLAMA_URL = "http://localhost:11434"
_OPTIONS = {"num_predict": 300, "num_ctx": 2048}


class OllamaProvider(BaseProvider):
    id = "ollama"
    display_name = "Ollama (local)"
    requires_api_key = False
    is_local = True

    def generate(self, prompt: str, model: str) -> str:
        res = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False, "options": _OPTIONS},
            timeout=120,
        )
        res.raise_for_status()
        return clean_llm_output(res.json().get("response", "").strip())

    def generate_stream(self, prompt: str, model: str):
        res = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model, "prompt": prompt, "stream": True, "options": _OPTIONS},
            stream=True,
            timeout=120,
        )
        res.raise_for_status()
        for line in res.iter_lines():
            if not line:
                continue
            data = json.loads(line)
            token = data.get("response", "")
            if token:
                yield token
            if data.get("done"):
                break

    def test(self, api_key: Optional[str] = None) -> tuple[bool, str]:
        try:
            r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
            r.raise_for_status()
            return True, "Ollama is running"
        except Exception as e:
            return False, f"Ollama not reachable: {e}"

    def list_models(self, api_key: Optional[str] = None) -> list[dict]:
        try:
            r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
            r.raise_for_status()
            return [
                {"name": m["name"], "size": m.get("size", 0)}
                for m in r.json().get("models", [])
            ]
        except Exception:
            return []

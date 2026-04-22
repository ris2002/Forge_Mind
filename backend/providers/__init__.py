"""
Provider registry.

To add a new LLM provider:
  1. Create providers/<n>.py subclassing BaseProvider
  2. Import and add to PROVIDERS below
  3. Add a default model in core/settings.py GLOBAL_DEFAULTS["models"]
"""

from __future__ import annotations

from typing import Optional

from .base import BaseProvider
from .ollama import OllamaProvider
from .claude import ClaudeProvider
from .openai import OpenAIProvider
from .gemini import GeminiProvider

PROVIDERS: dict[str, type[BaseProvider]] = {
    "ollama": OllamaProvider,
    "claude": ClaudeProvider,
    "openai": OpenAIProvider,
    "gemini": GeminiProvider,
}


def get_provider(provider_id: str, api_key: Optional[str] = None) -> BaseProvider:
    if provider_id not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider_id}")
    cls = PROVIDERS[provider_id]
    return cls(api_key=api_key) if cls.requires_api_key else cls()


__all__ = ["PROVIDERS", "get_provider", "BaseProvider"]

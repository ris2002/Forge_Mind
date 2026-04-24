"""Base class that every LLM provider implements."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Optional


def clean_llm_output(text: str) -> str:
    """Strip <think> blocks and trim. Shared by providers that emit reasoning traces."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"</?think>", "", text)
    return text.strip()


class BaseProvider(ABC):
    id: str = ""
    display_name: str = ""
    requires_api_key: bool = True
    is_local: bool = False

    @abstractmethod
    def generate(self, prompt: str, model: str) -> str: ...

    def generate_stream(self, prompt: str, model: str):
        """Yield tokens one by one. Default: single chunk from generate()."""
        yield self.generate(prompt, model)

    @abstractmethod
    def test(self, api_key: Optional[str] = None) -> tuple[bool, str]: ...

    @abstractmethod
    def list_models(self, api_key: Optional[str] = None) -> list[dict]: ...

"""
LLM dispatch — the function every module calls to talk to a model.

Modules MUST NOT import specific providers. They call `llm_generate(prompt)`
and get back a string. The active provider and model are global settings.
"""

from fastapi import HTTPException

from . import settings as app_settings
from . import secret_store
from providers import get_provider


def llm_stream(prompt: str):
    """Yield tokens one by one. Falls back to a single chunk for non-streaming providers."""
    pid = app_settings.get("active_provider", "ollama")
    models = app_settings.get("models", {})
    model = models.get(pid)
    if not model:
        raise HTTPException(status_code=500, detail=f"No model configured for provider {pid}")
    api_key = None
    cls = _provider_class(pid)
    if cls.requires_api_key:
        api_key = secret_store.get_key(pid)
        if not api_key:
            raise HTTPException(status_code=400, detail=f"No API key configured for {pid}.")
    try:
        provider = get_provider(pid, api_key=api_key)
        yield from provider.generate_stream(prompt, model=model)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{pid} error: {e}")


def llm_generate(prompt: str) -> str:
    pid = app_settings.get("active_provider", "ollama")
    models = app_settings.get("models", {})
    model = models.get(pid)
    if not model:
        raise HTTPException(status_code=500, detail=f"No model configured for provider {pid}")

    api_key = None
    cls = _provider_class(pid)
    if cls.requires_api_key:
        api_key = secret_store.get_key(pid)
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail=f"No API key configured for {pid}. Add one in Settings.",
            )
    try:
        provider = get_provider(pid, api_key=api_key)
        return provider.generate(prompt, model=model)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{pid} error: {e}")


def _provider_class(pid: str):
    from providers import PROVIDERS
    if pid not in PROVIDERS:
        raise HTTPException(status_code=500, detail=f"Unknown provider: {pid}")
    return PROVIDERS[pid]

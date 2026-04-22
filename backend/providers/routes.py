"""Routes for provider management — /api/providers/*."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import settings as app_settings
from core import secret_store

from . import PROVIDERS, get_provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ── models ──────────────────────────────────────────
class ActiveProviderIn(BaseModel):
    provider_id: str


class ProviderKeyIn(BaseModel):
    provider_id: str
    api_key: str


class ProviderModelIn(BaseModel):
    provider_id: str
    model: str


# ── routes ──────────────────────────────────────────
@router.get("")
def list_providers():
    """All providers + config + availability state."""
    keys = secret_store.load_keys()
    active = app_settings.get("active_provider", "ollama")
    models = app_settings.get("models", {})
    out = []
    for pid, cls in PROVIDERS.items():
        has_key = bool(keys.get(pid))
        configured = (not cls.requires_api_key) or has_key
        out.append({
            "id": pid,
            "display_name": cls.display_name,
            "is_local": cls.is_local,
            "requires_api_key": cls.requires_api_key,
            "has_key": has_key,
            "configured": configured,
            "active": active == pid,
            "model": models.get(pid, ""),
        })
    return {"providers": out, "active": active}


@router.get("/{provider_id}/models")
def provider_models(provider_id: str):
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    api_key = secret_store.get_key(provider_id)
    try:
        provider = get_provider(provider_id, api_key=api_key)
        return {"models": provider.list_models(api_key=api_key)}
    except Exception as e:
        return {"models": [], "error": str(e)}


@router.post("/key")
def set_provider_key(body: ProviderKeyIn):
    if body.provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    if not PROVIDERS[body.provider_id].requires_api_key:
        raise HTTPException(status_code=400, detail="This provider does not use an API key")
    secret_store.save_key(body.provider_id, body.api_key)
    return {"saved": True, "provider_id": body.provider_id}


@router.delete("/key/{provider_id}")
def remove_provider_key(provider_id: str):
    secret_store.delete_key(provider_id)
    return {"removed": True, "provider_id": provider_id}


@router.post("/test")
def test_provider(body: ProviderKeyIn):
    if body.provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    try:
        provider = get_provider(body.provider_id, api_key=body.api_key or None)
        ok, msg = provider.test(api_key=body.api_key or None)
        return {"ok": ok, "message": msg}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.post("/active")
def set_active_provider(body: ActiveProviderIn):
    if body.provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    cls = PROVIDERS[body.provider_id]
    if cls.requires_api_key and not secret_store.get_key(body.provider_id):
        raise HTTPException(
            status_code=400,
            detail=f"Add an API key for {cls.display_name} before activating it.",
        )
    app_settings.set_value("active_provider", body.provider_id)
    return {"active_provider": body.provider_id}


@router.post("/model")
def set_provider_model(body: ProviderModelIn):
    if body.provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    models = app_settings.get("models", {}) or {}
    models[body.provider_id] = body.model
    app_settings.set_value("models", models)
    return {"provider_id": body.provider_id, "model": body.model}

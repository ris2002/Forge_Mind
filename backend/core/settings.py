"""
Settings store with scopes.

Global settings: active provider, per-provider model choice.
Module settings: every module gets its own namespace under `modules.<id>`.

Modules should only touch their own namespace — the helper `module_settings(id)`
returns a scoped view that hides the global structure.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import DATA_DIR

SETTINGS_FILE = DATA_DIR / "settings.json"

# Global defaults only. Module defaults live in each module's package.
GLOBAL_DEFAULTS: dict[str, Any] = {
    "active_provider": "ollama",
    "models": {
        "ollama": "qwen2.5:1.5b",
        "claude": "claude-haiku-4-5-20251001",
        "openai": "gpt-4o-mini",
        "gemini": "gemini-2.0-flash",
    },
    "modules": {},  # filled in lazily by modules as they register
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursive dict merge. `override` wins on scalar keys."""
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_all() -> dict:
    if SETTINGS_FILE.exists():
        try:
            stored = json.loads(SETTINGS_FILE.read_text())
            return _deep_merge(GLOBAL_DEFAULTS, stored)
        except Exception:
            pass
    return dict(GLOBAL_DEFAULTS)


def save_all(data: dict) -> None:
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def get(key: str, default: Any = None) -> Any:
    """Read a top-level global setting."""
    return load_all().get(key, default)


def set_value(key: str, value: Any) -> None:
    data = load_all()
    data[key] = value
    save_all(data)


# ─────────────────────────────────────────────────────────────
# Module-scoped settings
# ─────────────────────────────────────────────────────────────
class ModuleSettings:
    """
    Scoped settings for a single module. The module passes its own defaults
    on construction; defaults are merged on every read so adding new keys in
    future versions doesn't break existing installs.
    """

    def __init__(self, module_id: str, defaults: dict):
        self.module_id = module_id
        self.defaults = defaults

    def load(self) -> dict:
        all_settings = load_all()
        stored = all_settings.get("modules", {}).get(self.module_id, {})
        return _deep_merge(self.defaults, stored)

    def save(self, data: dict) -> None:
        all_settings = load_all()
        all_settings.setdefault("modules", {})[self.module_id] = data
        save_all(all_settings)

    def get(self, key: str, default: Any = None) -> Any:
        return self.load().get(key, default)

    def set(self, key: str, value: Any) -> None:
        data = self.load()
        data[key] = value
        self.save(data)


def module_settings(module_id: str, defaults: dict) -> ModuleSettings:
    return ModuleSettings(module_id, defaults)

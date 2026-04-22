"""Module-scoped settings. Defaults live in this module, not in core."""

from __future__ import annotations

from core.config import DATA_DIR
from core.settings import module_settings

MODULE_ID = "mailmind"

DEFAULTS = {
    "user_name": "Rishil",
    "user_title": "AI Engineer",
    "work_start": "09:00",
    "work_end": "18:00",
    "check_interval": 30,
    "chroma_path": str(DATA_DIR / "mailmind_chroma"),
}

settings = module_settings(MODULE_ID, DEFAULTS)

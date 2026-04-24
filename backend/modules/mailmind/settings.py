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
    "system_prompt": (
        "Be concise and professional. "
        "Get to the point in the first sentence — no filler openers like 'I hope this email finds you well'. "
        "Match the tone of the sender: formal if they are formal, relaxed if they are casual. "
        "Never use placeholders or make up facts not given. "
        "Keep replies under 150 words unless the topic genuinely requires more."
    ),
}

settings = module_settings(MODULE_ID, DEFAULTS)

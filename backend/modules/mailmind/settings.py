"""Module-scoped settings. Defaults live in this module, not in core."""

from __future__ import annotations

from core.settings import module_settings

MODULE_ID = "mailmind"

DEFAULTS = {
    "user_name": "Your Name",
    "user_title": "Your Title",
    "work_start": "09:00",
    "work_end": "18:00",
    "check_interval": 30,
    "chroma_path": "",  # set by user in Settings → MailMind after workspace is confirmed
    "system_prompt": "",  # leave blank to use the built-in default rules
}

settings = module_settings(MODULE_ID, DEFAULTS)

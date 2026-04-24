"""Email store + blocklist — file-backed JSON storage scoped to this module."""

from __future__ import annotations

import json
from filelock import FileLock

from core.config import DATA_DIR

EMAIL_STORE_FILE = DATA_DIR / "mailmind_emails.json"
BLOCKLIST_FILE = DATA_DIR / "mailmind_blocklist.json"
_EMAIL_LOCK = FileLock(str(EMAIL_STORE_FILE) + ".lock")

PROMO_KEYWORDS = [
    "noreply", "no-reply", "newsletter", "marketing", "unsubscribe",
    "donotreply", "do-not-reply", "mailer", "mailchimp", "sendgrid",
    "amazonses", "jobmails", "digest@", "jobs@", "recruitment",
    "threadloom", "jobboard",
]


# ── email store ─────────────────────────────────────────────
def load_emails() -> dict:
    with _EMAIL_LOCK:
        if EMAIL_STORE_FILE.exists():
            try:
                return json.loads(EMAIL_STORE_FILE.read_text())
            except Exception:
                return {}
        return {}


def save_emails(store: dict) -> None:
    with _EMAIL_LOCK:
        EMAIL_STORE_FILE.write_text(json.dumps(store, indent=2))


# ── blocklist ───────────────────────────────────────────────
def load_blocklist() -> list[str]:
    if BLOCKLIST_FILE.exists():
        try:
            return json.loads(BLOCKLIST_FILE.read_text())
        except Exception:
            return []
    return []


def save_blocklist(bl: list[str]) -> None:
    BLOCKLIST_FILE.write_text(json.dumps(bl, indent=2))


def is_blocked(sender_email: str, sender_name: str) -> bool:
    combined = (sender_email + " " + sender_name).lower()
    return any(entry.lower().strip() in combined for entry in load_blocklist())


def is_promo(sender: str, subject: str) -> bool:
    combined = (sender + " " + subject).lower()
    return any(k in combined for k in PROMO_KEYWORDS)

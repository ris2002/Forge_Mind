"""
Gmail IMAP/SMTP adapter.

Credentials are stored encrypted via core.secret_store (Fernet).
On first load, any legacy plaintext email_creds.json is migrated and deleted.
"""

from __future__ import annotations

import imaplib
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from core.config import DATA_DIR
from core import secret_store

_LEGACY_CREDS_FILE = DATA_DIR / "email_creds.json"
_KEY_EMAIL = "gmail_email"
_KEY_PASSWORD = "gmail_app_password"


def _migrate_legacy() -> None:
    """Move plaintext email_creds.json into the encrypted store, then delete it."""
    if not _LEGACY_CREDS_FILE.exists():
        return
    try:
        data = json.loads(_LEGACY_CREDS_FILE.read_text())
        secret_store.save_key(_KEY_EMAIL, data["email"])
        secret_store.save_key(_KEY_PASSWORD, data["app_password"])
        _LEGACY_CREDS_FILE.unlink()
    except Exception as e:
        print(f"[gmail] legacy credential migration failed: {e}")


def load_creds() -> Optional[dict]:
    _migrate_legacy()
    email = secret_store.get_key(_KEY_EMAIL)
    password = secret_store.get_key(_KEY_PASSWORD)
    if email and password:
        return {"email": email, "app_password": password}
    return None


def save_creds(email_addr: str, app_password: str) -> None:
    secret_store.save_key(_KEY_EMAIL, email_addr)
    secret_store.save_key(_KEY_PASSWORD, app_password)


def clear_creds() -> None:
    secret_store.delete_key(_KEY_EMAIL)
    secret_store.delete_key(_KEY_PASSWORD)
    if _LEGACY_CREDS_FILE.exists():
        _LEGACY_CREDS_FILE.unlink()


def test_connection(email_addr: str, app_password: str) -> None:
    """Raises imaplib.IMAP4.error on failure."""
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(email_addr, app_password)
    mail.logout()


def get_imap() -> imaplib.IMAP4_SSL:
    """Return an authenticated IMAP connection, or raise if creds missing/bad."""
    creds = load_creds()
    if not creds:
        raise RuntimeError("Not authenticated")
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(creds["email"], creds["app_password"])
    return mail


def send_mail(to_addr: str, subject: str, body: str) -> None:
    creds = load_creds()
    if not creds:
        raise RuntimeError("Not authenticated")
    msg = MIMEMultipart()
    msg["From"] = creds["email"]
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(creds["email"], creds["app_password"])
        server.send_message(msg)

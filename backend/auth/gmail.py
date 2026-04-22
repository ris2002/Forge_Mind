"""
Gmail IMAP/SMTP adapter.

Keeps the raw mail connection logic separate from the HTTP routes and
from any module that needs to use it.
"""

from __future__ import annotations

import imaplib
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from core.config import DATA_DIR

CREDS_FILE = DATA_DIR / "email_creds.json"


def load_creds() -> Optional[dict]:
    if CREDS_FILE.exists():
        return json.loads(CREDS_FILE.read_text())
    return None


def save_creds(email_addr: str, app_password: str) -> None:
    CREDS_FILE.write_text(json.dumps({"email": email_addr, "app_password": app_password}))


def clear_creds() -> None:
    if CREDS_FILE.exists():
        CREDS_FILE.unlink()


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

"""MailMind business logic. Routes call these — they stay thin."""

from __future__ import annotations

import email as email_lib
from typing import Any

from core.llm import llm_generate
from auth import gmail

from . import parsing
from . import store
from . import chroma
from . import prompts
from .settings import settings as module_settings


# ─────────────────────────────────────────────────────────────
# Fetch
# ─────────────────────────────────────────────────────────────
def fetch_inbox() -> list[dict]:
    """Fetch unread emails from Gmail IMAP and merge into the local store."""
    mail = gmail.get_imap()
    mail.select("INBOX")
    _, data = mail.search(None, "UNSEEN")
    email_ids = data[0].split()[-10:]

    emails = store.load_emails()

    for eid in reversed(email_ids):
        eid_str = eid.decode()
        if eid_str in emails:
            continue
        try:
            _, msg_data = mail.fetch(eid, "(RFC822)")
            raw = msg_data[0][1]
            msg = email_lib.message_from_bytes(raw)

            subject = parsing.decode_mime_header(msg.get("Subject", "(no subject)"))
            sender_full = parsing.decode_mime_header(msg.get("From", "Unknown"))
            date_raw = msg.get("Date", "")
            time_clean = parsing.format_email_time(date_raw)

            sender_email_addr = (
                sender_full.split("<")[-1].replace(">", "").strip()
                if "<" in sender_full else sender_full
            )

            if store.is_promo(sender_full, subject):
                continue
            if store.is_blocked(sender_email_addr, sender_full):
                continue

            body = parsing.extract_body(msg)
            sender_name, sender_first = parsing.extract_real_name(sender_full)

            emails[eid_str] = {
                "id": eid_str,
                "sender": sender_name,
                "sender_first": sender_first,
                "sender_email": sender_email_addr,
                "subject": subject,
                "summary": "",
                "body": body[:3000],
                "time": time_clean,
                "time_raw": date_raw,
                "read": False,
                "flagged": False,
                "summarised": False,
            }
        except Exception as e:
            print(f"[mailmind.fetch] failed {eid_str}: {e}")
            continue

    mail.logout()
    store.save_emails(emails)

    all_emails = list(emails.values())
    all_emails.sort(
        key=lambda e: (parsing.parse_date(e.get("time_raw", "")) or 0)
        and parsing.parse_date(e.get("time_raw", "")).timestamp(),
        reverse=True,
    )
    return all_emails


# ─────────────────────────────────────────────────────────────
# Read / filter
# ─────────────────────────────────────────────────────────────
def list_emails(
    date_from: str | None = None,
    date_to: str | None = None,
    flagged_only: bool = False,
) -> list[dict]:
    from datetime import datetime

    emails = list(store.load_emails().values())
    if flagged_only:
        emails = [e for e in emails if e.get("flagged")]

    def _apply_bound(items, bound_str, cmp):
        try:
            bound = datetime.strptime(bound_str, "%Y-%m-%d").date()
        except Exception:
            return items
        out = []
        for e in items:
            dt = parsing.parse_date(e.get("time_raw", ""))
            if dt and cmp(dt.date(), bound):
                out.append(e)
            elif not dt:
                out.append(e)
        return out

    if date_from:
        emails = _apply_bound(emails, date_from, lambda a, b: a >= b)
    if date_to:
        emails = _apply_bound(emails, date_to, lambda a, b: a <= b)

    emails.sort(
        key=lambda e: parsing.parse_date(e.get("time_raw", "")).timestamp()
        if parsing.parse_date(e.get("time_raw", "")) else 0,
        reverse=True,
    )
    return emails


# ─────────────────────────────────────────────────────────────
# Mutations
# ─────────────────────────────────────────────────────────────
def summarise(email_id: str) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")
    if data.get("summarised"):
        return {"summary": data["summary"]}

    user_name = module_settings.get("user_name", "Rishil")
    prompt = prompts.summary_prompt(
        sender=data.get("sender", ""),
        subject=data.get("subject", ""),
        body=data.get("body", ""),
        user_name=user_name,
    )
    summary = llm_generate(prompt)
    emails[email_id]["summary"] = summary
    emails[email_id]["summarised"] = True
    store.save_emails(emails)
    return {"summary": summary}


def toggle_flag(email_id: str) -> dict:
    emails = store.load_emails()
    if email_id not in emails:
        raise LookupError("Email not found")
    new_flagged = not emails[email_id].get("flagged", False)
    emails[email_id]["flagged"] = new_flagged
    store.save_emails(emails)

    chroma_path = module_settings.get("chroma_path", "")
    if chroma_path:
        if new_flagged:
            chroma.embed_email(emails[email_id], chroma_path)
        else:
            chroma.delete_embedding(email_id, chroma_path)
    return {"flagged": new_flagged}


def dismiss(email_id: str, delete_embeddings: bool = False) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if data and data.get("flagged") and delete_embeddings:
        chroma_path = module_settings.get("chroma_path", "")
        if chroma_path:
            chroma.delete_embedding(email_id, chroma_path)
    if email_id in emails:
        del emails[email_id]
        store.save_emails(emails)
    return {"dismissed": True}


def block_sender(email_id: str) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")
    sender_email = data.get("sender_email", "")
    bl = store.load_blocklist()
    if sender_email and sender_email.lower() not in bl:
        bl.append(sender_email.lower())
        store.save_blocklist(bl)
    if email_id in emails:
        del emails[email_id]
        store.save_emails(emails)
    return {"blocked": sender_email, "blocklist": bl}


# ─────────────────────────────────────────────────────────────
# Reply
# ─────────────────────────────────────────────────────────────
def draft_reply(email_id: str, user_intent: str) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")

    user_name = module_settings.get("user_name", "Rishil")
    user_title = module_settings.get("user_title", "AI Engineer")
    context = data.get("summary") or data.get("body", "")[:400]

    thread_context = ""
    if data.get("flagged"):
        chroma_path = module_settings.get("chroma_path", "")
        if chroma_path:
            thread_context = chroma.query_similar(
                data["sender"], data["subject"], chroma_path
            )

    prompt = prompts.reply_prompt(
        user_name=user_name,
        user_title=user_title,
        sender_first=data.get("sender_first", "there"),
        subject=data["subject"],
        context=context,
        user_intent=user_intent,
        thread_context=thread_context,
    )
    return {"draft": llm_generate(prompt)}


def send_reply(email_id: str, draft: str) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")
    gmail.send_mail(
        to_addr=data["sender_email"],
        subject=f"Re: {data['subject']}",
        body=draft,
    )
    emails[email_id]["read"] = True
    store.save_emails(emails)
    return {"sent": True}


# ─────────────────────────────────────────────────────────────
# Blocklist (CRUD)
# ─────────────────────────────────────────────────────────────
def get_blocklist() -> dict:
    return {"blocklist": store.load_blocklist()}


def add_to_blocklist(entry: str) -> dict:
    bl = store.load_blocklist()
    entry = entry.strip().lower()
    if entry and entry not in bl:
        bl.append(entry)
        store.save_blocklist(bl)
    return {"blocklist": bl}


def remove_from_blocklist(entry: str) -> dict:
    bl = [e for e in store.load_blocklist() if e != entry.strip().lower()]
    store.save_blocklist(bl)
    return {"blocklist": bl}


# ─────────────────────────────────────────────────────────────
# Daemon (stub)
# ─────────────────────────────────────────────────────────────
_daemon_state: dict[str, Any] = {
    "running": False, "paused": False, "last_check": "—", "next_check": "—",
}


def daemon_status() -> dict:
    return {
        **_daemon_state,
        "provider": __import__("core.settings", fromlist=["get"]).get("active_provider", "ollama"),
    }


def start_daemon() -> dict:
    _daemon_state["running"] = True
    return {"started": True}


def pause_daemon() -> dict:
    _daemon_state["paused"] = True
    return {"paused": True}


def resume_daemon() -> dict:
    _daemon_state["paused"] = False
    return {"resumed": True}

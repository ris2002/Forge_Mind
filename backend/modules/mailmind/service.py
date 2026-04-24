"""MailMind business logic. Routes call these — they stay thin."""

from __future__ import annotations

import email as email_lib
import threading
import time
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from core.llm import llm_generate, llm_stream
from auth import gmail

from . import chroma
from . import parsing
from . import prompts
from . import store
from .settings import settings as module_settings


def _time_key(e: dict) -> float:
    dt = parsing.parse_date(e.get("time_raw", ""))
    return dt.timestamp() if dt else 0.0


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
    all_emails.sort(key=_time_key, reverse=True)
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

    emails.sort(key=_time_key, reverse=True)
    return emails


# ─────────────────────────────────────────────────────────────
# Mutations
# ─────────────────────────────────────────────────────────────
def summarise(email_id: str) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")
    if data.get("summarised") and data.get("summary"):
        return {"summary": data["summary"]}

    user_name = module_settings.get("user_name", "Rishil")
    prompt = prompts.summary_prompt(
        sender=data.get("sender", ""),
        subject=data.get("subject", ""),
        body=data.get("body", ""),
        user_name=user_name,
    )
    summary = llm_generate(prompt)

    if not summary.strip():
        raise HTTPException(status_code=500, detail="LLM returned an empty summary")

    emails = store.load_emails()
    if email_id in emails:
        emails[email_id]["summary"] = summary
        emails[email_id]["summarised"] = True
        store.save_emails(emails)
    return {"summary": summary}


def summarise_stream(email_id: str):
    """Yield summary tokens, save to store when done. Re-generates if cached summary is empty."""
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")
    if data.get("summarised") and data.get("summary"):
        yield data["summary"]
        return

    user_name = module_settings.get("user_name", "Rishil")
    prompt = prompts.summary_prompt(
        sender=data.get("sender", ""),
        subject=data.get("subject", ""),
        body=data.get("body", ""),
        user_name=user_name,
    )

    chunks = []
    try:
        for token in llm_stream(prompt):
            chunks.append(token)
            yield token
    except Exception as e:
        print(f"[mailmind.summarise_stream] LLM error: {e}")

    summary = "".join(chunks).strip()

    if not summary:
        # LLM returned nothing — build a plain-text extract so the user always gets something
        body = data.get("body", "").strip()
        sender = data.get("sender", "Unknown")
        subject = data.get("subject", "")
        if body:
            excerpt = " ".join(body[:300].split())
            summary = f"{sender}: {excerpt}…"
        else:
            summary = f"Email from {sender} — {subject or '(no subject)'}"
        yield summary

    emails = store.load_emails()
    if email_id in emails:
        emails[email_id]["summary"] = summary
        emails[email_id]["summarised"] = True
        store.save_emails(emails)


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

    s = module_settings.load()
    user_name = s.get("user_name", "Rishil")
    user_title = s.get("user_title", "AI Engineer")
    system_prompt = s.get("system_prompt", "")
    context = data.get("summary") or data.get("body", "")[:400]

    thread_context = ""
    if data.get("flagged"):
        chroma_path = s.get("chroma_path", "")
        if chroma_path:
            thread_context = chroma.query_similar(
                data.get("sender", ""), data.get("subject", ""), chroma_path
            )

    prompt = prompts.reply_prompt(
        user_name=user_name,
        user_title=user_title,
        sender_first=data.get("sender_first", "there"),
        subject=data.get("subject", "(no subject)"),
        context=context,
        user_intent=user_intent,
        thread_context=thread_context,
        system_prompt=system_prompt,
    )
    return {"draft": llm_generate(prompt)}


def send_reply(email_id: str, draft: str) -> dict:
    emails = store.load_emails()
    data = emails.get(email_id)
    if not data:
        raise LookupError("Email not found")
    gmail.send_mail(
        to_addr=data.get("sender_email", ""),
        subject=f"Re: {data.get('subject', '')}",
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
# Daemon — background inbox poller
# ─────────────────────────────────────────────────────────────
_daemon_state: dict[str, Any] = {
    "running": False, "paused": False, "last_check": "—", "next_check": "—",
}
_stop_event: threading.Event = threading.Event()


def _within_work_hours(work_start: str, work_end: str) -> bool:
    try:
        now = datetime.now().time()
        start = datetime.strptime(work_start, "%H:%M").time()
        end = datetime.strptime(work_end, "%H:%M").time()
        return start <= now < end
    except Exception:
        return True


def _daemon_loop(stop_event: threading.Event) -> None:
    last_fetch: float = 0.0  # 0 → fetch immediately on first tick

    while not stop_event.is_set():
        if _daemon_state["paused"]:
            # While paused reset timer so we fetch immediately on resume
            last_fetch = 0.0
            stop_event.wait(timeout=2)
            continue

        s = module_settings.load()
        interval_secs = int(s.get("check_interval", 30)) * 60
        now = time.time()

        if now - last_fetch >= interval_secs:
            work_start = s.get("work_start", "09:00")
            work_end = s.get("work_end", "18:00")

            if _within_work_hours(work_start, work_end):
                try:
                    fetch_inbox()
                    _daemon_state["last_check"] = datetime.now().strftime("%H:%M")
                except Exception as e:
                    print(f"[mailmind.daemon] fetch failed: {e}")
            else:
                print(f"[mailmind.daemon] outside work hours ({work_start}–{work_end}), skipping")

            last_fetch = time.time()
            interval_mins = int(module_settings.get("check_interval", 30))
            _daemon_state["next_check"] = (
                datetime.now().strftime("%H:%M") + f" +{interval_mins}m"
            )

        stop_event.wait(timeout=5)  # responsive to stop within 5 s

    _daemon_state["running"] = False
    _daemon_state["paused"] = False
    _daemon_state["next_check"] = "—"


def daemon_status() -> dict:
    from core import settings as app_settings
    return {
        **_daemon_state,
        "provider": app_settings.get("active_provider", "ollama"),
    }


def start_daemon() -> dict:
    global _stop_event
    if _daemon_state["running"]:
        return {"started": False, "reason": "already running"}
    _stop_event = threading.Event()
    _daemon_state["running"] = True
    _daemon_state["paused"] = False
    t = threading.Thread(
        target=_daemon_loop,
        args=(_stop_event,),
        daemon=True,
        name="mailmind-daemon",
    )
    t.start()
    return {"started": True}


def pause_daemon() -> dict:
    _daemon_state["paused"] = True
    return {"paused": True}


def resume_daemon() -> dict:
    _daemon_state["paused"] = False
    return {"resumed": True}


def stop_daemon() -> dict:
    _stop_event.set()  # signals the thread to exit, not just a flag check
    _daemon_state["paused"] = False
    return {"stopped": True}

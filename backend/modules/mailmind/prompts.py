"""Prompt templates for the MailMind module. Tweak here without touching logic."""

from __future__ import annotations


def summary_prompt(sender: str, subject: str, body: str, user_name: str = "you") -> str:
    return f"""You are reading an email sent to {user_name}. Extract the key facts.

From: {sender}
Subject: {subject}
Body: {body[:800]}

Write a 2-3 sentence summary that includes:
- The sender name and what they want
- Any specific times, dates, amounts, or options (list them exactly as written)
- What action {user_name} needs to take and by when

Summary:"""


def reply_prompt(
    user_name: str,
    user_title: str,
    sender_first: str,
    subject: str,
    context: str,
    user_intent: str,
    thread_context: str = "",
) -> str:
    return f"""You are {user_name}, {user_title}.
Write a real email reply. Use actual names. Never use placeholders like [Name] or [Company].

Replying to: {sender_first}
Subject: {subject}
What they said: {context}
Your key point: {user_intent}{thread_context}

Start with: Hi {sender_first},
End with: Best regards, {user_name}

Reply:"""

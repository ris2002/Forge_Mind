"""Routes for authentication — /api/auth/*."""

from __future__ import annotations

import imaplib

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import gmail

router = APIRouter(prefix="/api/auth", tags=["auth"])


class EmailAuthIn(BaseModel):
    email: str
    app_password: str


@router.get("/status")
def auth_status():
    return {"authenticated": gmail.load_creds() is not None}


@router.post("/connect")
def connect_email(body: EmailAuthIn):
    try:
        gmail.test_connection(body.email, body.app_password)
    except imaplib.IMAP4.error:
        raise HTTPException(status_code=401, detail="Connection failed.")
    gmail.save_creds(body.email, body.app_password)
    return {"connected": True, "email": body.email}


@router.post("/signout")
def signout():
    gmail.clear_creds()
    return {"success": True}

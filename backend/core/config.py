"""App-wide configuration constants. No logic lives here — just paths and metadata."""

from pathlib import Path

APP_NAME = "OpenClaw"
APP_VERSION = "0.2.0"

DATA_DIR = Path.home() / ".openclaw"
DATA_DIR.mkdir(exist_ok=True)

# CORS origins for the dev frontend and packaged desktop shells.
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "app://.",
]

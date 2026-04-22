"""
Local secret store for provider API keys and other sensitive values.

Stores JSON encrypted with Fernet. Master key lives alongside, chmod 600.
If `cryptography` isn't installed, falls back to plaintext with a warning.
"""

from __future__ import annotations

import json
import os
import stat
from typing import Optional

from .config import DATA_DIR

KEYS_ENC = DATA_DIR / "keys.enc"
KEYS_PLAIN = DATA_DIR / "keys.json"  # fallback only
MASTER_KEY = DATA_DIR / "master.key"


def _have_crypto() -> bool:
    try:
        import cryptography  # noqa: F401
        return True
    except ImportError:
        return False


def _get_fernet():
    from cryptography.fernet import Fernet
    if not MASTER_KEY.exists():
        MASTER_KEY.write_bytes(Fernet.generate_key())
        try:
            os.chmod(MASTER_KEY, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass
    return Fernet(MASTER_KEY.read_bytes())


def load_keys() -> dict:
    if _have_crypto() and KEYS_ENC.exists():
        try:
            f = _get_fernet()
            return json.loads(f.decrypt(KEYS_ENC.read_bytes()).decode("utf-8"))
        except Exception as e:
            print(f"[secret_store] decrypt failed: {e}")
            return {}
    if KEYS_PLAIN.exists():
        try:
            return json.loads(KEYS_PLAIN.read_text())
        except Exception:
            return {}
    return {}


def _write_keys(keys: dict) -> None:
    if _have_crypto():
        f = _get_fernet()
        KEYS_ENC.write_bytes(f.encrypt(json.dumps(keys).encode("utf-8")))
        try:
            os.chmod(KEYS_ENC, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass
        if KEYS_PLAIN.exists():
            try:
                KEYS_PLAIN.unlink()
            except Exception:
                pass
    else:
        print("[secret_store] WARNING: cryptography not installed — storing keys in plaintext")
        KEYS_PLAIN.write_text(json.dumps(keys, indent=2))
        try:
            os.chmod(KEYS_PLAIN, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            pass


def save_key(name: str, value: str) -> None:
    keys = load_keys()
    keys[name] = value
    _write_keys(keys)


def delete_key(name: str) -> None:
    keys = load_keys()
    if name in keys:
        del keys[name]
        _write_keys(keys)


def get_key(name: str) -> Optional[str]:
    return load_keys().get(name)

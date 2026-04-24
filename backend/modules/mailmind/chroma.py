"""ChromaDB vector store for flagged email context. Fails gracefully if chromadb isn't installed."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

_BLOCKED_PREFIXES = ("/etc", "/sys", "/proc", "/dev", "/usr", "/bin", "/sbin", "/boot")


def _safe_resolve(chroma_path: str) -> Optional[str]:
    resolved = str(Path(chroma_path).expanduser().resolve())
    if any(resolved.startswith(p) for p in _BLOCKED_PREFIXES):
        print(f"[mailmind.chroma] rejected unsafe chroma_path: {resolved}")
        return None
    return resolved


def _get_collection(chroma_path: str):
    """Lazy-import chromadb so the module works without it (feature is optional)."""
    try:
        import chromadb
    except ImportError:
        print("[mailmind.chroma] chromadb not installed — flagged-email memory disabled")
        return None

    try:
        resolved = _safe_resolve(chroma_path)
        if not resolved:
            return None
        Path(resolved).mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(path=resolved)
        return client.get_or_create_collection(
            name="email_threads",
            metadata={"hnsw:space": "cosine"},
        )
    except Exception as e:
        print(f"[mailmind.chroma] error: {e}")
        return None


def embed_email(email_data: dict, chroma_path: str) -> bool:
    collection = _get_collection(chroma_path)
    if not collection:
        return False
    try:
        doc = (
            f"From: {email_data['sender']}\n"
            f"Subject: {email_data['subject']}\n"
            f"Summary: {email_data.get('summary', '')}\n"
            f"Body: {email_data.get('body', '')[:500]}"
        )
        collection.upsert(
            ids=[email_data["id"]],
            documents=[doc],
            metadatas=[{
                "sender": email_data["sender"],
                "sender_email": email_data.get("sender_email", ""),
                "subject": email_data["subject"],
                "flagged_at": datetime.now().isoformat(),
            }],
        )
        return True
    except Exception as e:
        print(f"[mailmind.chroma] embed failed: {e}")
        return False


def delete_embedding(email_id: str, chroma_path: str) -> None:
    collection = _get_collection(chroma_path)
    if not collection:
        return
    try:
        collection.delete(ids=[email_id])
    except Exception as e:
        print(f"[mailmind.chroma] delete failed: {e}")


def query_similar(sender: str, subject: str, chroma_path: str, n: int = 3) -> str:
    collection = _get_collection(chroma_path)
    if not collection:
        return ""
    try:
        results = collection.query(query_texts=[f"{sender} {subject}"], n_results=n)
        if results["documents"] and results["documents"][0]:
            return "\n\nPast context from similar emails:\n" + "\n---\n".join(results["documents"][0])
    except Exception as e:
        print(f"[mailmind.chroma] query failed: {e}")
    return ""

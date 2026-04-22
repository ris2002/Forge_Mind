"""
Module registry.

── How to add a module ──
1. Create a package under modules/<your_id>/ with __init__.py exporting `manifest`.
2. Import the manifest here.
3. Append it to REGISTRY below.

That's it. Routes auto-mount. The frontend discovers the new module via
GET /api/modules.
"""

from __future__ import annotations

from fastapi import APIRouter

from .mailmind import manifest as mailmind_manifest

REGISTRY: list[dict] = [
    mailmind_manifest,
    # Add future modules here. Examples:
    # from .notes import manifest as notes_manifest
    # notes_manifest,
]


def mount_all(app) -> None:
    """Register every module's router on the FastAPI app."""
    for m in REGISTRY:
        app.include_router(m["router"])


# A small router exposing the module catalogue to the frontend.
meta_router = APIRouter(prefix="/api/modules", tags=["modules"])


@meta_router.get("")
def list_modules():
    """Return module manifests (minus the router, which isn't serialisable)."""
    return {
        "modules": [
            {k: v for k, v in m.items() if k != "router"}
            for m in REGISTRY
        ]
    }


__all__ = ["REGISTRY", "mount_all", "meta_router"]

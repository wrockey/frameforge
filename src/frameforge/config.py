"""Configuration loading and path management."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from . import __version__

load_dotenv()


def read_settings(library_root: Path) -> dict:
    """UI-writable settings (settings.json in the library root)."""
    try:
        return json.loads((library_root / "settings.json").read_text())
    except Exception:
        return {}


def write_settings(library_root: Path, updates: dict) -> None:
    """Merge updates into settings.json. A value of None removes the key."""
    library_root.mkdir(parents=True, exist_ok=True)
    settings = read_settings(library_root)
    for k, v in updates.items():
        if v is None:
            settings.pop(k, None)
        else:
            settings[k] = v
    (library_root / "settings.json").write_text(json.dumps(settings, indent=2))


@dataclass
class Config:
    """Runtime configuration. All paths absolute, all secrets from env."""

    xai_api_key: str = field(default_factory=lambda: os.environ.get("XAI_API_KEY", ""))
    tv_host: Optional[str] = field(
        default_factory=lambda: os.environ.get("FRAMEFORGE_TV_HOST")
    )
    library_root: Path = field(
        default_factory=lambda: Path(
            os.environ.get(
                "FRAMEFORGE_LIBRARY",
                str(Path.home() / "Pictures" / "FrameForge"),
            )
        )
    )

    image_model: str = "grok-imagine-image-quality"
    text_model: str = "grok-4.3"
    resolution: str = "2k"
    aspect_ratio: str = "16:9"
    target_count: int = 30

    tv_storage_cap: int = 80
    upload_format: str = "JPEG"
    upload_quality: int = 92

    # Server binding. Loopback by default; set FRAMEFORGE_BIND_HOST=0.0.0.0 to
    # reach the web UI from a phone on the same network.
    bind_host: str = field(
        default_factory=lambda: os.environ.get("FRAMEFORGE_BIND_HOST", "127.0.0.1")
    )
    bind_port: int = field(
        default_factory=lambda: int(os.environ.get("FRAMEFORGE_BIND_PORT", "8765"))
    )
    # When set, every /api request must carry this token (Bearer header or
    # ?token= query). Strongly recommended when binding beyond loopback.
    api_token: str = field(
        default_factory=lambda: os.environ.get("FRAMEFORGE_API_TOKEN", "")
    )

    app_version: str = __version__

    def __post_init__(self) -> None:
        # Env var wins; otherwise fall back to the host saved by the web UI's
        # onboarding flow (settings.json in the library root).
        if not self.tv_host:
            self.tv_host = read_settings(self.library_root).get("tv_host") or None

    @property
    def token_file(self) -> Path:
        return self.library_root / ".frameforge_token"

    def theme_dir(self, theme_slug: str) -> Path:
        return self.library_root / theme_slug

    def validate(self) -> None:
        if not self.xai_api_key:
            raise RuntimeError(
                "XAI_API_KEY not set. Copy .env.example to .env and add your key."
            )
        self.library_root.mkdir(parents=True, exist_ok=True)


def slugify(theme: str) -> str:
    """Filesystem-safe theme name."""
    return "".join(c if c.isalnum() else "_" for c in theme.lower()).strip("_")

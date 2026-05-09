"""Configuration loading and path management."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from . import __version__

load_dotenv()


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

    app_version: str = __version__

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

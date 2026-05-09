"""Library management: manifest, dedup, rolling window of TV images."""
from __future__ import annotations

import csv
import json
import sqlite3
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image

from .config import Config


@dataclass
class LibraryEntry:
    image_path: Path
    sidecar_path: Path
    theme_slug: str

    def load_meta(self) -> dict:
        return json.loads(self.sidecar_path.read_text())


class Library:
    """Filesystem-backed library with a SQLite index for TV state."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        cfg.library_root.mkdir(parents=True, exist_ok=True)
        self.db_path = cfg.library_root / "themes.db"
        self._conn = sqlite3.connect(self.db_path)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tv_uploads (
                content_id   TEXT PRIMARY KEY,
                local_path   TEXT NOT NULL,
                theme_slug   TEXT NOT NULL,
                uploaded_at  TEXT NOT NULL
            )
            """
        )
        self._conn.commit()

    # ---- listing ---------------------------------------------------------

    def list_theme(self, theme_slug: str) -> list[LibraryEntry]:
        d = self.cfg.theme_dir(theme_slug)
        if not d.exists():
            return []
        return [
            LibraryEntry(p, p.with_suffix(".json"), theme_slug)
            for p in sorted(d.glob("img_*.png"))
            if p.with_suffix(".json").exists()
        ]

    def list_themes(self) -> list[str]:
        """All theme slugs found on disk."""
        if not self.cfg.library_root.exists():
            return []
        return sorted(
            [
                p.name
                for p in self.cfg.library_root.iterdir()
                if p.is_dir() and not p.name.startswith(".")
            ]
        )

    # ---- manifest --------------------------------------------------------

    def write_manifest(self, theme_slug: str) -> Path:
        entries = self.list_theme(theme_slug)
        manifest_path = self.cfg.theme_dir(theme_slug) / "manifest.csv"
        with manifest_path.open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "filename",
                    "theme",
                    "prompt",
                    "expansion_seed",
                    "image_model",
                    "resolution",
                    "aspect_ratio",
                    "generated_at",
                    "frameforge_version",
                ]
            )
            for entry in entries:
                m = entry.load_meta()
                writer.writerow(
                    [
                        m["filename"],
                        m["theme"],
                        m["prompt"],
                        m["expansion_seed"],
                        m["image_model"],
                        m["resolution"],
                        m["aspect_ratio"],
                        m["generated_at"],
                        m["frameforge_version"],
                    ]
                )
        return manifest_path

    # ---- export for TV ---------------------------------------------------

    def to_jpeg(self, image_path: Path) -> bytes:
        """Convert PNG to JPEG bytes for upload (Frame prefers JPEG)."""
        img = Image.open(image_path).convert("RGB")
        buf = BytesIO()
        img.save(buf, format=self.cfg.upload_format, quality=self.cfg.upload_quality)
        return buf.getvalue()

    # ---- TV state tracking ----------------------------------------------

    def record_upload(
        self, content_id: str, local_path: Path, theme_slug: str, uploaded_at: str
    ) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO tv_uploads VALUES (?, ?, ?, ?)",
            (content_id, str(local_path), theme_slug, uploaded_at),
        )
        self._conn.commit()

    def list_tv_uploads(self, theme_slug: str | None = None) -> list[tuple]:
        sql = "SELECT content_id, local_path, theme_slug, uploaded_at FROM tv_uploads"
        params: tuple = ()
        if theme_slug is not None:
            sql += " WHERE theme_slug = ?"
            params = (theme_slug,)
        sql += " ORDER BY uploaded_at"
        return list(self._conn.execute(sql, params))

    def remove_upload(self, content_id: str) -> None:
        self._conn.execute(
            "DELETE FROM tv_uploads WHERE content_id = ?", (content_id,)
        )
        self._conn.commit()

    def is_on_tv(self, local_path: Path) -> bool:
        """Whether a specific local image is currently uploaded to the TV."""
        row = self._conn.execute(
            "SELECT 1 FROM tv_uploads WHERE local_path = ? LIMIT 1",
            (str(local_path),),
        ).fetchone()
        return row is not None

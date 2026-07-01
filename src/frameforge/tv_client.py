"""Samsung Frame TV client — pairing, upload, slideshow control."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

try:
    from samsungtvws import SamsungTVWS
except ImportError:  # tests can run without the encrypted extra installed
    SamsungTVWS = None  # type: ignore

from .config import Config
from .library import Library


class FrameTVClient:
    def __init__(self, cfg: Config, host: str) -> None:
        if SamsungTVWS is None:
            raise RuntimeError(
                "samsungtvws is not installed. Run: pip install 'samsungtvws[encrypted,async]'"
            )
        self.cfg = cfg
        self.host = host
        self.token_file = cfg.token_file
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        self._tv: Optional[SamsungTVWS] = None

    def _connect(self) -> SamsungTVWS:
        if self._tv is None:
            self._tv = SamsungTVWS(
                host=self.host,
                port=8002,
                token_file=str(self.token_file),
                name="FrameForge",
            )
        return self._tv

    def pair(self) -> None:
        """First-run pairing. Triggers a prompt on the TV remote."""
        tv = self._connect()
        tv.art().get_api_version()
        print(
            "  → If this is the first time pairing, accept the prompt on your TV remote."
        )

    def upload_batch(
        self,
        library: Library,
        theme_slug: str,
        image_paths: list[Path],
        matte: str = "shadowbox_polar",
        portrait_matte: str = "shadowbox_polar",
    ) -> list[str]:
        tv = self._connect()
        art = tv.art()
        content_ids: list[str] = []

        for p in image_paths:
            jpeg_bytes = library.to_jpeg(p)
            print(f"  ↑ {p.name} ({len(jpeg_bytes) // 1024} KB)")
            content_id = art.upload(
                jpeg_bytes,
                file_type="JPEG",
                matte=matte,
                portrait_matte=portrait_matte,
            )
            content_ids.append(content_id)
            library.record_upload(
                content_id,
                p,
                theme_slug,
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            )
            time.sleep(0.5)
        return content_ids

    def prune_to_cap(self, library: Library) -> None:
        tv = self._connect()
        art = tv.art()
        all_uploads = library.list_tv_uploads()
        excess = len(all_uploads) - self.cfg.tv_storage_cap
        if excess <= 0:
            return
        for content_id, _, _, _ in all_uploads[:excess]:
            try:
                art.delete(content_id)
                library.remove_upload(content_id)
                print(f"  ✕ pruned {content_id}")
            except Exception as e:
                print(f"  ! prune failed for {content_id}: {e}")

    def list_art(self) -> list[dict]:
        """List user-uploaded art currently stored on the TV.

        Returns normalized dicts: {"content_id", "category_id", "image_date",
        "width", "height"}. Prefers the "My Collection" category; falls back to
        filtering the full list by the MY_* content-id prefix older firmwares use.
        """
        art = self._connect().art()
        try:
            items = art.available("MY-C0002")
        except Exception:
            items = [
                i
                for i in (art.available() or [])
                if str(i.get("content_id", "")).startswith("MY")
            ]
        out: list[dict] = []
        for i in items or []:
            cid = i.get("content_id")
            if not cid:
                continue
            out.append(
                {
                    "content_id": cid,
                    "category_id": i.get("category_id"),
                    "image_date": i.get("image_date"),
                    "width": i.get("width"),
                    "height": i.get("height"),
                }
            )
        return out

    def get_current_art(self) -> Optional[str]:
        """content_id of the artwork the TV is displaying right now, if known."""
        try:
            info = self._connect().art().get_current()
            if isinstance(info, dict):
                return info.get("content_id")
        except Exception:
            pass
        return None

    def get_thumbnail(self, content_id: str) -> bytes:
        """JPEG thumbnail bytes for one piece of art stored on the TV."""
        data = self._connect().art().get_thumbnail(content_id)
        if not isinstance(data, (bytes, bytearray)):
            raise RuntimeError(f"Unexpected thumbnail payload for {content_id}")
        return bytes(data)

    def delete_art(self, content_ids: list[str]) -> list[str]:
        """Delete art from the TV. Returns the content_ids actually removed."""
        art = self._connect().art()
        try:
            art.delete_list(content_ids)
            return list(content_ids)
        except Exception:
            removed: list[str] = []
            for cid in content_ids:
                try:
                    art.delete(cid)
                    removed.append(cid)
                except Exception as e:
                    print(f"  ! delete failed for {cid}: {e}")
            return removed

    def select_art(self, content_id: str) -> None:
        """Display one piece of art on the TV immediately."""
        self._connect().art().select_image(content_id, show=True)

    def start_slideshow(self, minutes: int = 30) -> None:
        tv = self._connect()
        tv.art().set_slideshow_status(duration=minutes, type="shuffleslideshow")

    def force_art_mode(self) -> None:
        """2024 Frame quirk: nudge the TV back to art mode after HDMI source ends."""
        tv = self._connect()
        if tv.art().get_artmode() == "off":
            tv.shortcuts().power()
            time.sleep(2)
            tv.shortcuts().power()

    def status(self) -> dict:
        """Return a status dict matching the TV screen's connected-TV card."""
        tv = self._connect()
        try:
            art = tv.art()
            artmode = art.get_artmode()
            api_version = art.get_api_version()
            return {
                "host": self.host,
                "connected": True,
                "art_mode": artmode,
                "api_version": api_version,
                "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        except Exception as e:
            return {
                "host": self.host,
                "connected": False,
                "error": str(e),
                "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }

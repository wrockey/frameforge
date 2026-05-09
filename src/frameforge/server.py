"""FastAPI service for the FrameForge web UI.

Endpoint shapes are fitted directly to the Claude Design screens. See WIRING.md
for the full UI-to-endpoint mapping.

Run with: `frameforged` or `python -m frameforge.server`
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .config import Config, slugify
from .discover import discover
from .expander import Expansion, expand_theme
from .generator import generate_batch
from .library import Library
from .pipeline import run_push as _run_push
from .tv_client import FrameTVClient


app = FastAPI(title="FrameForge", version=__version__)

# Permissive CORS so a Claude Design HTML prototype served from a file:// URL
# or a different localhost port can talk to the backend during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----- Status broadcaster ----------------------------------------------------


class StatusBroker:
    """Pushes status events to all connected WebSocket clients.

    The header status chip subscribes here for live 'Generating 14 of 30…' updates.
    """

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._current: dict = {"state": "idle"}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        await ws.send_json(self._current)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        self._current = payload
        dead: list[WebSocket] = []
        for ws in self._clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.disconnect(d)


broker = StatusBroker()


# ----- Response models -------------------------------------------------------
# These shapes mirror what the UI screens render.


class ThemeCard(BaseModel):
    slug: str
    title: str
    image_count: int
    last_refreshed: Optional[str]
    size_mb: float
    image_model: str
    state: str  # "on_tv" | "idle" | "generating"
    preview_filenames: list[str]  # 4 filenames for the 2x2 mosaic on the card


class ImageTile(BaseModel):
    """One tile in the 5-column theme detail grid."""
    filename: str
    prompt_short: str  # first 6 words + ellipsis, for the caption beneath the tile
    on_tv: bool        # drives the brass corner-dot indicator


class ThemeDetail(BaseModel):
    slug: str
    title: str
    image_count: int
    last_refreshed: Optional[str]
    size_mb: float
    image_model: str
    version_pin: str
    state: str
    expansion: Optional[dict]  # full expansion data when prompt panel opens
    images: list[ImageTile]


class InspectPayload(BaseModel):
    """Right-side inspect sheet contents for one image."""
    filename: str
    prompt: str  # full text rendered in display serif
    sidecar: dict
    on_tv: bool
    regen_count: int


class TVStatus(BaseModel):
    connected: bool
    host: Optional[str]
    model_name: Optional[str]
    mac: Optional[str]
    art_mode: Optional[str]
    last_seen: Optional[str]
    images_on_tv: int
    storage_cap: int


class ScheduleEntry(BaseModel):
    id: str
    theme_slug: str
    theme_title: str
    cron: str
    next_run: Optional[str]
    enabled: bool


class Settings(BaseModel):
    image_model: str
    text_model: str
    resolution: str
    aspect_ratio: str
    target_count: int
    pin_versions: bool = False
    save_provenance: bool = True


# ----- Helpers ---------------------------------------------------------------


def _short_prompt(prompt: str, words: int = 6) -> str:
    parts = prompt.split()
    if len(parts) <= words:
        return prompt
    return " ".join(parts[:words]) + "…"


def _theme_size_mb(library: Library, slug: str) -> float:
    d = library.cfg.theme_dir(slug)
    if not d.exists():
        return 0.0
    total = sum(p.stat().st_size for p in d.glob("img_*.png"))
    return round(total / (1024 * 1024), 1)


def _last_refreshed_iso(library: Library, slug: str) -> Optional[str]:
    """Most recent generated_at across all sidecars in the theme."""
    entries = library.list_theme(slug)
    if not entries:
        return None
    times = []
    for e in entries:
        try:
            times.append(e.load_meta()["generated_at"])
        except Exception:
            continue
    return max(times) if times else None


# ----- Endpoints -------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": __version__}


@app.get("/api/discover")
def api_discover() -> list[dict]:
    """Onboarding screen 2: 'Find your TV'."""
    return [
        {
            "host": tv.host,
            "model_name": tv.model_name,
            "mac": tv.mac,
            "is_frame": tv.is_frame,
        }
        for tv in discover()
    ]


@app.get("/api/themes", response_model=list[ThemeCard])
def list_themes() -> list[ThemeCard]:
    """Themes screen: cards grid."""
    cfg = Config()
    library = Library(cfg)
    cards: list[ThemeCard] = []
    for slug in library.list_themes():
        entries = library.list_theme(slug)
        if not entries:
            continue
        first_meta = entries[0].load_meta()
        on_tv_for_theme = library.list_tv_uploads(slug)
        state = "on_tv" if on_tv_for_theme else "idle"
        # Pick 4 evenly-spaced indices for the mosaic so it stays varied
        n = len(entries)
        idxs = [int(i * n / 4) for i in range(4)] if n >= 4 else list(range(n))
        previews = [entries[i].image_path.name for i in idxs]
        cards.append(
            ThemeCard(
                slug=slug,
                title=first_meta.get("theme", slug),
                image_count=len(entries),
                last_refreshed=_last_refreshed_iso(library, slug),
                size_mb=_theme_size_mb(library, slug),
                image_model=first_meta.get("image_model", cfg.image_model),
                state=state,
                preview_filenames=previews,
            )
        )
    return cards


@app.get("/api/themes/{slug}", response_model=ThemeDetail)
def theme_detail(slug: str, with_expansion: bool = False) -> ThemeDetail:
    """Theme detail screen. Pass with_expansion=true to populate the prompt panel."""
    cfg = Config()
    library = Library(cfg)
    entries = library.list_theme(slug)
    if not entries:
        raise HTTPException(status_code=404, detail=f"Theme '{slug}' not found")

    first_meta = entries[0].load_meta()
    tiles = []
    for e in entries:
        meta = e.load_meta()
        tiles.append(
            ImageTile(
                filename=meta["filename"],
                prompt_short=_short_prompt(meta["prompt"]),
                on_tv=library.is_on_tv(e.image_path),
            )
        )

    expansion_payload = None
    if with_expansion:
        # Reconstruct expansion data from the sidecars themselves — cheaper than
        # storing a separate expansion record, and equally reproducible.
        prompts = [e.load_meta()["prompt"] for e in entries]
        expansion_payload = {
            "theme": first_meta["theme"],
            "seed": first_meta["expansion_seed"],
            "count": len(prompts),
            "prompts": prompts,
            "text_model": first_meta.get("text_model_for_expansion", cfg.text_model),
            "generated_at": first_meta["generated_at"],
            "frameforge_version": first_meta["frameforge_version"],
        }

    on_tv_for_theme = library.list_tv_uploads(slug)
    return ThemeDetail(
        slug=slug,
        title=first_meta["theme"],
        image_count=len(entries),
        last_refreshed=_last_refreshed_iso(library, slug),
        size_mb=_theme_size_mb(library, slug),
        image_model=first_meta.get("image_model", cfg.image_model),
        version_pin=first_meta.get("frameforge_version", __version__),
        state="on_tv" if on_tv_for_theme else "idle",
        expansion=expansion_payload,
        images=tiles,
    )


@app.get("/api/themes/{slug}/images/{filename}")
def serve_image(slug: str, filename: str) -> FileResponse:
    """Raw image bytes for the theme cards' mosaic and the detail grid."""
    cfg = Config()
    p = cfg.theme_dir(slug) / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(p)


@app.get("/api/themes/{slug}/images/{filename}/inspect", response_model=InspectPayload)
def inspect_image(slug: str, filename: str) -> InspectPayload:
    """Image inspect side sheet contents."""
    cfg = Config()
    library = Library(cfg)
    image_path = cfg.theme_dir(slug) / filename
    sidecar_path = image_path.with_suffix(".json")
    if not sidecar_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    sidecar = json.loads(sidecar_path.read_text())
    return InspectPayload(
        filename=filename,
        prompt=sidecar["prompt"],
        sidecar=sidecar,
        on_tv=library.is_on_tv(image_path),
        regen_count=0,  # bookkept in a future iteration
    )


class GenerateRequest(BaseModel):
    theme: str
    count: Optional[int] = None


@app.post("/api/themes/{slug}/generate")
async def generate_theme(slug: str, body: GenerateRequest) -> dict:
    """Kick off a generation batch. Progress streams via /ws/status."""
    cfg = Config()
    cfg.validate()

    async def progress(payload: dict) -> None:
        await broker.broadcast(
            {
                "state": "generating",
                "theme_slug": slug,
                "done": payload["done"],
                "total": payload["total"],
                "last_filename": payload.get("last_filename"),
            }
        )

    async def run() -> None:
        try:
            await broker.broadcast(
                {"state": "expanding", "theme_slug": slug}
            )
            expansion: Expansion = await asyncio.to_thread(
                expand_theme, cfg, body.theme, body.count
            )
            out_dir = cfg.theme_dir(slug)
            await generate_batch(cfg, expansion, out_dir, on_progress=progress)
            await asyncio.to_thread(Library(cfg).write_manifest, slug)
            await broker.broadcast({"state": "idle"})
        except Exception as e:
            await broker.broadcast({"state": "error", "message": str(e)})

    asyncio.create_task(run())
    return {"started": True, "theme": body.theme, "slug": slug}


class PushRequest(BaseModel):
    minutes: int = 30
    matte: str = "shadowbox"
    matte_color: str = "polar"


@app.post("/api/themes/{slug}/push")
async def push_theme(slug: str, body: PushRequest) -> dict:
    """Upload theme to TV, prune, start slideshow."""
    cfg = Config()

    async def run() -> None:
        try:
            await broker.broadcast({"state": "uploading", "theme_slug": slug})
            await asyncio.to_thread(_run_push, cfg, slug, body.minutes)
            await broker.broadcast({"state": "idle"})
        except Exception as e:
            await broker.broadcast({"state": "error", "message": str(e)})

    asyncio.create_task(run())
    return {"started": True}


@app.get("/api/tv/status", response_model=TVStatus)
def tv_status() -> TVStatus:
    cfg = Config()
    library = Library(cfg)
    images_on_tv = len(library.list_tv_uploads())

    if not cfg.tv_host:
        return TVStatus(
            connected=False,
            host=None,
            model_name=None,
            mac=None,
            art_mode=None,
            last_seen=None,
            images_on_tv=images_on_tv,
            storage_cap=cfg.tv_storage_cap,
        )

    try:
        client = FrameTVClient(cfg, cfg.tv_host)
        s = client.status()
        return TVStatus(
            connected=s["connected"],
            host=s["host"],
            model_name=None,
            mac=None,
            art_mode=s.get("art_mode"),
            last_seen=s.get("last_seen"),
            images_on_tv=images_on_tv,
            storage_cap=cfg.tv_storage_cap,
        )
    except Exception:
        return TVStatus(
            connected=False,
            host=cfg.tv_host,
            model_name=None,
            mac=None,
            art_mode=None,
            last_seen=None,
            images_on_tv=images_on_tv,
            storage_cap=cfg.tv_storage_cap,
        )


@app.get("/api/settings", response_model=Settings)
def get_settings() -> Settings:
    cfg = Config()
    return Settings(
        image_model=cfg.image_model,
        text_model=cfg.text_model,
        resolution=cfg.resolution,
        aspect_ratio=cfg.aspect_ratio,
        target_count=cfg.target_count,
    )


# ----- WebSocket for the header status chip ---------------------------------


@app.websocket("/ws/status")
async def ws_status(ws: WebSocket) -> None:
    await broker.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive; we don't expect inbound
    except WebSocketDisconnect:
        broker.disconnect(ws)


# ----- Static frontend mount -------------------------------------------------
# Must come AFTER all /api and /ws routes so they take precedence.

_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")


# ----- Entry point -----------------------------------------------------------


def main() -> None:
    import uvicorn

    uvicorn.run(
        "frameforge.server:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
    )


if __name__ == "__main__":
    main()

"""FastAPI service for the FrameForge web UI.

Endpoint shapes are fitted directly to the Claude Design screens. See WIRING.md
for the full UI-to-endpoint mapping.

Run with: `frameforged` or `python -m frameforge.server`
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .config import Config, write_settings
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


# ----- API token auth ---------------------------------------------------------
# Off by default (loopback-only server). When FRAMEFORGE_API_TOKEN is set —
# e.g. because the server is bound to the LAN for a phone — every /api request
# must present it. /api/health stays open so clients can detect the server and
# whether auth is required. The static UI shell is served without a token; it
# holds no secrets and needs the token itself to call the API.


def _request_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    # background-image URLs and the WebSocket can't set headers
    return request.query_params.get("token", "")


@app.middleware("http")
async def require_api_token(request: Request, call_next):
    token = Config().api_token
    path = request.url.path
    if token and path.startswith("/api/") and path != "/api/health":
        if _request_token(request) != token:
            return JSONResponse({"detail": "Invalid or missing API token"}, status_code=401)
    return await call_next(request)


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
    content_id: Optional[str] = None  # TV content id when on_tv, for remove-from-TV


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
    return {
        "ok": True,
        "version": __version__,
        "auth_required": bool(Config().api_token),
    }


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
                content_id=library.tv_content_id(e.image_path),
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


# ----- TV host persistence -----------------------------------------------
# Lets the onboarding flow save the discovered TV so the whole setup can
# happen in the browser. FRAMEFORGE_TV_HOST in the environment still wins.


class TVHostRequest(BaseModel):
    host: str


@app.put("/api/tv/host")
def set_tv_host(body: TVHostRequest) -> dict:
    host = body.host.strip()
    if not host:
        raise HTTPException(status_code=400, detail="Host must not be empty")
    cfg = Config()
    write_settings(cfg.library_root, {"tv_host": host})
    env_host = os.environ.get("FRAMEFORGE_TV_HOST")
    return {
        "ok": True,
        "host": host,
        "env_override": bool(env_host and env_host != host),
    }


@app.delete("/api/tv/host")
def forget_tv() -> dict:
    """Forget the saved TV and its pairing token."""
    cfg = Config()
    write_settings(cfg.library_root, {"tv_host": None})
    try:
        cfg.token_file.unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True}


# ----- TV art management -------------------------------------------------
# The TV screen's two-panel manager: what's on the TV, upload selected local
# images, remove selected art, show one image now, restart the slideshow.

# Serialize TV websocket traffic — the Frame gets confused by parallel sessions.
_tv_lock = threading.Lock()
# Thumbnails for art the TV holds but we didn't upload are fetched from the TV
# itself, which is slow; cache them for the life of the server process.
_thumb_cache: dict[str, bytes] = {}


class TVArtItem(BaseModel):
    content_id: str
    matched: bool                 # True when we can map it to a library image
    theme_slug: Optional[str]
    theme_title: Optional[str]
    filename: Optional[str]
    uploaded_at: Optional[str]
    is_current: bool              # the TV is displaying this one right now
    thumbnail_url: str


class TVArtResponse(BaseModel):
    connected: bool
    source: str  # "tv" (live list) | "cache" (TV unreachable; last known state)
    current_content_id: Optional[str]
    items: list[TVArtItem]


def _art_item_from_db_row(
    library: Library, content_id: str, local_path: str, slug: str, uploaded_at: str,
    current_id: Optional[str],
) -> TVArtItem:
    p = Path(local_path)
    if p.exists():
        thumb = f"/api/themes/{slug}/images/{p.name}"
    else:
        thumb = f"/api/tv/art/{content_id}/thumbnail"
    return TVArtItem(
        content_id=content_id,
        matched=True,
        theme_slug=slug,
        theme_title=slug.replace("_", " "),
        filename=p.name,
        uploaded_at=uploaded_at,
        is_current=content_id == current_id,
        thumbnail_url=thumb,
    )


def _cached_art_response(library: Library, connected: bool) -> TVArtResponse:
    items = [
        _art_item_from_db_row(library, cid, path, slug, up, None)
        for cid, path, slug, up in library.list_tv_uploads()
    ]
    return TVArtResponse(
        connected=connected, source="cache", current_content_id=None, items=items
    )


@app.get("/api/tv/art", response_model=TVArtResponse)
def tv_art() -> TVArtResponse:
    """What's on the TV, reconciled against the local upload records.

    Records for art no longer on the TV (deleted via the remote, another app)
    are pruned; art on the TV that we never uploaded shows up as unmatched.
    Falls back to the last known DB state when the TV is unreachable.
    """
    cfg = Config()
    library = Library(cfg)
    if not cfg.tv_host:
        return _cached_art_response(library, connected=False)

    try:
        with _tv_lock:
            client = FrameTVClient(cfg, cfg.tv_host)
            tv_items = client.list_art()
            current_id = client.get_current_art()
    except Exception:
        return _cached_art_response(library, connected=False)

    db_rows = {
        cid: (path, slug, up) for cid, path, slug, up in library.list_tv_uploads()
    }
    tv_ids = {i["content_id"] for i in tv_items}
    for cid in list(db_rows):
        if cid not in tv_ids:
            library.remove_upload(cid)
            del db_rows[cid]

    items: list[TVArtItem] = []
    for i in tv_items:
        cid = i["content_id"]
        if cid in db_rows:
            path, slug, up = db_rows[cid]
            items.append(
                _art_item_from_db_row(library, cid, path, slug, up, current_id)
            )
        else:
            items.append(
                TVArtItem(
                    content_id=cid,
                    matched=False,
                    theme_slug=None,
                    theme_title=None,
                    filename=None,
                    uploaded_at=i.get("image_date"),
                    is_current=cid == current_id,
                    thumbnail_url=f"/api/tv/art/{cid}/thumbnail",
                )
            )
    return TVArtResponse(
        connected=True, source="tv", current_content_id=current_id, items=items
    )


@app.get("/api/tv/art/{content_id}/thumbnail")
def tv_art_thumbnail(content_id: str) -> Response:
    """Thumbnail for art the TV holds but we don't have locally."""
    if content_id in _thumb_cache:
        return Response(content=_thumb_cache[content_id], media_type="image/jpeg")
    cfg = Config()
    if not cfg.tv_host:
        raise HTTPException(status_code=404, detail="No TV configured")
    try:
        with _tv_lock:
            data = FrameTVClient(cfg, cfg.tv_host).get_thumbnail(content_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Thumbnail unavailable")
    _thumb_cache[content_id] = data
    return Response(content=data, media_type="image/jpeg")


class TVUploadItem(BaseModel):
    slug: str
    filename: str


class TVUploadRequest(BaseModel):
    items: list[TVUploadItem]
    matte: str = "shadowbox"
    matte_color: str = "polar"


@app.post("/api/tv/art/upload")
async def tv_art_upload(body: TVUploadRequest) -> dict:
    """Upload the selected library images to the TV."""
    cfg = Config()
    if not cfg.tv_host:
        raise HTTPException(status_code=503, detail="No TV configured")
    if not body.items:
        raise HTTPException(status_code=400, detail="No images selected")

    to_upload: list[tuple[str, Path]] = []
    for it in body.items:
        p = cfg.theme_dir(it.slug) / it.filename
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"Image not found: {it.filename}")
        to_upload.append((it.slug, p))

    matte = body.matte if body.matte == "none" else f"{body.matte}_{body.matte_color}"

    def work() -> list[str]:
        library = Library(cfg)
        client = FrameTVClient(cfg, cfg.tv_host)
        uploaded: list[str] = []
        with _tv_lock:
            for slug, path in to_upload:
                ids = client.upload_batch(
                    library, slug, [path], matte=matte, portrait_matte=matte
                )
                uploaded.extend(ids)
        return uploaded

    await broker.broadcast({"state": "uploading", "total": len(to_upload)})
    try:
        uploaded = await asyncio.to_thread(work)
    except Exception as e:
        await broker.broadcast({"state": "error", "message": str(e)})
        raise HTTPException(status_code=502, detail=f"TV upload failed: {e}")
    await broker.broadcast({"state": "idle"})
    return {"uploaded": uploaded, "count": len(uploaded)}


class TVDeleteRequest(BaseModel):
    content_ids: list[str]


@app.post("/api/tv/art/delete")
async def tv_art_delete(body: TVDeleteRequest) -> dict:
    """Remove the selected art from the TV. Local library files are untouched."""
    cfg = Config()
    if not cfg.tv_host:
        raise HTTPException(status_code=503, detail="No TV configured")
    if not body.content_ids:
        raise HTTPException(status_code=400, detail="No images selected")

    def work() -> list[str]:
        library = Library(cfg)
        client = FrameTVClient(cfg, cfg.tv_host)
        with _tv_lock:
            removed = client.delete_art(body.content_ids)
        for cid in removed:
            library.remove_upload(cid)
            _thumb_cache.pop(cid, None)
        return removed

    try:
        removed = await asyncio.to_thread(work)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TV delete failed: {e}")
    failed = [c for c in body.content_ids if c not in removed]
    return {"removed": removed, "failed": failed}


class TVSelectRequest(BaseModel):
    content_id: str


@app.post("/api/tv/art/select")
async def tv_art_select(body: TVSelectRequest) -> dict:
    """Display one piece of art on the TV right now."""
    cfg = Config()
    if not cfg.tv_host:
        raise HTTPException(status_code=503, detail="No TV configured")

    def work() -> None:
        with _tv_lock:
            FrameTVClient(cfg, cfg.tv_host).select_art(body.content_id)

    try:
        await asyncio.to_thread(work)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TV select failed: {e}")
    return {"ok": True, "content_id": body.content_id}


class SlideshowRequest(BaseModel):
    minutes: int = 30


@app.post("/api/tv/slideshow")
async def tv_slideshow(body: SlideshowRequest) -> dict:
    """(Re)start the shuffle slideshow over the art on the TV."""
    cfg = Config()
    if not cfg.tv_host:
        raise HTTPException(status_code=503, detail="No TV configured")

    def work() -> None:
        with _tv_lock:
            FrameTVClient(cfg, cfg.tv_host).start_slideshow(body.minutes)

    try:
        await asyncio.to_thread(work)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TV slideshow failed: {e}")
    return {"ok": True, "minutes": body.minutes}


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
    token = Config().api_token
    if token and ws.query_params.get("token", "") != token:
        await ws.close(code=1008)  # policy violation
        return
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

    cfg = Config()
    print(f"FrameForge {__version__} — http://{cfg.bind_host}:{cfg.bind_port}")
    if cfg.bind_host not in ("127.0.0.1", "localhost") and not cfg.api_token:
        print(
            "  ⚠ Bound beyond loopback with no FRAMEFORGE_API_TOKEN set — "
            "anyone on the network can control your TV and spend API credits."
        )
    uvicorn.run(
        "frameforge.server:app",
        host=cfg.bind_host,
        port=cfg.bind_port,
        reload=False,
    )


if __name__ == "__main__":
    main()

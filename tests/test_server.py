"""Server endpoint tests with a fixture library on disk."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image


# Realistic-looking prompts used by multiple tests
PROMPTS = [
    "a weary swordswoman at the gate of a ruined ochre city, oil-painted, shadowed",
    "tavern interior with brass lanterns, low ceilings, smoke and shadow",
    "hooded thief crossing rooftops under a blood moon, art-deco border, ochre",
    "a sea-witch on the prow of a longship, lightning in the rigging, cobalt",
    "forsaken throne room, dust motes, a single shaft of dawn light through a slit",
]


def _build_fixture_library(tmp_path: Path) -> Path:
    """Build a tmp library with one realistic theme."""
    library_root = tmp_path / "lib"
    theme_dir = library_root / "vintage_pulp_fantasy"
    theme_dir.mkdir(parents=True)

    for i, prompt in enumerate(PROMPTS, start=1):
        # Real PNG so size_mb computes correctly
        img = theme_dir / f"img_{i:04d}.png"
        Image.new("RGB", (200, 112), color=(120, 40, 30)).save(img)
        sidecar = img.with_suffix(".json")
        sidecar.write_text(
            json.dumps(
                {
                    "filename": img.name,
                    "theme": "vintage pulp fantasy",
                    "prompt": prompt,
                    "expansion_seed": "a3f9e21b4c87",
                    "expansion_index": i - 1,
                    "image_model": "grok-imagine-image-quality",
                    "text_model_for_expansion": "grok-4.3",
                    "provider": "xai",
                    "resolution": "2k",
                    "aspect_ratio": "16:9",
                    "generated_at": "2026-05-06T03:00:14Z",
                    "frameforge_version": "0.1.0",
                }
            )
        )
    return library_root


def _add_imported_fixture(lib_root: Path) -> None:
    """Add an imported-style entry: sidecar has no prompt/seed/generated_at."""
    d = lib_root / "imported"
    (d / "originals").mkdir(parents=True)
    Image.new("RGB", (3840, 2160), color=(30, 60, 90)).save(d / "img_0001.png")
    (d / "originals" / "sunset.jpg").write_bytes(b"fake-original")
    (d / "img_0001.json").write_text(
        json.dumps(
            {
                "filename": "img_0001.png",
                "theme": "Imported",
                "source": "imported",
                "original_filename": "sunset.jpg",
                "imported_at": "2026-07-01T10:00:00Z",
                "crop": {"x": 0, "y": 128, "w": 4096, "h": 2304},
                "width": 3840,
                "height": 2160,
                "frameforge_version": "0.1.0",
            }
        )
    )


@pytest.fixture
def app_with_fixture(tmp_path, monkeypatch):
    """Return a TestClient with FRAMEFORGE_LIBRARY pointed at a fixture."""
    lib_root = _build_fixture_library(tmp_path)
    monkeypatch.setenv("FRAMEFORGE_LIBRARY", str(lib_root))
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    # Re-import to pick up env
    import importlib

    import frameforge.server as server_mod

    importlib.reload(server_mod)
    return TestClient(server_mod.app), lib_root


@pytest.fixture
def app_with_imported(tmp_path, monkeypatch):
    lib_root = _build_fixture_library(tmp_path)
    _add_imported_fixture(lib_root)
    monkeypatch.setenv("FRAMEFORGE_LIBRARY", str(lib_root))
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    import importlib

    import frameforge.server as server_mod

    importlib.reload(server_mod)
    return TestClient(server_mod.app), lib_root


def test_health(app_with_fixture):
    client, _ = app_with_fixture
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "version" in body


def test_list_themes_card_shape(app_with_fixture):
    """Themes screen contract: each card has all the fields the UI renders."""
    client, _ = app_with_fixture
    r = client.get("/api/themes")
    assert r.status_code == 200
    cards = r.json()
    assert len(cards) == 1
    card = cards[0]
    assert card["slug"] == "vintage_pulp_fantasy"
    assert card["title"] == "vintage pulp fantasy"
    assert card["image_count"] == 5
    assert card["state"] == "idle"  # nothing on TV yet
    assert card["image_model"] == "grok-imagine-image-quality"
    assert len(card["preview_filenames"]) == 4
    assert card["last_refreshed"] == "2026-05-06T03:00:14Z"
    assert card["size_mb"] >= 0  # real PNGs were tiny but nonzero


def test_theme_detail_without_expansion(app_with_fixture):
    client, _ = app_with_fixture
    r = client.get("/api/themes/vintage_pulp_fantasy")
    assert r.status_code == 200
    detail = r.json()
    assert detail["expansion"] is None  # collapsed by default
    assert len(detail["images"]) == 5
    tile = detail["images"][0]
    # Caption is first 6 words + ellipsis
    assert tile["prompt_short"].endswith("…")
    assert tile["prompt_short"].count(" ") <= 6
    assert tile["on_tv"] is False


def test_theme_detail_with_expansion(app_with_fixture):
    """Open prompt panel: expansion is populated with all 5 prompts and metadata."""
    client, _ = app_with_fixture
    r = client.get(
        "/api/themes/vintage_pulp_fantasy", params={"with_expansion": True}
    )
    assert r.status_code == 200
    detail = r.json()
    exp = detail["expansion"]
    assert exp is not None
    assert exp["seed"] == "a3f9e21b4c87"
    assert exp["count"] == 5
    assert len(exp["prompts"]) == 5
    assert exp["text_model"] == "grok-4.3"
    assert exp["frameforge_version"] == "0.1.0"


def test_inspect_image(app_with_fixture):
    """Inspect side sheet contract: prompt + full sidecar + on_tv flag."""
    client, _ = app_with_fixture
    r = client.get(
        "/api/themes/vintage_pulp_fantasy/images/img_0002.png/inspect"
    )
    assert r.status_code == 200
    payload = r.json()
    assert payload["filename"] == "img_0002.png"
    assert "tavern interior" in payload["prompt"]
    sidecar = payload["sidecar"]
    assert sidecar["expansion_seed"] == "a3f9e21b4c87"
    assert sidecar["expansion_index"] == 1
    assert payload["on_tv"] is False


def test_inspect_missing_image_404(app_with_fixture):
    client, _ = app_with_fixture
    r = client.get(
        "/api/themes/vintage_pulp_fantasy/images/nope.png/inspect"
    )
    assert r.status_code == 404


def test_theme_detail_missing_404(app_with_fixture):
    client, _ = app_with_fixture
    r = client.get("/api/themes/does_not_exist")
    assert r.status_code == 404


def test_tv_status_when_no_host(app_with_fixture):
    """Without FRAMEFORGE_TV_HOST set, status returns disconnected with cap."""
    client, _ = app_with_fixture
    r = client.get("/api/tv/status")
    assert r.status_code == 200
    s = r.json()
    assert s["connected"] is False
    assert s["images_on_tv"] == 0
    assert s["storage_cap"] == 80


def test_settings_endpoint(app_with_fixture):
    client, _ = app_with_fixture
    r = client.get("/api/settings")
    assert r.status_code == 200
    s = r.json()
    assert s["image_model"] == "grok-imagine-image-quality"
    assert s["text_model"] == "grok-4.3"
    assert s["target_count"] == 30
    assert s["save_provenance"] is True


# ----- TV art management ------------------------------------------------------


class FakeFrameTVClient:
    """Stands in for FrameTVClient; state lives on the class between requests."""

    art_on_tv: list[dict] = []
    current: str | None = None
    upload_counter: int = 100
    deleted: list[str] = []
    selected: list[str] = []
    slideshow_minutes: list[int] = []

    @classmethod
    def reset(cls):
        cls.art_on_tv = []
        cls.current = None
        cls.upload_counter = 100
        cls.deleted = []
        cls.selected = []
        cls.slideshow_minutes = []

    def __init__(self, cfg, host):
        self.cfg = cfg
        self.host = host

    def list_art(self):
        return [dict(i) for i in type(self).art_on_tv]

    def get_current_art(self):
        return type(self).current

    def get_thumbnail(self, content_id):
        return b"\xff\xd8fake-jpeg"

    def upload_batch(self, library, theme_slug, image_paths, matte="x", portrait_matte="x"):
        cls = type(self)
        ids = []
        for p in image_paths:
            cls.upload_counter += 1
            cid = f"MY_F{cls.upload_counter}"
            cls.art_on_tv.append({"content_id": cid})
            library.record_upload(cid, p, theme_slug, "2026-05-09T00:00:00Z")
            ids.append(cid)
        return ids

    def delete_art(self, content_ids):
        cls = type(self)
        cls.deleted.extend(content_ids)
        cls.art_on_tv = [
            i for i in cls.art_on_tv if i["content_id"] not in content_ids
        ]
        return list(content_ids)

    def select_art(self, content_id):
        type(self).selected.append(content_id)

    def start_slideshow(self, minutes=30):
        type(self).slideshow_minutes.append(minutes)


@pytest.fixture
def app_with_tv(tmp_path, monkeypatch):
    """TestClient with a fixture library, a configured host, and a fake TV."""
    lib_root = _build_fixture_library(tmp_path)
    monkeypatch.setenv("FRAMEFORGE_LIBRARY", str(lib_root))
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    monkeypatch.setenv("FRAMEFORGE_TV_HOST", "192.0.2.10")
    import importlib

    import frameforge.server as server_mod

    importlib.reload(server_mod)
    FakeFrameTVClient.reset()
    server_mod._thumb_cache.clear()
    monkeypatch.setattr(server_mod, "FrameTVClient", FakeFrameTVClient)
    return TestClient(server_mod.app), lib_root


def test_tv_art_no_host_falls_back_to_cache(app_with_fixture):
    client, _ = app_with_fixture
    r = client.get("/api/tv/art")
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is False
    assert body["source"] == "cache"
    assert body["items"] == []


def test_tv_art_reconciles_db_with_tv(app_with_tv):
    """Stale DB rows are pruned; untracked TV art shows up unmatched."""
    client, lib_root = app_with_tv
    from frameforge.config import Config
    from frameforge.library import Library

    library = Library(Config())
    img1 = lib_root / "vintage_pulp_fantasy" / "img_0001.png"
    img2 = lib_root / "vintage_pulp_fantasy" / "img_0002.png"
    # A: tracked and still on TV. B: tracked but gone from TV (deleted via remote).
    library.record_upload("MY_F0001", img1, "vintage_pulp_fantasy", "2026-05-08T00:00:00Z")
    library.record_upload("MY_F0002", img2, "vintage_pulp_fantasy", "2026-05-08T00:00:00Z")
    # TV holds A plus C, which FrameForge never uploaded.
    FakeFrameTVClient.art_on_tv = [
        {"content_id": "MY_F0001"},
        {"content_id": "MY_F9999", "image_date": "2026-01-01"},
    ]
    FakeFrameTVClient.current = "MY_F0001"

    r = client.get("/api/tv/art")
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is True
    assert body["source"] == "tv"
    assert body["current_content_id"] == "MY_F0001"
    by_id = {i["content_id"]: i for i in body["items"]}
    assert set(by_id) == {"MY_F0001", "MY_F9999"}
    matched = by_id["MY_F0001"]
    assert matched["matched"] is True
    assert matched["theme_slug"] == "vintage_pulp_fantasy"
    assert matched["filename"] == "img_0001.png"
    assert matched["is_current"] is True
    assert matched["thumbnail_url"].startswith("/api/themes/")
    unmatched = by_id["MY_F9999"]
    assert unmatched["matched"] is False
    assert unmatched["thumbnail_url"] == "/api/tv/art/MY_F9999/thumbnail"
    # B was pruned from the DB
    assert library.tv_content_id(img2) is None


def test_tv_art_thumbnail_served_and_cached(app_with_tv):
    client, _ = app_with_tv
    r = client.get("/api/tv/art/MY_F9999/thumbnail")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content == b"\xff\xd8fake-jpeg"


def test_tv_upload_selected(app_with_tv):
    client, lib_root = app_with_tv
    r = client.post(
        "/api/tv/art/upload",
        json={
            "items": [
                {"slug": "vintage_pulp_fantasy", "filename": "img_0001.png"},
                {"slug": "vintage_pulp_fantasy", "filename": "img_0003.png"},
            ],
            "matte": "shadowbox",
            "matte_color": "polar",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    # Uploads now visible on the TV list and flagged in the theme detail
    art = client.get("/api/tv/art").json()
    assert {i["content_id"] for i in art["items"]} == set(body["uploaded"])
    detail = client.get("/api/themes/vintage_pulp_fantasy").json()
    on_tv = {t["filename"]: t for t in detail["images"] if t["on_tv"]}
    assert set(on_tv) == {"img_0001.png", "img_0003.png"}
    assert on_tv["img_0001.png"]["content_id"] in body["uploaded"]


def test_tv_upload_missing_image_404(app_with_tv):
    client, _ = app_with_tv
    r = client.post(
        "/api/tv/art/upload",
        json={"items": [{"slug": "vintage_pulp_fantasy", "filename": "nope.png"}]},
    )
    assert r.status_code == 404


def test_tv_delete_selected(app_with_tv):
    client, _ = app_with_tv
    up = client.post(
        "/api/tv/art/upload",
        json={"items": [{"slug": "vintage_pulp_fantasy", "filename": "img_0001.png"}]},
    ).json()
    cid = up["uploaded"][0]
    r = client.post("/api/tv/art/delete", json={"content_ids": [cid]})
    assert r.status_code == 200
    assert r.json()["removed"] == [cid]
    assert r.json()["failed"] == []
    # Gone from both the TV list and the theme detail flags
    art = client.get("/api/tv/art").json()
    assert art["items"] == []
    detail = client.get("/api/themes/vintage_pulp_fantasy").json()
    assert all(not t["on_tv"] for t in detail["images"])


def test_tv_select_and_slideshow(app_with_tv):
    client, _ = app_with_tv
    r = client.post("/api/tv/art/select", json={"content_id": "MY_F0001"})
    assert r.status_code == 200
    assert FakeFrameTVClient.selected == ["MY_F0001"]
    r = client.post("/api/tv/slideshow", json={"minutes": 60})
    assert r.status_code == 200
    assert FakeFrameTVClient.slideshow_minutes == [60]


# ----- API token auth ---------------------------------------------------------


def test_no_token_configured_means_open_api(app_with_fixture):
    client, _ = app_with_fixture
    assert client.get("/api/themes").status_code == 200
    assert client.get("/api/health").json()["auth_required"] is False


def test_token_required_when_configured(app_with_fixture, monkeypatch):
    client, _ = app_with_fixture
    monkeypatch.setenv("FRAMEFORGE_API_TOKEN", "s3cret")
    # health stays open and advertises that auth is on
    h = client.get("/api/health")
    assert h.status_code == 200
    assert h.json()["auth_required"] is True
    # everything else is closed without the token
    assert client.get("/api/themes").status_code == 401
    assert (
        client.post("/api/tv/slideshow", json={"minutes": 30}).status_code == 401
    )
    # Bearer header works
    r = client.get("/api/themes", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200
    # query param works (for image URLs / WebSocket that can't set headers)
    r = client.get(
        "/api/themes/vintage_pulp_fantasy/images/img_0001.png",
        params={"token": "s3cret"},
    )
    assert r.status_code == 200
    # wrong token rejected
    r = client.get("/api/themes", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


# ----- TV host persistence ------------------------------------------------


def test_tv_host_saved_and_forgotten(app_with_tv, monkeypatch):
    """PUT /api/tv/host persists to settings.json and Config picks it up."""
    client, lib_root = app_with_tv
    monkeypatch.delenv("FRAMEFORGE_TV_HOST")

    # Without env var or saved host: TV endpoints fall back / 503
    assert client.get("/api/tv/art").json()["connected"] is False
    assert client.post("/api/tv/slideshow", json={"minutes": 30}).status_code == 503

    r = client.put("/api/tv/host", json={"host": "192.0.2.99"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "host": "192.0.2.99", "env_override": False}
    assert json.loads((lib_root / "settings.json").read_text())["tv_host"] == "192.0.2.99"

    # Config now resolves the saved host: live TV endpoints work (fake client)
    art = client.get("/api/tv/art").json()
    assert art["connected"] is True

    # Forget: settings cleared and endpoints revert to unconfigured
    r = client.delete("/api/tv/host")
    assert r.status_code == 200
    assert "tv_host" not in json.loads((lib_root / "settings.json").read_text())
    assert client.get("/api/tv/art").json()["connected"] is False


def test_tv_host_env_override_flagged(app_with_tv):
    client, _ = app_with_tv  # fixture sets FRAMEFORGE_TV_HOST=192.0.2.10
    r = client.put("/api/tv/host", json={"host": "192.0.2.99"})
    assert r.status_code == 200
    assert r.json()["env_override"] is True


def test_tv_host_empty_rejected(app_with_tv):
    client, _ = app_with_tv
    assert client.put("/api/tv/host", json={"host": "   "}).status_code == 400


# ----- Imported image sidecars (no prompt/seed/generated_at) ------------------


def test_themes_list_includes_imported(app_with_imported):
    client, _ = app_with_imported
    cards = client.get("/api/themes").json()
    imported = next(c for c in cards if c["slug"] == "imported")
    assert imported["title"] == "Imported"
    assert imported["image_count"] == 1
    assert imported["last_refreshed"] == "2026-07-01T10:00:00Z"  # from imported_at


def test_imported_theme_detail_uses_original_filename(app_with_imported):
    client, _ = app_with_imported
    r = client.get("/api/themes/imported")
    assert r.status_code == 200
    d = r.json()
    assert d["images"][0]["prompt_short"] == "sunset.jpg"
    # expansion never populates for imported themes, even when asked
    r2 = client.get("/api/themes/imported?with_expansion=true")
    assert r2.status_code == 200 and r2.json()["expansion"] is None


def test_imported_inspect_and_manifest(app_with_imported):
    client, lib_root = app_with_imported
    r = client.get("/api/themes/imported/images/img_0001.png/inspect")
    assert r.status_code == 200
    assert r.json()["prompt"] == "sunset.jpg"

    from frameforge.config import Config
    from frameforge.library import Library

    lib = Library(Config(library_root=lib_root))
    manifest = lib.write_manifest("imported")
    assert "img_0001.png" in manifest.read_text()


# ----- Image imports -------------------------------------------------------


def _upload_png(w=1920, h=1080):
    from io import BytesIO

    buf = BytesIO()
    Image.new("RGB", (w, h), (10, 120, 90)).save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_import_endpoint_no_crop(app_with_fixture):
    client, lib_root = app_with_fixture
    r = client.post(
        "/api/imports",
        files={"file": ("photo.png", _upload_png(), "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "imported" and body["filename"] == "img_0001.png"
    assert (lib_root / "imported" / "img_0001.png").exists()
    assert (lib_root / "imported" / "originals" / "photo.png").exists()
    # imported theme now appears in the themes list
    slugs = [c["slug"] for c in client.get("/api/themes").json()]
    assert "imported" in slugs


def test_import_endpoint_with_crop(app_with_fixture):
    client, lib_root = app_with_fixture
    r = client.post(
        "/api/imports",
        files={"file": ("wide.png", _upload_png(4000, 3000), "image/png")},
        data={"crop_x": "0", "crop_y": "375", "crop_w": "4000", "crop_h": "2250"},
    )
    assert r.status_code == 200
    out = Image.open(lib_root / "imported" / r.json()["filename"])
    assert (out.width, out.height) == (3840, 2160)


def test_import_endpoint_partial_crop_400(app_with_fixture):
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports",
        files={"file": ("x.png", _upload_png(), "image/png")},
        data={"crop_x": "0"},
    )
    assert r.status_code == 400


def test_import_endpoint_bad_image_400(app_with_fixture):
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports", files={"file": ("x.png", b"garbage", "image/png")}
    )
    assert r.status_code == 400


def test_import_endpoint_oversized_413(app_with_fixture, monkeypatch):
    import frameforge.imports as imports_mod

    monkeypatch.setattr(imports_mod, "MAX_UPLOAD_BYTES", 100)
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports", files={"file": ("x.png", _upload_png(), "image/png")}
    )
    assert r.status_code == 413


def test_recrop_endpoint(app_with_fixture):
    client, lib_root = app_with_fixture
    up = client.post(
        "/api/imports",
        files={"file": ("sq.png", _upload_png(4000, 4000), "image/png")},
        data={"crop_x": "0", "crop_y": "0", "crop_w": "4000", "crop_h": "2250"},
    )
    filename = up.json()["filename"]
    r = client.post(
        f"/api/imports/{filename}/recrop",
        json={"crop_x": 0, "crop_y": 1750, "crop_w": 4000, "crop_h": 2250},
    )
    assert r.status_code == 200
    meta = json.loads((lib_root / "imported" / filename).with_suffix(".json").read_text())
    assert meta["crop"]["y"] == 1750


def test_recrop_unknown_404(app_with_fixture):
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports/img_9999.png/recrop",
        json={"crop_x": 0, "crop_y": 0, "crop_w": 1600, "crop_h": 900},
    )
    assert r.status_code == 404

"""Server endpoint tests with a fixture library on disk."""
import json
import os
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

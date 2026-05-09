"""Smoke tests for library bookkeeping (no network/TV required)."""
import json
from pathlib import Path

from frameforge.config import Config, slugify
from frameforge.library import Library


def test_slugify():
    assert slugify("Vintage Pulp Fantasy") == "vintage_pulp_fantasy"
    assert slugify("  Edward Hopper / Americana!  ") == "edward_hopper___americana"
    assert slugify("Studio Ghibli Skies") == "studio_ghibli_skies"


def _make_fake_image(theme_dir: Path, idx: int, prompt: str) -> Path:
    """Write a fake PNG + sidecar pair."""
    img = theme_dir / f"img_{idx:04d}.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    sidecar = img.with_suffix(".json")
    sidecar.write_text(
        json.dumps(
            {
                "filename": img.name,
                "theme": "test theme",
                "prompt": prompt,
                "expansion_seed": "deadbeef0001",
                "expansion_index": idx - 1,
                "image_model": "grok-imagine-image-quality",
                "text_model_for_expansion": "grok-4.3",
                "provider": "xai",
                "resolution": "2k",
                "aspect_ratio": "16:9",
                "generated_at": "2026-05-08T00:00:00Z",
                "frameforge_version": "0.1.0",
            }
        )
    )
    return img


def test_manifest_roundtrip(tmp_path: Path):
    cfg = Config(library_root=tmp_path, xai_api_key="fake")
    theme_dir = cfg.theme_dir("test")
    theme_dir.mkdir(parents=True)

    _make_fake_image(theme_dir, 1, "a thing")
    _make_fake_image(theme_dir, 2, "another thing")

    lib = Library(cfg)
    manifest = lib.write_manifest("test")
    assert manifest.exists()
    text = manifest.read_text()
    assert "deadbeef0001" in text
    assert "a thing" in text
    assert "another thing" in text


def test_list_theme_skips_missing_sidecar(tmp_path: Path):
    cfg = Config(library_root=tmp_path, xai_api_key="fake")
    theme_dir = cfg.theme_dir("test")
    theme_dir.mkdir(parents=True)

    _make_fake_image(theme_dir, 1, "ok")
    # orphan png with no sidecar
    (theme_dir / "img_0002.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    lib = Library(cfg)
    entries = lib.list_theme("test")
    assert len(entries) == 1
    assert entries[0].image_path.name == "img_0001.png"


def test_list_themes(tmp_path: Path):
    cfg = Config(library_root=tmp_path, xai_api_key="fake")
    (tmp_path / "vintage_pulp_fantasy").mkdir()
    (tmp_path / "dutch_masters").mkdir()
    (tmp_path / ".frameforge_token").write_text("x")  # hidden, should skip

    lib = Library(cfg)
    themes = lib.list_themes()
    assert themes == ["dutch_masters", "vintage_pulp_fantasy"]


def test_tv_upload_tracking(tmp_path: Path):
    cfg = Config(library_root=tmp_path, xai_api_key="fake")
    lib = Library(cfg)

    img_path = tmp_path / "test" / "img_0001.png"
    img_path.parent.mkdir(parents=True)
    img_path.write_bytes(b"\x89PNG")

    lib.record_upload("content-abc", img_path, "test", "2026-05-09T00:00:00Z")
    assert lib.is_on_tv(img_path) is True

    uploads = lib.list_tv_uploads("test")
    assert len(uploads) == 1
    assert uploads[0][0] == "content-abc"

    lib.remove_upload("content-abc")
    assert lib.is_on_tv(img_path) is False


def test_to_jpeg_conversion(tmp_path: Path):
    """Verify PNG→JPEG conversion produces valid JPEG bytes."""
    from PIL import Image

    cfg = Config(library_root=tmp_path, xai_api_key="fake")
    lib = Library(cfg)

    # Create a real (tiny) PNG
    png_path = tmp_path / "tiny.png"
    Image.new("RGB", (10, 10), color=(180, 100, 50)).save(png_path)

    jpeg_bytes = lib.to_jpeg(png_path)
    # JPEG magic bytes
    assert jpeg_bytes[:3] == b"\xff\xd8\xff"
    assert len(jpeg_bytes) > 100

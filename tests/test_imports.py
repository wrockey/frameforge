"""Import pipeline: crop math, validation, atomicity, originals."""
import json
from io import BytesIO

import pytest
from PIL import Image

from frameforge.config import Config
from frameforge.imports import (
    IMPORTED_SLUG,
    ImportTooLarge,
    InvalidCrop,
    InvalidImage,
    OriginalMissing,
    import_image,
    recrop_image,
)


def _png_bytes(w: int, h: int, color=(200, 120, 40)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def cfg(tmp_path) -> Config:
    return Config(library_root=tmp_path / "lib")


def test_import_with_crop(cfg):
    data = _png_bytes(4096, 4096)
    r = import_image(cfg, data, "square.png", (0, 1024, 4096, 2304))
    assert r.filename == "img_0001.png"
    d = cfg.theme_dir(IMPORTED_SLUG)
    out = Image.open(d / r.filename)
    assert (out.width, out.height) == (3840, 2160)  # downsized, never upscaled
    meta = json.loads((d / "img_0001.json").read_text())
    assert meta["source"] == "imported"
    assert meta["theme"] == "Imported"
    assert meta["original_filename"] == "square.png"
    assert meta["crop"] == {"x": 0, "y": 1024, "w": 4096, "h": 2304}
    assert (d / "originals" / "square.png").read_bytes() == data


def test_small_crop_not_upscaled(cfg):
    r = import_image(cfg, _png_bytes(1920, 1920), "s.png", (0, 0, 1600, 900))
    out = Image.open(cfg.theme_dir(IMPORTED_SLUG) / r.filename)
    assert (out.width, out.height) == (1600, 900)


def test_import_keep_original_portrait(cfg):
    r = import_image(cfg, _png_bytes(1080, 1920), "portrait.png", None)
    out = Image.open(cfg.theme_dir(IMPORTED_SLUG) / r.filename)
    assert (out.width, out.height) == (1080, 1920)
    meta = json.loads(
        (cfg.theme_dir(IMPORTED_SLUG) / "img_0001.json").read_text()
    )
    assert meta["crop"] is None


def test_import_no_crop_downsizes_16_9(cfg):
    r = import_image(cfg, _png_bytes(7680, 4320), "big.png", None)
    out = Image.open(cfg.theme_dir(IMPORTED_SLUG) / r.filename)
    assert (out.width, out.height) == (3840, 2160)


def test_filenames_increment_and_original_collisions_suffixed(cfg):
    import_image(cfg, _png_bytes(1600, 900), "a.png", None)
    r2 = import_image(cfg, _png_bytes(1600, 900), "a.png", None)
    assert r2.filename == "img_0002.png"
    assert r2.original_filename == "a_1.png"


def test_crop_must_be_16_9(cfg):
    with pytest.raises(InvalidCrop):
        import_image(cfg, _png_bytes(4000, 3000), "x.png", (0, 0, 1000, 1000))


def test_crop_must_be_in_bounds(cfg):
    with pytest.raises(InvalidCrop):
        import_image(cfg, _png_bytes(1920, 1080), "x.png", (500, 0, 1920, 1080))


def test_rejects_non_image(cfg):
    with pytest.raises(InvalidImage):
        import_image(cfg, b"not an image at all", "x.png", None)
    assert not (cfg.theme_dir(IMPORTED_SLUG) / "img_0001.png").exists()


def test_rejects_oversized(cfg, monkeypatch):
    monkeypatch.setattr("frameforge.imports.MAX_UPLOAD_BYTES", 1000)
    with pytest.raises(ImportTooLarge):
        import_image(cfg, _png_bytes(1920, 1080), "x.png", None)


def test_recrop_from_original(cfg):
    data = _png_bytes(4096, 4096)
    r = import_image(cfg, data, "sq.png", (0, 0, 4096, 2304))
    r2 = recrop_image(cfg, r.filename, (0, 1792, 4096, 2304))
    assert r2.filename == r.filename  # same file, replaced in place
    meta = json.loads(
        (cfg.theme_dir(IMPORTED_SLUG) / "img_0001.json").read_text()
    )
    assert meta["crop"]["y"] == 1792
    assert "recropped_at" in meta


def test_recrop_missing_raises(cfg):
    with pytest.raises(OriginalMissing):
        recrop_image(cfg, "img_9999.png", (0, 0, 1600, 900))

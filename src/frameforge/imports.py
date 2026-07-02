"""Import user images into the library: 16:9 crop, originals preserved.

Imported images are ordinary library entries under the reserved `imported`
theme directory; the untouched upload lives in imported/originals/ so a
recrop never loses quality. PNG-then-sidecar write order matters: the
library ignores a PNG with no sidecar, so a crash between the two writes
leaves nothing user-visible.
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from . import __version__
from .config import Config

IMPORTED_SLUG = "imported"
IMPORTED_TITLE = "Imported"
TARGET_W, TARGET_H = 3840, 2160
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_RATIO = 16 / 9
_RATIO_TOLERANCE = 0.01

# Guards the img_NNNN filename-assignment-and-write section (from
# next_import_filename through _write_png_then_sidecar). The HTTP endpoint
# runs import_image/recrop_image in threads; without this lock, two
# concurrent imports can compute the same next filename and clobber each
# other's PNG/sidecar. Validation and image decoding happen outside the
# lock so failures never serialize concurrent requests.
_write_lock = threading.Lock()


class ImportTooLarge(Exception):
    pass


class InvalidImage(Exception):
    pass


class InvalidCrop(Exception):
    pass


class OriginalMissing(Exception):
    pass


@dataclass
class ImportResult:
    filename: str
    original_filename: str
    width: int
    height: int


def is_16_9(w: int, h: int) -> bool:
    return h > 0 and abs(w / h - _RATIO) <= _RATIO * _RATIO_TOLERANCE


def next_import_filename(theme_dir: Path) -> str:
    nums = [int(p.stem.split("_")[1]) for p in theme_dir.glob("img_*.png")]
    return f"img_{(max(nums) + 1 if nums else 1):04d}.png"


def _save_original(theme_dir: Path, original_name: str, data: bytes) -> Path:
    originals = theme_dir / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    safe = Path(original_name).name or "import"
    dest = originals / safe
    stem, suffix = dest.stem, dest.suffix
    n = 1
    while dest.exists():
        dest = originals / f"{stem}_{n}{suffix}"
        n += 1
    dest.write_bytes(data)
    return dest


def _crop_and_fit(img: Image.Image, crop: tuple[int, int, int, int] | None) -> Image.Image:
    out = img.convert("RGB")
    if crop is None:
        if is_16_9(out.width, out.height) and out.width > TARGET_W:
            out = out.resize((TARGET_W, TARGET_H), Image.LANCZOS)
        return out
    x, y, w, h = crop
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > out.width or y + h > out.height:
        raise InvalidCrop(
            f"Crop ({x},{y},{w},{h}) outside image bounds {out.width}x{out.height}"
        )
    if not is_16_9(w, h):
        raise InvalidCrop(f"Crop {w}x{h} is not 16:9")
    out = out.crop((x, y, x + w, y + h))
    if out.width > TARGET_W:
        out = out.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    return out


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write_png_then_sidecar(
    theme_dir: Path,
    final_name: str,
    out: Image.Image,
    sidecar: dict,
) -> None:
    tmp = theme_dir / (final_name + ".tmp")
    out.save(tmp, format="PNG")
    tmp.rename(theme_dir / final_name)
    (theme_dir / final_name).with_suffix(".json").write_text(
        json.dumps(sidecar, indent=2)
    )


def import_image(
    cfg: Config,
    data: bytes,
    original_name: str,
    crop: tuple[int, int, int, int] | None,
) -> ImportResult:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImportTooLarge(
            f"{len(data)} bytes exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB cap"
        )
    try:
        img = Image.open(BytesIO(data))
        img.load()
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError) as e:
        raise InvalidImage(f"Not a readable image: {e}")

    out = _crop_and_fit(img, crop)  # validate before touching disk
    theme_dir = cfg.theme_dir(IMPORTED_SLUG)
    theme_dir.mkdir(parents=True, exist_ok=True)
    # Filename assignment through write must be atomic w.r.t. other imports.
    with _write_lock:
        original_path = _save_original(theme_dir, original_name, data)
        final_name = next_import_filename(theme_dir)
        sidecar = {
            "filename": final_name,
            "theme": IMPORTED_TITLE,
            "source": "imported",
            "original_filename": original_path.name,
            "imported_at": _now(),
            "crop": (
                {"x": crop[0], "y": crop[1], "w": crop[2], "h": crop[3]}
                if crop
                else None
            ),
            "width": out.width,
            "height": out.height,
            "frameforge_version": __version__,
        }
        _write_png_then_sidecar(theme_dir, final_name, out, sidecar)
    return ImportResult(final_name, original_path.name, out.width, out.height)


def recrop_image(
    cfg: Config, filename: str, crop: tuple[int, int, int, int]
) -> ImportResult:
    theme_dir = cfg.theme_dir(IMPORTED_SLUG)
    sidecar_path = (theme_dir / filename).with_suffix(".json")
    if not sidecar_path.exists():
        raise OriginalMissing(f"No imported image named {filename}")
    meta = json.loads(sidecar_path.read_text())
    original = theme_dir / "originals" / meta["original_filename"]
    if not original.exists():
        raise OriginalMissing(f"Original file for {filename} is gone")

    try:
        img = Image.open(original)
        img.load()
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError) as e:
        raise InvalidImage(f"Original for {filename} is not a readable image: {e}")
    out = _crop_and_fit(img, crop)
    meta.update(
        {
            "crop": {"x": crop[0], "y": crop[1], "w": crop[2], "h": crop[3]},
            "width": out.width,
            "height": out.height,
            "recropped_at": _now(),
        }
    )
    # Same img_NNNN write section as import_image; guards concurrent recrops.
    with _write_lock:
        _write_png_then_sidecar(theme_dir, filename, out, meta)
    return ImportResult(filename, meta["original_filename"], out.width, out.height)

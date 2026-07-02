"""TV connection lifecycle smoke-check.

Runs the full connect → list → thumbnail → upload → show → delete lifecycle
against a real Frame and reports pass/fail per step. The TV can't live in CI,
so this is the manual regression tool: `frameforge doctor`.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Callable, Optional

from PIL import Image, ImageDraw

from .config import Config
from .library import Library
from .tv_client import FrameTVClient


@dataclass
class StepResult:
    name: str
    ok: bool
    detail: str = ""


def _test_card() -> bytes:
    """A recognizable 16:9 test image: brown field, ivory double border."""
    img = Image.new("RGB", (1920, 1080), (92, 64, 51))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 1879, 1039], outline=(245, 241, 232), width=12)
    d.rectangle([80, 80, 1839, 999], outline=(245, 241, 232), width=4)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def run_doctor(
    cfg: Config,
    host: Optional[str] = None,
    mutate: bool = True,
    client_factory: Callable = FrameTVClient,
    echo: Callable[[str], None] = print,
) -> list[StepResult]:
    results: list[StepResult] = []

    def step(name: str, fn: Callable[[], str]) -> bool:
        try:
            detail = fn() or ""
        except Exception as e:
            results.append(StepResult(name, False, str(e)))
            echo(f"  ✗ {name} — {e}")
            return False
        results.append(StepResult(name, True, detail))
        echo(f"  ✓ {name}" + (f" — {detail}" if detail else ""))
        return True

    target = host or cfg.tv_host
    if not target:
        results.append(
            StepResult("resolve host", False, "no TV host configured (env, settings.json, or --host)")
        )
        echo("  ✗ resolve host — no TV host configured")
        return results
    results.append(StepResult("resolve host", True, target))
    echo(f"  ✓ resolve host — {target}")

    client = client_factory(cfg, target)

    def check_status() -> str:
        s = client.status()
        if not s.get("connected"):
            raise RuntimeError(s.get("error", "not connected"))
        return f"art_mode={s.get('art_mode')}"

    if not step("connect + status", check_status):
        return results

    art_items: list[dict] = []

    def check_list() -> str:
        nonlocal art_items
        art_items = client.list_art()
        return f"{len(art_items)} piece(s) on the TV"

    step("list art", check_list)

    def check_thumb() -> str:
        if not art_items:
            return "skipped (no art on TV)"
        data = client.get_thumbnail(art_items[0]["content_id"])
        return f"{len(data)} bytes"

    step("fetch thumbnail", check_thumb)

    if not mutate:
        return results

    library = Library(cfg)
    uploaded: list[str] = []
    card_path = cfg.library_root / ".doctor_test_card.png"

    def do_upload() -> str:
        card_path.write_bytes(_test_card())
        nonlocal uploaded
        uploaded = client.upload_batch(library, "doctor_test", [card_path])
        if not uploaded:
            raise RuntimeError("upload returned no content_id")
        return uploaded[0]

    step("upload test card", do_upload)

    if uploaded:
        def do_show() -> str:
            client.select_art(uploaded[0])
            return ""

        step("show test card", do_show)

        def do_delete() -> str:
            removed = client.delete_art(uploaded)
            for cid in removed:
                library.remove_upload(cid)
            if set(removed) != set(uploaded):
                raise RuntimeError(f"only removed {removed}")
            return ""

        step("delete test card", do_delete)

    card_path.unlink(missing_ok=True)
    return results

"""High-level workflows that compose the other modules."""
from __future__ import annotations

import asyncio
from pathlib import Path

from rich.console import Console

from .config import Config, slugify
from .discover import DiscoveredTV, discover
from .expander import expand_theme
from .generator import generate_batch
from .imports import IMPORTED_SLUG
from .library import Library
from .tv_client import FrameTVClient

console = Console()


def find_tv(cfg: Config) -> DiscoveredTV:
    if cfg.tv_host:
        return DiscoveredTV(host=cfg.tv_host, model_name="(manual)", is_frame=True)
    console.print("[cyan]Searching for Frame TVs on your network…[/cyan]")
    found = discover()
    frames = [f for f in found if f.is_frame]
    if not frames:
        if not found:
            raise RuntimeError(
                "No Samsung TVs found. Ensure the TV is on and on the same Wi-Fi. "
                "You can also set FRAMEFORGE_TV_HOST in your .env."
            )
        console.print("[yellow]No Frame TVs found, but other Samsungs:[/yellow]")
        for tv in found:
            console.print(f"  • {tv.host}  ({tv.model_name})")
        raise RuntimeError("Set FRAMEFORGE_TV_HOST to override.")
    tv = frames[0]
    console.print(f"[green]Found Frame TV:[/green] {tv.host} ({tv.model_name})")
    return tv


def run_generate(cfg: Config, theme: str, count: int | None = None) -> Path:
    cfg.validate()
    slug = slugify(theme)
    if slug == IMPORTED_SLUG:
        raise RuntimeError(
            "'imported' is reserved for imported images and cannot be generated into"
        )
    out_dir = cfg.theme_dir(slug)

    console.print(f"[cyan]Expanding theme:[/cyan] {theme}")
    expansion = expand_theme(cfg, theme, count)
    console.print(f"  Got {len(expansion.prompts)} prompts (seed={expansion.seed})")

    console.print(f"[cyan]Generating images → {out_dir}[/cyan]")
    images = asyncio.run(generate_batch(cfg, expansion, out_dir))
    console.print(f"  {len(images)} images saved")

    library = Library(cfg)
    manifest = library.write_manifest(slug)
    console.print(f"  Manifest: {manifest}")
    return out_dir


def run_push(cfg: Config, theme: str, slideshow_minutes: int = 30) -> None:
    cfg.validate()
    slug = slugify(theme)
    library = Library(cfg)
    entries = library.list_theme(slug)
    if not entries:
        raise RuntimeError(
            f"No images for theme '{theme}'. Run `frameforge generate` first."
        )

    tv_info = find_tv(cfg)
    client = FrameTVClient(cfg, tv_info.host)
    client.pair()

    console.print(f"[cyan]Uploading {len(entries)} images to TV…[/cyan]")
    client.upload_batch(library, slug, [e.image_path for e in entries])

    console.print("[cyan]Pruning to storage cap…[/cyan]")
    client.prune_to_cap(library)

    console.print(f"[cyan]Starting slideshow ({slideshow_minutes} min/image)…[/cyan]")
    client.start_slideshow(slideshow_minutes)
    console.print("[green]Done.[/green]")


def run_cycle(
    cfg: Config, theme: str, count: int | None = None, slideshow_minutes: int = 30
) -> None:
    run_generate(cfg, theme, count)
    run_push(cfg, theme, slideshow_minutes)

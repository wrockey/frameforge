"""FrameForge CLI."""
from __future__ import annotations

import click

from .config import Config
from .discover import discover
from .pipeline import run_cycle, run_generate, run_push


@click.group()
def cli() -> None:
    """FrameForge — AI-generated themed art for Samsung Frame TVs."""


@cli.command()
def find() -> None:
    """List Samsung TVs on the local network."""
    results = discover()
    if not results:
        click.echo("No Samsung TVs found.")
        return
    for r in results:
        marker = "🖼️ " if r.is_frame else "📺"
        click.echo(f"{marker} {r.host}  {r.model_name}")


@cli.command()
@click.option("--theme", required=True, help='e.g. "vintage pulp fantasy"')
@click.option("--count", type=int, default=None, help="Images to generate.")
def generate(theme: str, count: int | None) -> None:
    """Generate a themed image batch (no TV upload)."""
    run_generate(Config(), theme, count)


@cli.command()
@click.option("--theme", required=True)
@click.option("--minutes", type=int, default=30, help="Slideshow interval.")
def push(theme: str, minutes: int) -> None:
    """Push an already-generated theme to the TV."""
    run_push(Config(), theme, minutes)


@cli.command()
@click.option("--theme", required=True)
@click.option("--count", type=int, default=None)
@click.option("--minutes", type=int, default=30)
def cycle(theme: str, count: int | None, minutes: int) -> None:
    """Generate + push in one shot."""
    run_cycle(Config(), theme, count, minutes)


if __name__ == "__main__":
    cli()

"""Generate images from prompts via the xAI Imagine API."""
from __future__ import annotations

import asyncio
import base64
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

import httpx
from openai import AsyncOpenAI
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import Config
from .expander import Expansion


CONCURRENCY = 4

# Type for the progress callback used by the FastAPI server to push WS updates
ProgressCallback = Callable[[dict], Awaitable[None]] | None


@dataclass
class GeneratedImage:
    path: Path
    sidecar_path: Path
    prompt: str
    index: int


def _sidecar(
    cfg: Config,
    expansion: Expansion,
    prompt: str,
    index: int,
    image_path: Path,
) -> dict:
    return {
        "filename": image_path.name,
        "theme": expansion.theme,
        "prompt": prompt,
        "expansion_seed": expansion.seed,
        "expansion_index": index,
        "image_model": cfg.image_model,
        "text_model_for_expansion": expansion.text_model,
        "provider": "xai",
        "resolution": cfg.resolution,
        "aspect_ratio": cfg.aspect_ratio,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "frameforge_version": cfg.app_version,
    }


async def _fetch_url(url: str, dest: Path) -> None:
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)


async def _generate_one(
    client: AsyncOpenAI,
    cfg: Config,
    expansion: Expansion,
    prompt: str,
    index: int,
    out_dir: Path,
    semaphore: asyncio.Semaphore,
) -> GeneratedImage:
    async with semaphore:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(min=2, max=20),
            retry=retry_if_exception_type(Exception),
            reraise=True,
        ):
            with attempt:
                response = await client.images.generate(
                    model=cfg.image_model,
                    prompt=prompt,
                    extra_body={
                        "resolution": cfg.resolution,
                        "aspect_ratio": cfg.aspect_ratio,
                    },
                )
                data = response.data[0]
                image_path = out_dir / f"img_{index:04d}.png"

                if getattr(data, "url", None):
                    await _fetch_url(data.url, image_path)
                elif getattr(data, "b64_json", None):
                    image_path.write_bytes(base64.b64decode(data.b64_json))
                else:
                    raise RuntimeError("No image payload in response")

                sidecar_path = image_path.with_suffix(".json")
                sidecar_path.write_text(
                    json.dumps(
                        _sidecar(cfg, expansion, prompt, index, image_path),
                        indent=2,
                    )
                )
                return GeneratedImage(
                    path=image_path,
                    sidecar_path=sidecar_path,
                    prompt=prompt,
                    index=index,
                )
        raise RuntimeError("unreachable")


async def generate_batch(
    cfg: Config,
    expansion: Expansion,
    out_dir: Path,
    on_progress: ProgressCallback = None,
) -> list[GeneratedImage]:
    """Generate the full image batch, calling on_progress({ "done": int,
    "total": int, "last_filename": str | None }) after each image."""
    out_dir.mkdir(parents=True, exist_ok=True)
    client = AsyncOpenAI(api_key=cfg.xai_api_key, base_url="https://api.x.ai/v1")
    semaphore = asyncio.Semaphore(CONCURRENCY)
    total = len(expansion.prompts)
    done = 0
    results: list[GeneratedImage] = []

    async def _wrapped(prompt: str, idx: int) -> GeneratedImage | None:
        nonlocal done
        try:
            img = await _generate_one(
                client, cfg, expansion, prompt, idx, out_dir, semaphore
            )
        except Exception as e:
            print(f"  ! generation failed for prompt {idx}: {e}")
            return None
        done += 1
        if on_progress is not None:
            await on_progress(
                {"done": done, "total": total, "last_filename": img.path.name}
            )
        return img

    tasks = [_wrapped(p, i) for i, p in enumerate(expansion.prompts)]
    raw = await asyncio.gather(*tasks)
    for r in raw:
        if r is not None:
            results.append(r)
    return results

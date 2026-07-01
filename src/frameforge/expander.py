"""Expand a theme into a list of varied image prompts using Grok 4.3."""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import List

from openai import OpenAI

from .config import Config


SYSTEM_PROMPT = """You are a creative director generating prompt variations for an
AI image model that will display art on a Samsung Frame TV in someone's home.

Given a theme, produce {count} distinct, evocative image prompts. Each prompt should:
- Vary substantially in subject, composition, and time-of-day/mood
- Stay within the spirit of the theme (don't drift)
- Be 25-60 words, descriptive and visual
- Avoid text, logos, or watermarks in the image
- Specify lighting, color palette, and a stylistic reference where appropriate
- Be safe for all-ages display in a living room

Return JSON only: a single object with key "prompts" mapping to an array of strings.
No commentary, no markdown fences."""


@dataclass
class Expansion:
    theme: str
    seed: str  # for manifest reproducibility
    prompts: List[str]
    text_model: str
    generated_at: str
    frameforge_version: str = ""

    def as_panel_data(self) -> dict:
        """Shape for the UI's prompt-expansion panel."""
        return {
            "theme": self.theme,
            "seed": self.seed,
            "count": len(self.prompts),
            "prompts": self.prompts,
            "text_model": self.text_model,
            "generated_at": self.generated_at,
            "frameforge_version": self.frameforge_version,
        }


def _seed(theme: str, count: int, version: str) -> str:
    raw = f"{theme}|{count}|{version}|{int(time.time() // 86400)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def expand_theme(cfg: Config, theme: str, count: int | None = None) -> Expansion:
    count = count or cfg.target_count
    client = OpenAI(api_key=cfg.xai_api_key, base_url="https://api.x.ai/v1")
    seed = _seed(theme, count, cfg.app_version)

    response = client.chat.completions.create(
        model=cfg.text_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.format(count=count)},
            {"role": "user", "content": f"Theme: {theme}\nVariation seed: {seed}"},
        ],
        response_format={"type": "json_object"},
        temperature=0.9,
    )
    payload = json.loads(response.choices[0].message.content)
    prompts = payload["prompts"]
    if not isinstance(prompts, list) or not prompts:
        raise RuntimeError(f"Bad expansion payload: {payload!r}")

    return Expansion(
        theme=theme,
        seed=seed,
        prompts=prompts[:count],
        text_model=cfg.text_model,
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        frameforge_version=cfg.app_version,
    )

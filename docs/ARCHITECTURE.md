# FrameForge Architecture

## Goals

1. Generate cohesive themed image batches for a Samsung Frame TV.
2. Reproducible: every image traceable to (theme, prompt, model, version).
3. Grandma-ready onboarding: SSDP discovery, one-tap pairing, no IP-typing.
4. Local-first: no cloud state; everything lives in `~/Pictures/FrameForge`.

## Module map

| Module       | Responsibility                                          |
|--------------|---------------------------------------------------------|
| `config`     | Env loading, paths, defaults, app version               |
| `discover`   | SSDP M-SEARCH for Samsung TVs, Frame model filtering    |
| `expander`   | Theme → varied prompt list via Grok 4.3 (JSON mode)     |
| `generator`  | Concurrent image generation against xAI Imagine API     |
| `library`    | On-disk store + sidecars + manifest CSV + SQLite index  |
| `tv_client`  | `samsungtvws` wrapper: pair, upload, prune, slideshow   |
| `pipeline`   | Composed flows: `find_tv`, `run_generate`, `run_push`   |
| `cli`        | `click`-based command surface                           |
| `server`     | FastAPI service for the web UI; WebSocket status stream |

## Data flow for one cycle

```
theme string ──► expander ──► [N prompts]
                                    │
                                    ▼
                          generator (4-way async)
                                    │
                  ┌─────────────────┴──────────────────┐
                  ▼                                    ▼
       PNG file in theme dir                JSON sidecar (full provenance)
                  │
                  ▼
            library.write_manifest ──► manifest.csv
                  │
                  ▼
           tv_client.upload_batch ──► Frame TV (JPEG via samsungtvws)
                  │
                  ▼
           tv_client.prune_to_cap (rolling window)
                  │
                  ▼
           tv_client.start_slideshow
```

## Two consumer surfaces

```
                       ┌────────────────────────────┐
                       │   Claude Design web UI     │
                       │   (HTML/JS)                │
                       └─────────────┬──────────────┘
                                     │ REST + WS
                                     ▼
        ┌──────────────────────────────────────────────────┐
        │   frameforged  —  FastAPI on localhost:8765      │
        └──────────────────────────────────────────────────┘
                                     │
                                     ▼
        ┌──────────────────────────────────────────────────┐
        │   shared library: pipeline / generator / library │
        └─────────────┬─────────────────────────┬──────────┘
                      ▲                         ▲
                      │                         │
        ┌─────────────┴───────────┐    ┌───────┴────────────┐
        │   frameforge CLI        │    │  launchd schedule  │
        └─────────────────────────┘    └────────────────────┘
```

The CLI and the FastAPI server share the same pipeline module — neither is the
"primary" surface. CLI for scripts and cron, server for the web UI.

## Phase 2 (SwiftUI menu bar) plan

The Python service is the engine. The Mac app:

1. Embeds Python via `python-build-standalone` + PyInstaller, OR
2. Manages a `frameforged` subprocess via `Process`/JSON-RPC, OR
3. (Eventually) reimplements expander/generator/tv_client in pure Swift.

Recommended order: ship the CLI + FastAPI → wrap with `Process`-based menu
bar GUI → incrementally rewrite hot paths in Swift as needed for App Store
compliance.

## Known TV quirks

- 2024 Frames don't reliably auto-return to Art Mode after an HDMI source
  powers off. `tv_client.force_art_mode()` works around this with a double
  power-toggle.
- Frame storage is ~100 user images. We cap at 80 to leave headroom.
- First connection requires accepting a prompt on the TV remote — token
  saved to `<library>/.frameforge_token` for subsequent silent runs.

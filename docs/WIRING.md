# Wiring: UI → Backend

This document maps every component in the Claude Design prototype to the
backend endpoint or WebSocket event that drives it. Use it as the contract when
implementing the frontend: component name from the design ↔ endpoint and the
shape it returns.

The backend listens on `http://localhost:8765`. The header status chip
subscribes to `ws://localhost:8765/ws/status` for live updates.

## Header status chip (every screen)

| State              | Display                          | Source                                  |
|--------------------|----------------------------------|-----------------------------------------|
| Idle               | gray dot · `Idle`                | initial WS payload                      |
| Expanding theme    | brass dot · `Expanding…`         | WS: `{"state": "expanding"}`            |
| Generating         | brass dot · `Generating 14 of 30…` | WS: `{"state": "generating", "done": int, "total": int}` |
| Uploading to TV    | brass dot · `Uploading to TV…`   | WS: `{"state": "uploading"}`            |
| Error              | alarm dot · `Error: see Settings` | WS: `{"state": "error", "message": …}` |

Click on the chip in any state opens a small history popover. That data is
in-memory on the frontend (the last N WS payloads); no endpoint needed.

## Onboarding

### Step 1 — Welcome
Static. No backend call.

### Step 2 — Find your TV
- **`Looking for your Frame…` scanner**: `GET /api/discover` (returns within ~4
  seconds; show the scanner animation while pending).
- **Discovered TV card**: render the first item where `is_frame === true`.
  Display: model_name (display serif), `host · MAC mac` (mono).
- **`Search again` button**: re-call `GET /api/discover`.
- **`This is the right one` button**: store `host` in app state, advance to
  step 3. (Persistence to backend happens at end of onboarding.)
- **`enter the IP manually` link**: text input that sets the same app-state
  variable and skips ahead.

### Step 3 — Pair
- Frontend opens a WebSocket and posts to a small endpoint to trigger pairing.
  *Pairing itself happens TV-side*; we just trigger the connect attempt.
- Recommended approach: lazy — trigger pairing on the *first* call that needs
  the TV (i.e., the first push). For onboarding, simulate by calling
  `GET /api/tv/status?host=…`. If `connected === true`, pairing succeeded.
- **30-second countdown**: pure frontend animation.

### Step 4 — API key
- **Input field (default masked)**: collected client-side.
- **`Test connection` button**: `POST /api/settings/test-key` *(stub — see
  Roadmap below; for now, treat any non-empty string as valid and store it via
  the OS keychain through a small native shim)*.

> Implementation note: the API key never lives in the FastAPI server's process.
> The Mac app shim writes it to the macOS Keychain; the server reads it via
> `XAI_API_KEY` env var set by the launchd plist that starts the server. The
> "Stored at: ~/Library/Keychains · com.frameforge.app" copy in the design
> reflects this.

## Themes screen

- **Theme cards grid**: `GET /api/themes` → `ThemeCard[]`.
  - `card.title` → display serif title
  - `card.image_count + card.last_refreshed` → meta line (formatted: "47
    images · refreshed 2 days ago")
  - `card.preview_filenames` → 4 image URLs at
    `/api/themes/{slug}/images/{filename}` (raw image route — see *static
    serving* below)
  - `card.state` → status pill: `on_tv | idle | generating`
- **`+ New theme` button**: opens a sheet with theme-name input + count slider.
  Submits `POST /api/themes/{slug}/generate` with body
  `{theme: string, count: number}`.
- **Hover toolbar (push, regenerate, edit)**:
  - Push → `POST /api/themes/{slug}/push` with `{minutes, matte, matte_color}`
  - Regenerate → `POST /api/themes/{slug}/generate` with `{theme: card.title}`
  - Edit → opens settings sheet (frontend-only)

## Theme detail screen

URL: `/themes/{slug}`. On load, call
`GET /api/themes/{slug}?with_expansion=false` for `ThemeDetail`.

- **Header**: `detail.title`, meta line composed from `image_count`,
  `last_refreshed`, `size_mb`, `version_pin`, `image_model`.
- **`ON TV` pill**: shown when `detail.state === "on_tv"`.
- **Action buttons**:
  - Push to TV → `POST /api/themes/{slug}/push`
  - Regenerate batch → `POST /api/themes/{slug}/generate` with theme=`detail.title`
  - Delete theme → `DELETE /api/themes/{slug}` *(roadmap)*
- **Prompt expansion panel** (▷ collapsed / ▽ expanded):
  - Click the chevron → re-fetch `GET /api/themes/{slug}?with_expansion=true`.
  - `expansion.count`, `expansion.seed` → header row
  - `expansion.prompts` → numbered two-column list
  - Footer "GENERATED <generated_at> · <text_model> · expansion v<frameforge_version>"
    composed from the same payload.
  - **Re-expand link** → `POST /api/themes/{slug}/re-expand` *(roadmap)*
- **Image grid (5 columns)**:
  - `detail.images[].filename` → image URL at `/api/themes/{slug}/images/{filename}`
  - `image.prompt_short` → caption beneath
  - `image.on_tv` → brass corner-dot indicator (only when true)
- **Tile hover state — three icons**:
  - Regenerate → `POST /api/themes/{slug}/images/{filename}/regenerate` *(roadmap)*
  - Inspect → opens side sheet (see below)
  - Toggle on TV → `POST /api/themes/{slug}/images/{filename}/toggle-tv` *(roadmap)*

## Image inspect side sheet

Open: click inspect icon on a tile.
Fetch: `GET /api/themes/{slug}/images/{filename}/inspect` → `InspectPayload`.

- **Image at top of sheet**: `/api/themes/{slug}/images/{filename}` (raw)
- **PROMPT eyebrow + display-serif prompt**: `payload.prompt`
- **PROVENANCE eyebrow** with the filename in mono caps: derived from
  `payload.filename` (e.g., `IMG_0002.JSON`)
- **Syntax-highlighted JSON**: render `payload.sidecar` with these CSS classes:
  - keys → `.json-key` (ink #1E2A44)
  - string values → `.json-string` (brass #A4824A)
  - numbers → `.json-number` (sage #7A8A6F)
  - braces, brackets, commas, colons → `.json-punct` (ink at 40% opacity)
- **Metadata pills**: `ON TV` (brass-filled if `payload.on_tv === true`),
  `REGENERATED 0x` from `payload.regen_count`
- **Action buttons**:
  - Regenerate this image → `POST /api/themes/{slug}/images/{filename}/regenerate` *(roadmap)*
  - Remove from library → `DELETE /api/themes/{slug}/images/{filename}` *(roadmap)*

## TV screen

- **Connected TV card**: `GET /api/tv/status` → `TVStatus`.
  - `connected` → CONNECTED pill (sage) when true; otherwise the disconnected
    empty state from the design system.
  - `host`, `mac`, `art_mode`, `last_seen` → metadata row
- **Reconnect button**: `POST /api/tv/reconnect` *(roadmap)* — re-triggers
  pairing flow.
- **Forget TV button**: `DELETE /api/tv` *(roadmap)* — removes token file.
- **Currently on TV row**: derive from `GET /api/tv/uploads` *(roadmap;
  currently exposed as part of TVStatus.images_on_tv count)*.
- **Slideshow settings**:
  - Minutes-per-image picker → POST'd at push time as the `minutes` field
  - Matte style picker (8 swatches) → POST'd as `matte`
  - Matte color picker (8 swatches) → POST'd as `matte_color`

## Schedule screen

*Roadmap.* Scheduling is delegated to launchd on macOS, so the schedule
endpoints are CRUD over launchd plist generation rather than an in-process
scheduler. Outline:

- `GET /api/schedules` → list of `ScheduleEntry`
- `POST /api/schedules` → create plist
- `DELETE /api/schedules/{id}` → unload + remove plist
- `PATCH /api/schedules/{id}` → enable/disable

The weekly calendar visualization on the design is purely a render of the
`cron` field of each entry.

## Settings screen

- **API Keys card**: `GET /api/settings` (returns model defaults, never
  the API key itself); replace key flow goes through the keychain shim, not
  the server.
- **Library Location**: `cfg.library_root` — exposed at `GET /api/health`
  (extend if needed).
- **Image Generation card**: `GET /api/settings` returns the dropdown values;
  changes go to `PATCH /api/settings` *(roadmap)*.
- **Advanced toggles**: same.
- **About card**: `GET /api/health` returns `version`.

## Static image serving

Add to `server.py` if not yet present:

```python
from fastapi.staticfiles import StaticFiles
app.mount(
    "/api/themes/{slug}/images",  # served via dynamic route, not StaticFiles
    ...
)
```

For now, the `theme_detail` route returns filenames only; add a thin handler:

```python
@app.get("/api/themes/{slug}/images/{filename}")
def serve_image(slug: str, filename: str):
    cfg = Config()
    p = cfg.theme_dir(slug) / filename
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)
```

(This is in the next commit — see roadmap.)

## Roadmap items called out above

The endpoints flagged *(roadmap)* are deliberately not in v0.1.0. They're
non-blocking for the first end-to-end loop:

1. Onboarding → discover, pair, key
2. Generate a theme via Themes screen
3. Push to TV
4. Watch it cycle

Add as needed once the core loop runs against a real TV.

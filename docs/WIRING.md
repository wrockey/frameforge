# Wiring: UI → Backend

This document maps every component in the Claude Design prototype to the
backend endpoint or WebSocket event that drives it. Use it as the contract when
implementing the frontend: component name from the design ↔ endpoint and the
shape it returns.

The backend listens on `http://127.0.0.1:8765` by default
(`FRAMEFORGE_BIND_HOST` / `FRAMEFORGE_BIND_PORT` override — bind `0.0.0.0`
to use the UI from a phone). The frontend derives its API base and the
status WebSocket URL from `location.origin`, so it works from any address
the server is reachable at.

**Auth**: when `FRAMEFORGE_API_TOKEN` is set, every `/api` route except
`/api/health` requires the token — `Authorization: Bearer <token>` on
fetches, `?token=` on image URLs and the WebSocket (which can't set
headers). `/api/health` returns `auth_required` so clients can tell. The
frontend accepts the token once via `?token=…` in the page URL, stores it
in localStorage, scrubs it from the address bar, and prompts on a 401.

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
- **`This is the right one` button**: `PUT /api/tv/host` with `{host}` —
  persisted to `settings.json` in the library root (the `FRAMEFORGE_TV_HOST`
  env var still overrides; the response's `env_override` flag says so) —
  then advance to step 3.
- **`enter the IP manually` link**: text input feeding the same `PUT`.

### Step 3 — Pair
- Connecting to the TV triggers the allow/deny prompt on its screen, so the
  frontend polls `GET /api/tv/status` every 3 s; `connected === true` means
  pairing succeeded and the token file is saved.
- **45-second countdown**: frontend animation around the poll.

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
- **Forget TV button**: `DELETE /api/tv/host` — clears the saved host from
  `settings.json` and removes the pairing token file.

### TV art manager (two panels)

- **"On the TV" panel**: `GET /api/tv/art` → `TVArtResponse`.
  - The list comes live from the TV and is reconciled with the local upload
    records: DB rows for art no longer on the TV are pruned; art the TV holds
    that FrameForge never uploaded appears with `matched: false`.
  - `item.thumbnail_url` → local image route for matched items,
    `/api/tv/art/{content_id}/thumbnail` (fetched from the TV, cached
    in-process) for unmatched ones.
  - `item.is_current` → sage NOW SHOWING pill.
  - `source === "cache"` → "TV unreachable" banner; items are the last known
    DB state.
  - Tile click toggles selection → **Remove n from TV** button →
    `POST /api/tv/art/delete` with `{content_ids: [...]}`. Local files are
    never touched.
  - Tile hover **Show now** → `POST /api/tv/art/select` with `{content_id}`.
- **"Your library" panel**: theme filter (`GET /api/themes`) + per-theme
  grids (`GET /api/themes/{slug}`). Images already on the TV render dimmed
  with an ON TV badge and can't be selected.
  - Selection → **Upload n to TV** button → `POST /api/tv/art/upload` with
    `{items: [{slug, filename}], matte, matte_color}`.
- **Theme-detail tile toggle (+/−)**: same two endpoints, single image.
  `ImageTile.content_id` (populated when `on_tv`) feeds the delete call.
- **Slideshow & matte settings**:
  - Minutes-per-image picker → **Restart slideshow** button →
    `POST /api/tv/slideshow` with `{minutes}`; also sent at push time.
  - Matte style + color pickers → applied to subsequent uploads
    (`matte`/`matte_color` fields on the upload/push bodies).

## Image imports (TV screen → library panel)

Drag-drop onto the library panel, or the **+ Import** button, queues files
through a client-side 16:9 crop sheet (`crop.js`) before they land in the
library as ordinary images under the reserved `imported` theme slug —
`imported` is not a user-choosable theme name; it shows up in
`GET /api/themes` and `GET /api/themes/{slug}` like any generated theme.

### `POST /api/imports`

`multipart/form-data`:

| Field                            | Required | Notes                                                       |
|-----------------------------------|----------|--------------------------------------------------------------|
| `file`                            | yes      | any format Pillow can decode; EXIF orientation is normalized before crop |
| `crop_x`, `crop_y`, `crop_w`, `crop_h` | all-or-nothing | form ints, in source-image pixels; omit all four to import uncropped |

An image that's already 16:9 within 1% tolerance is used as-is (or, if
larger than 3840×2160, downsized to it); otherwise the given crop is
applied. FrameForge never upscales past 3840×2160.

Response `200`:

```json
{
  "slug": "imported",
  "filename": "img_0007.png",
  "original_filename": "beach.jpg",
  "width": 3840,
  "height": 2160
}
```

Errors:
- `400` — some but not all of `crop_x/y/w/h` given; crop rectangle outside
  the image bounds; crop rectangle not 16:9; file isn't a readable image.
- `413` — file exceeds the 50 MB cap.

The untouched upload is preserved at `imported/originals/<name>` (suffixed
on filename collision) so a later recrop never loses quality.

### `POST /api/imports/{filename}/recrop`

JSON body: `{"crop_x": int, "crop_y": int, "crop_w": int, "crop_h": int}` —
re-crops from the preserved original and overwrites the same `filename` in
place.

Response `200`: `{"slug": "imported", "filename": ..., "width": ..., "height": ...}`

Errors:
- `404` — no imported image with that filename, or its original file is
  gone.
- `400` — crop rectangle out of bounds or not 16:9, or the original is no
  longer a readable image.

Not wired into the UI yet beyond the API — recrop is a future affordance
(by design). Exercise it with `curl` if you need it today.

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

Implemented as a thin route in `server.py`:

```python
@app.get("/api/themes/{slug}/images/{filename}")
def serve_image(slug: str, filename: str) -> FileResponse:
    cfg = Config()
    p = cfg.theme_dir(slug) / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(p)
```

The web UI itself (`src/frameforge/static/`) is mounted at `/` via
`StaticFiles(..., html=True)`, registered *after* every `/api` and `/ws`
route so those take precedence over the catch-all static mount.

## Roadmap items called out above

The endpoints flagged *(roadmap)* are deliberately not in v0.1.0. They're
non-blocking for the first end-to-end loop:

1. Onboarding → discover, pair, key
2. Generate a theme via Themes screen
3. Push to TV
4. Watch it cycle

Add as needed once the core loop runs against a real TV.

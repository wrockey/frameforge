# User Guide

A tour of the web UI, screen by screen. For first-time setup, start with
[GETTING_STARTED.md](GETTING_STARTED.md).

The header is the same everywhere: navigation, plus a **status chip** that
streams live progress (expanding, generating with a counter, uploading,
errors). Click the chip for a history of recent events.

## The Themes screen

Your library, one card per theme, with a four-image mosaic, image count,
and last-refresh time. Cards with art currently on the TV wear an **ON TV**
pill.

- **+ New theme** — name a theme, choose how many images (2–60, default 30),
  and generate. FrameForge expands the name into that many varied prompts
  before generating, so a batch has range instead of 30 near-duplicates.
- Hovering a card reveals shortcuts: push the whole theme to the TV (↑),
  regenerate the batch (↻).
- Click a card for the detail view.

## Theme detail

Everything about one theme: meta line (count, refresh time, size on disk,
generator model), action row, and the image grid.

- **Push to TV** uploads the entire theme, prunes the oldest TV uploads
  beyond the 80-image cap, and starts a shuffle slideshow.
- **Prompt expansion** panel shows the exact prompt list this batch was
  generated from, with its deterministic seed.
- **Image grid** — each tile carries:
  - a **brass corner dot** when that image is currently on the TV;
  - hover (always visible on touch screens) toolbar:
    - ↻ regenerate this one image *(roadmap)*
    - ⊕ inspect — side sheet with the full prompt, the provenance JSON
      (model, seed, resolution, timestamp, version), and on-TV state
    - **+ / −** — send this single image to the TV, or pull it off,
      without touching the rest of the theme

## The TV screen

The heart of TV management: two panels, side by side (stacked on a phone).

### Left: "On the TV"

What is *actually* stored on the Frame right now — read live from the TV,
not from FrameForge's memory of what it uploaded. That means:

- Art you deleted with the TV remote disappears here too (stale records
  are pruned automatically).
- Art uploaded by other apps (SmartThings, USB) appears labeled
  *"Uploaded outside FrameForge"*, with a thumbnail fetched from the TV.
- The image being displayed right now carries a **NOW SHOWING** pill.

Interactions:

- **Click tiles to select** (checkbox in the corner), then
  **Remove n from TV**. Removal only deletes from the TV — your local
  files are never touched.
- **Select all** toggles the lot; **↻ Refresh** re-reads the TV.
- Hover a tile → **Show now** displays that image on the wall immediately.
- If the TV is unreachable you get a banner and the last known state,
  with a retry link.

### Right: "Your library"

Every generated image, with a theme filter. Images already on the TV are
dimmed with an **ON TV** badge and can't be re-selected; select any others
and **Upload n to TV**. Uploads use the matte style/color currently chosen
below.

### Slideshow & matte

- **Minutes per image** — how long each artwork stays up, 5 minutes to
  24 hours. **Restart slideshow** applies it (shuffle order, over whatever
  is on the TV).
- **Matte style / color** — the frame-within-the-frame the TV renders
  around uploads. Applies to *new* uploads (the Frame bakes the matte in at
  upload time; to change an image's matte, remove and re-upload it).

### The TV card

Connection status, host, art mode, and an on-TV count against the 80-image
cap. **Forget TV** clears the saved host and the pairing token — use it
when the TV changes IP permanently or you're switching TVs; art on the TV
stays put.

## Settings

Read-only view of the generation defaults (model, resolution, aspect
ratio, default count) and library location. Changing them is roadmap;
today they're constants in `config.py` / environment variables.

## Schedule

Visual preview only for now — actual schedule CRUD ships in v0.2. Until
then, `frameforge cycle` under cron/launchd is the way (see the
[README](../README.md#scheduling-automatic-refreshes-macos)).

## CLI equivalents

| UI action                | CLI                                            |
|--------------------------|------------------------------------------------|
| Find your TV             | `frameforge find`                              |
| New theme / regenerate   | `frameforge generate --theme "…" [--count N]`  |
| Push theme to TV         | `frameforge push --theme "…" [--minutes M]`    |
| Generate + push          | `frameforge cycle --theme "…"`                 |

The CLI and web UI share the same library and TV state — mix freely.

## Data & privacy notes

- Everything is local: images, provenance, TV state. The only network
  calls are to your TV and to the xAI API with your own key.
- Each image's sidecar JSON is its birth certificate — see
  [REPRODUCIBILITY.md](REPRODUCIBILITY.md).
- API access can be token-protected for LAN use — see
  [GETTING_STARTED.md](GETTING_STARTED.md#6-optional-use-it-from-your-phone).

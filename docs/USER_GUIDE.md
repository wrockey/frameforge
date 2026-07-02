# User Guide

A tour of the web UI, screen by screen. For first-time setup, start with
[GETTING_STARTED.md](GETTING_STARTED.md).

The header is the same everywhere: navigation, a **status chip** that
streams live progress (expanding, generating with a counter, uploading,
errors — click it for a history of recent events), and a **TV chip**
(`TV · connected` / `TV · unreachable` / `TV · not set up`) that polls the
TV every 60 seconds and jumps to the TV screen when clicked.

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
- The image being displayed right now carries a **NOW SHOWING** pill and
  sorts first regardless of the chosen sort order; a **Now on the wall**
  strip is pinned above the grid too — click it to scroll straight to that
  tile.

Interactions:

- **Click tiles to select**, then **Remove n from TV**. Removal only
  deletes from the TV — your local files are never touched. See
  *Selecting and viewing images* below for the full selection model.
- **Select all** toggles the lot; **↻ Refresh** re-reads the TV.
- Hover a tile → **Show now** displays that image on the wall immediately.
- **Sort**: *Newest* / *Name*. **Filter**: *All* / *Matched* (FrameForge
  knows the local file) / *Unknown* (uploaded by another app).
- If the TV is unreachable you get a banner and the last known state,
  with a retry link.

### Right: "Your library"

Every generated image, with a theme filter, a **Sort** (*Newest* / *Name*),
and a text search across filename, theme, and prompt. Images already on
the TV are dimmed with an **ON TV** badge and can't be re-selected; select
any others and **Upload n to TV**. Uploads use the matte style/color
currently chosen below.

#### Importing your own images

Drag image files onto the library panel, or click **+ Import**, to add
your own photos. Images already 16:9 import unprompted; anything else
opens a crop sheet per file: drag the rectangle to reposition, drag its
corner handle to resize (locked to 16:9); **Skip** that file, **Keep
original** (the TV mattes it into 16:9 instead of cropping), or
**Center-crop the rest** to apply a centered crop to every remaining file
in the batch without prompting again. Check **Send to TV after import** to
upload as soon as the batch finishes. (Files over 50 MB or that aren't
readable images are rejected with an error — see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).)

Imports land in a reserved **Imported** collection, filterable like any
other theme. The untouched original is kept at
`imported/originals/<name>` so a later re-crop never loses quality — today
that's an API-only path (`POST /api/imports/{filename}/recrop`; see
[WIRING.md](WIRING.md)), not yet a UI control.

### Selecting and viewing images

Both panels on this screen share the same Finder-style selection model:
click a tile to select just it (replacing any existing selection);
**⌘/Ctrl-click** toggles one tile in or out; **Shift-click** selects the
run between the last-clicked tile and this one; **Space** toggles the
focused tile from the keyboard. A selection bar appears above the grid
with a running count and a **Clear** link. On a phone or tablet, a normal
tap opens the viewer — **long-press** a tile to enter selection mode,
after which taps toggle instead of opening.

**Double-click a tile, or press Enter,** to open the full-screen lightbox:
the **←/→** keys, on-screen arrows, or a swipe navigate between images in
that panel; **Esc** or the **×** closes it. The footer shows a caption
and, depending on context, a **Show on TV now** or **Upload to TV** action.
(The theme detail grid's tiles open the same lightbox on double-click, but
don't have multi-select — use its per-tile **+ / −** instead.)

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

If the TV can't be reached, the card swaps to a recovery state instead:
**Retry** re-checks the saved host, and **Find my TV again** re-runs
discovery and saves whatever Frame it finds — no re-pairing needed if it's
the same TV under a new IP (DHCP reassigned it, for instance). The
header's TV chip reflects this same connected / unreachable / not-set-up
state everywhere in the app and links back here.

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

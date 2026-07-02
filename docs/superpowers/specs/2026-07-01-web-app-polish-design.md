# FrameForge Web App Polish — Design

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan
**Scope:** Project A of two. Project B (iOS thin-client wrapper) gets its own
spec after this ships.

## Goal

Make FrameForge a pleasant way to curate what's on a Samsung Frame TV:

1. **Robust TV connection** — validated end-to-end against a real Frame on
   this network, with honest connection states and easy recovery.
2. **Import your own images** — any image from disk (Midjourney output,
   photos, …) into the library, cropped to 16:9, uploadable to the TV.
3. **File-browser-grade TV screen** — lightbox viewing, Finder-style
   multi-select, sort/filter, and a clear "now showing" view.

The iOS app will be a thin client to the Mac-hosted server ("hybrid later,
thin now"): this round keeps the API contract clean and phone-friendly but
builds no native code.

## Build order

Three phases, in dependency order:

1. **Connection hardening** — everything else depends on a working TV link.
2. **Import + crop + upload** — the new pipeline.
3. **Browser/viewer UX** — polish on top of working data flows.

---

## Phase 1: Connection hardening

### End-to-end validation

Run the full lifecycle against the real Frame on this network:
discover → save host → pair (remote prompt) → status → list art → fetch
thumbnails → upload → select ("show now") → slideshow → delete. Fix what
breaks. Known risk areas:

- 2024-model quirks (`force_art_mode`, broadened SSDP M-SEARCH).
- `samsungtvws` category-ID differences across firmwares in
  `FrameTVClient.list_art()` (MY-C0002 vs MY_* prefix fallback).
- Thumbnail fetches for TV-native art being slow or failing.

### Connection UX

- **Header TV indicator** next to the status chip: `connected` /
  `unreachable` / `no TV configured`. Updated by polling `/api/tv/status`
  every 60 seconds while the tab is visible, and on demand before TV
  actions.
- **Specific failure messages.** TV actions that fail because the TV is
  unreachable say so ("TV is unreachable — is it powered on?") with a retry
  button, instead of a generic 502.
- **One-click re-discovery** when the saved host stops answering (DHCP
  lease changed): re-runs discovery, updates the saved host. No re-pairing
  needed — the token is per-TV, not per-IP.

### Smoke-check tool

A manual lifecycle checker (`frameforge doctor` style CLI) that runs the
validation sequence above against the real TV and prints pass/fail per
step. Used for initial validation, kept for future regressions since the
TV cannot live in CI.

---

## Phase 2: Import pipeline

### Data model: imports are library entries

- Imported images live in `~/Pictures/FrameForge/imported/` — a theme
  directory with a reserved slug. `Library.list_theme()`, the SQLite
  `tv_uploads` tracking, theme filtering, and upload-to-TV all work on it
  unchanged.
- The untouched original is preserved at `imported/originals/<original-name>`
  — never uploaded, never shown in grids; exists so re-crops never lose
  quality.
- The cropped 16:9 result is saved as `imported/img_NNNN.png` (the naming
  pattern the library already globs).
- Sidecar `img_NNNN.json` carries `"source": "imported"`, original
  filename, import timestamp, and crop rectangle — instead of
  prompt/seed/model fields.
- The manifest writer and endpoints that assume prompt/seed keys become
  tolerant (`.get()` with defaults). The UI shows the original filename
  where generated images show a prompt snippet.
- The Imported collection appears in the Themes grid like any theme, minus
  Regenerate.
- **Not building:** user-named import albums. One Imported collection for
  now; albums would just be more theme directories later, no migration.

### Crop flow

1. File picker or drag-and-drop onto the library panel. The browser opens
   each file locally (object URL, nothing uploaded yet) and shows a crop
   overlay: draggable/resizable 16:9 frame, defaulting to centered
   max-size. Images already 16:9 within ~1% tolerance skip the overlay.
2. On confirm, one round-trip:

   ```
   POST /api/imports    multipart/form-data:
                        file=<bytes>, crop_x, crop_y, crop_w, crop_h
                        (crop rect in source-pixel coordinates)
   ```

3. Server (Pillow) validates the rect, crops, resizes to 3840×2160 only
   when the crop is larger (never upscales), saves original + PNG +
   sidecar, returns the new library entry.

- Multi-file batches queue through the crop overlay one at a time with a
  "center-crop the rest" shortcut.
- Optional "send to TV after import" toggle chains into the existing
  `POST /api/tv/art/upload` — no new upload machinery.
- Portrait escape hatch: "keep original, let the TV matte it" uploads
  as-is instead of forcing a 16:9 crop.

### Re-crop

```
POST /api/imports/{filename}/recrop    {crop_x, crop_y, crop_w, crop_h}
```

Re-runs the crop from the stored original, replacing the PNG in place
(same filename, so TV-upload tracking by path stays coherent).

### Error handling

- Non-image files rejected client-side by MIME type and server-side by
  Pillow verification.
- Oversized files rejected with 413; cap ~50 MB.
- Atomic writes: crop output goes to a temp file, renamed on success — a
  failed crop leaves no partial files.

---

## Phase 3: TV screen as a file browser

Two-panel layout stays (On the TV | Your library). Four upgrades:

### Lightbox viewer

- Click any thumbnail (either panel, or theme detail grids) → full-screen
  overlay, image large and centered.
- ←/→ keys and swipe move through the current grid's order; Esc or
  tap-outside closes.
- Footer: filename, theme or "Imported", on-TV status, and contextual
  actions — *Show on TV now*, *Upload to TV* / *Remove from TV*.
- On-TV items with no local match show the TV's thumbnail (best the TV
  API offers).

### Finder-grade selection

- Click selects; ⌘/Ctrl-click toggles; Shift-click selects a range;
  select-all stays.
- Touch: long-press enters selection mode, then taps toggle.
- A selection toolbar appears when anything is selected: count + bulk
  actions (Upload / Remove / Clear). Selection state is per-panel.

### Sort and filter

- Both panels: sort by date (newest/oldest) and name.
- On-TV panel: filter *matched* (known source image) vs *unknown*
  (uploaded by another app).
- Library panel: existing theme filter + text search over
  prompt/filename.
- All client-side over data already in the responses — no API changes.

### Now showing

- Currently displayed artwork pinned first in the on-TV grid with a
  "NOW SHOWING" badge.
- One-line strip above the grid ("Now on the wall: …") that jumps to it.
- *Show now* on any item swaps the wall; the badge follows via re-fetch,
  not assumption.

### Code structure

`app.js` (~1,500 lines) splits into ES modules as part of this phase:
`api.js` (fetch + token), `state.js`, `lightbox.js`, `selection.js`, and
per-screen view modules, loaded via `<script type="module">`.
Behavior-preserving refactor first, then features on top.

---

## Testing

- **Server:** pytest with mocked TV client, as today. New coverage:
  `/api/imports` (crop math, rect validation, tolerant sidecars, temp-file
  atomicity), recrop, oversized/invalid uploads. Existing tests keep
  passing.
- **TV client:** the Phase 1 smoke-check CLI against the real TV; not in CI.
- **Frontend:** manual pass on desktop Safari/Chrome and the iPhone PWA —
  crop touch interactions, long-press selection, lightbox swipe.

## Out of scope this round

- iOS native wrapper (Project B — own spec; SwiftUI/WKWebView thin client
  to the Mac server is the working assumption).
- Schedule CRUD (stays a v0.2 roadmap item).
- User-named import albums.
- Standalone phone-to-TV control without the Mac.

## Decisions log

| Decision | Choice | Why |
|---|---|---|
| Import sources | Disk/photos picker + library import | User curates AI images made elsewhere |
| Aspect handling | Server-side 16:9 crop tool | Predictable wall result; iOS client gets crop for free; originals kept |
| Crop execution | Server (Pillow), browser picks rect | Phone canvases choke on 4K; one implementation for all clients |
| Import storage | Reserved `imported` theme dir | Full reuse of library/TV machinery |
| Frontend | Stay vanilla JS, split to ES modules | Interactions well within vanilla reach; rewrite is big-bang risk |
| iOS | Thin client now, hybrid later | Ships fast; keep API contract clean |

# FrameForge

AI-generated themed art for Samsung Frame TVs. Pick a theme like "vintage pulp
fantasy"; FrameForge expands it into 30 varied prompts, generates the images
via the xAI Imagine API, and pushes them to your Frame TV on a schedule.

Local-first. BYOK. No accounts. Provenance-tracked.

## Quick start

```bash
git clone <your-repo-url> frameforge
cd frameforge
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .

cp .env.example .env
# edit .env and add your xAI API key

# CLI usage:
frameforge find                                   # scan network for your TV
frameforge cycle --theme "vintage pulp fantasy"   # generate + push

# Server (for the web UI):
frameforged                                       # http://localhost:8765
```

First time you push to the TV, accept the pairing prompt with your TV remote.

## Two ways to run

**CLI** (`frameforge`): scriptable, ideal for cron / launchd / one-off runs.

**Local server** (`frameforged`): serves a FastAPI service at
`http://localhost:8765` for the web UI to consume. The web UI itself is in a
separate repo / Claude Design output. See `docs/WIRING.md` for the
UI ↔ endpoint contract.

## Where things live

```
~/Pictures/FrameForge/
├── themes.db                          # SQLite: TV upload tracking
├── .frameforge_token                  # TV pairing token (do not commit)
├── vintage_pulp_fantasy/
│   ├── manifest.csv
│   ├── img_0001.png
│   ├── img_0001.json                  # full provenance sidecar
│   └── …
└── studio_ghibli_skies/
    └── …
```

## Reproducibility

Every generated image is traceable. Three layers:

1. **Per-image sidecar JSON** adjacent to each PNG: theme, prompt,
   expansion seed, model identifiers, timestamp, app version.
2. **Per-theme `manifest.csv`**: flattened table of every sidecar in a theme.
3. **Library-wide SQLite index** (`themes.db`): operational state of which
   images are currently uploaded to the TV.

Image generation isn't byte-deterministic (xAI doesn't expose a true RNG
seed for `grok-imagine-image-quality` as of 2026-05-09). What's preserved:
the exact prompt, the expansion seed (deterministic from theme + count +
version + day), and all model parameters. For publication, cite the
sidecar JSON of the specific image used. See `docs/REPRODUCIBILITY.md`.

## Development

```bash
pip install -e ".[dev]"
pytest                              # 15 tests
ruff check src/                     # lint
```

## Scheduling automatic refreshes (macOS)

Use `launchd`. Example plist refreshing weekly:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.genstation.frameforge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOU/frameforge/.venv/bin/frameforge</string>
        <string>cycle</string>
        <string>--theme</string><string>vintage pulp fantasy</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key><integer>0</integer>
        <key>Hour</key><integer>3</integer>
    </dict>
</dict>
</plist>
```

Save to `~/Library/LaunchAgents/com.genstation.frameforge.plist`, then
`launchctl load` it.

## Managing what's on the TV

The web UI's **TV** screen is a two-panel manager:

- **On the TV** — the art actually stored on the Frame, read live from the
  TV (including pieces uploaded by other apps). Select images and remove
  them from the TV, or click *Show now* to display one immediately.
- **Your library** — every generated image, filterable by theme. Select the
  ones you want on the wall and upload them in one click; images already on
  the TV are marked.

Each theme's detail grid also has a per-image **+ / −** toggle to send a
single image to the TV or pull it off.

## Using the UI from your phone

By default the server binds to loopback. To use FrameForge from a phone on
the same Wi-Fi (it installs to the home screen as a web app):

```bash
# in .env
FRAMEFORGE_BIND_HOST=0.0.0.0
FRAMEFORGE_API_TOKEN=pick-something-long
```

Then open `http://<your-mac-ip>:8765/?token=pick-something-long` on the
phone once — the token is stored in the browser — and use Share →
*Add to Home Screen*. Without a token, anyone on your network could control
the TV and spend your API credits, so set one whenever you bind beyond
loopback.

## Roadmap

- v0.2: image regenerate-one, delete-image, schedule CRUD endpoints
- v0.3: SwiftUI menu bar wrapper around the FastAPI service
- v0.4: Mac App Store distribution

## License

MIT

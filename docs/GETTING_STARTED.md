# Getting Started

From zero to AI-generated art on your Frame TV. Ten minutes, most of it
image generation.

## What you need

- A Samsung Frame TV (any LS03 generation) on the same Wi-Fi network as
  the computer running FrameForge.
- Python 3.11 or newer.
- An xAI API key from [console.x.ai](https://console.x.ai) — FrameForge
  generates images through the xAI Imagine API. Bring your own key; nothing
  is proxied through anyone else's server.

## 1. Install

```bash
git clone <your-repo-url> frameforge
cd frameforge
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set your API key:

```bash
XAI_API_KEY=xai-...
```

That's the only required setting. Everything else has a sensible default —
your library lives in `~/Pictures/FrameForge`, and the TV is found
automatically in the next step.

## 3. Start the server and run onboarding

```bash
frameforged
```

Open <http://localhost:8765/#/onboarding> and follow the four steps:

1. **Welcome** — just context.
2. **Find your TV** — FrameForge scans the network (SSDP) and shows your
   Frame. Click *This is the right one*; the choice is saved to your
   library's `settings.json` so you never enter it again. If the scan comes
   up empty, turn the TV on (or wake it from standby) and *Search again*,
   or *enter the IP manually* — you can read the TV's IP from
   Settings → General → Network → Network Status on the TV itself.
3. **Pair** — the moment FrameForge first talks to the TV, the TV shows an
   allow/deny prompt. Grab the remote and accept it. The screen flips to
   "Paired" automatically and a token is saved
   (`<library>/.frameforge_token`), so every future connection is silent.
4. **API key** — informational for now: the server reads the key from
   `.env` (step 2). The in-browser key storage ships with the Mac app.

Prefer the terminal? `frameforge find` does step 2, and pairing happens
automatically on your first push.

## 4. Generate your first theme

On the **Themes** screen, click **+ New theme**, type something evocative —
`"vintage pulp fantasy"`, `"studio ghibli skies"`, `"mid-century
observatory"` — pick a count (default 30), and hit **Generate**.

FrameForge expands the theme into that many distinct prompts, then
generates the images. The status chip in the header shows live progress
("Generating 14 of 30…"). A 30-image batch typically takes a few minutes.

CLI equivalent:

```bash
frameforge generate --theme "vintage pulp fantasy" --count 30
```

Review the batch on the theme's detail page. Click any tile's ⊕ to see the
exact prompt and full provenance for that image.

## 5. Put it on the wall

Two ways:

- **Whole theme**: *Push to TV* on the theme detail page uploads
  everything, prunes the oldest uploads past the 80-image cap, and starts a
  shuffle slideshow.
- **Hand-picked**: the **TV** screen shows what's on the TV next to your
  library. Select just the images you want and *Upload to TV*. See the
  [User Guide](USER_GUIDE.md#the-tv-screen) for the full tour.

CLI equivalent (generate + push in one shot):

```bash
frameforge cycle --theme "vintage pulp fantasy"
```

## 6. Optional: use it from your phone

By default the server only listens on localhost. To manage the TV from
your phone's browser (or add it to the home screen as an app):

```bash
# in .env
FRAMEFORGE_BIND_HOST=0.0.0.0
FRAMEFORGE_API_TOKEN=pick-something-long
```

Restart `frameforged`, then on the phone open
`http://<computer-ip>:8765/?token=pick-something-long` once. The token is
remembered by the browser. Use Share → **Add to Home Screen** for a
full-screen app.

Always set a token when binding beyond localhost — the API can control
your TV and spend your xAI credits.

## 7. Optional: refresh on a schedule

Run `frameforge cycle` from cron or launchd to rotate art automatically.
A ready-to-edit launchd plist is in the [README](../README.md#scheduling-automatic-refreshes-macos).

## Where everything lives

```
~/Pictures/FrameForge/
├── settings.json                      # TV host saved by onboarding
├── themes.db                          # which images are on the TV (SQLite)
├── .frameforge_token                  # TV pairing token (do not commit/share)
└── vintage_pulp_fantasy/
    ├── img_0001.png                   # the art
    ├── img_0001.json                  # full provenance for that image
    └── manifest.csv                   # all sidecars, flattened
```

Delete a theme folder and it disappears from the app. Back up the whole
directory and you've backed up everything.

## Something not working?

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

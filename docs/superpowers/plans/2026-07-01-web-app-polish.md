# FrameForge Web App Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the TV connection (validated against the real Frame on this network), add an import-your-own-images pipeline with a 16:9 crop, and upgrade the TV screen to a file-browser-grade manager.

**Architecture:** FastAPI server (`src/frameforge/server.py`) + vanilla-JS static UI (`src/frameforge/static/`). Imports become library entries under a reserved `imported` theme directory so all existing library/TV machinery works unchanged. Crop executes server-side (Pillow). The 1,500-line `app.js` splits into ES modules before new frontend features land.

**Tech Stack:** Python 3.11, FastAPI, Pillow, samsungtvws, pytest; vanilla JS ES modules, no frontend framework or build step.

**Spec:** `docs/superpowers/specs/2026-07-01-web-app-polish-design.md`

## Global Constraints

- Python ≥ 3.11; no new frontend framework or build step — plain ES modules served statically.
- Crop target is 3840×2160; never upscale; 16:9 ratio tolerance is 1%.
- Import upload cap: 50 MB (`413` beyond it).
- Imported images live in `<library_root>/imported/`; untouched originals in `<library_root>/imported/originals/`.
- All existing pytest tests must keep passing after every task. Run `ruff check src/` before each commit.
- The real Frame TV on this network is the validation target for Task 2 and Task 14. The TV cannot be in CI — mutating tests stay manual.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01WGpnLXwcb1WTotfTGD2yKU`

**Environment note:** activate the venv first: `source /Users/bill/Documents/frameforge/.venv/bin/activate`. Run all commands from the repo root.

---

### Task 1: `frameforge doctor` — TV lifecycle smoke-check

**Files:**
- Create: `src/frameforge/doctor.py`
- Modify: `src/frameforge/cli.py`
- Test: `tests/test_doctor.py`

**Interfaces:**
- Consumes: `FrameTVClient` (`status()`, `list_art()`, `get_thumbnail(cid)`, `upload_batch(library, slug, paths)`, `select_art(cid)`, `delete_art(cids)`), `Library`, `Config`.
- Produces: `run_doctor(cfg, host=None, mutate=True, client_factory=FrameTVClient, echo=print) -> list[StepResult]` where `StepResult` is `@dataclass(name: str, ok: bool, detail: str = "")`. CLI command `frameforge doctor [--host IP] [--read-only]`, exit code 1 on any failed step.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_doctor.py
"""Doctor lifecycle checker, exercised against a scripted fake TV client."""
from pathlib import Path

from frameforge.config import Config
from frameforge.doctor import run_doctor


class ScriptedClient:
    """Fake FrameTVClient whose behavior is set per-test via class attrs."""

    connected = True
    art = [{"content_id": "MY_F0001"}]
    fail_thumbnail = False

    def __init__(self, cfg, host):
        self.cfg = cfg
        self.host = host

    def status(self):
        if not type(self).connected:
            return {"host": self.host, "connected": False, "error": "refused"}
        return {"host": self.host, "connected": True, "art_mode": "on"}

    def list_art(self):
        return [dict(i) for i in type(self).art]

    def get_thumbnail(self, cid):
        if type(self).fail_thumbnail:
            raise RuntimeError("thumb timeout")
        return b"\xff\xd8fake"

    def upload_batch(self, library, slug, paths, matte="x", portrait_matte="x"):
        ids = []
        for p in paths:
            cid = f"MY_TEST_{p.stem}"
            library.record_upload(cid, p, slug, "2026-07-01T00:00:00Z")
            ids.append(cid)
        return ids

    def select_art(self, cid):
        pass

    def delete_art(self, cids):
        return list(cids)


def _cfg(tmp_path) -> Config:
    return Config(library_root=tmp_path / "lib", tv_host="192.0.2.9")


def test_doctor_all_steps_pass(tmp_path):
    ScriptedClient.connected = True
    ScriptedClient.art = [{"content_id": "MY_F0001"}]
    ScriptedClient.fail_thumbnail = False
    results = run_doctor(_cfg(tmp_path), client_factory=ScriptedClient, echo=lambda s: None)
    names = [r.name for r in results]
    assert names == [
        "resolve host", "connect + status", "list art", "fetch thumbnail",
        "upload test card", "show test card", "delete test card",
    ]
    assert all(r.ok for r in results)
    # test card temp file cleaned up
    assert not (tmp_path / "lib" / ".doctor_test_card.png").exists()


def test_doctor_no_host_fails_fast(tmp_path):
    cfg = Config(library_root=tmp_path / "lib", tv_host=None)
    results = run_doctor(cfg, client_factory=ScriptedClient, echo=lambda s: None)
    assert len(results) == 1
    assert results[0].name == "resolve host" and not results[0].ok


def test_doctor_status_failure_short_circuits(tmp_path):
    ScriptedClient.connected = False
    results = run_doctor(_cfg(tmp_path), client_factory=ScriptedClient, echo=lambda s: None)
    assert [r.name for r in results] == ["resolve host", "connect + status"]
    assert not results[-1].ok and "refused" in results[-1].detail


def test_doctor_read_only_skips_mutation(tmp_path):
    ScriptedClient.connected = True
    ScriptedClient.art = []
    results = run_doctor(
        _cfg(tmp_path), mutate=False, client_factory=ScriptedClient, echo=lambda s: None
    )
    names = [r.name for r in results]
    assert "upload test card" not in names and "delete test card" not in names
    # empty TV: thumbnail step passes as skipped
    thumb = next(r for r in results if r.name == "fetch thumbnail")
    assert thumb.ok and "skipped" in thumb.detail


def test_doctor_step_failure_recorded_but_continues(tmp_path):
    ScriptedClient.connected = True
    ScriptedClient.art = [{"content_id": "MY_F0001"}]
    ScriptedClient.fail_thumbnail = True
    results = run_doctor(_cfg(tmp_path), client_factory=ScriptedClient, echo=lambda s: None)
    thumb = next(r for r in results if r.name == "fetch thumbnail")
    assert not thumb.ok
    assert any(r.name == "upload test card" for r in results)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_doctor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'frameforge.doctor'`

- [ ] **Step 3: Implement `src/frameforge/doctor.py`**

```python
"""TV connection lifecycle smoke-check.

Runs the full connect → list → thumbnail → upload → show → delete lifecycle
against a real Frame and reports pass/fail per step. The TV can't live in CI,
so this is the manual regression tool: `frameforge doctor`.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Callable, Optional

from PIL import Image, ImageDraw

from .config import Config
from .library import Library
from .tv_client import FrameTVClient


@dataclass
class StepResult:
    name: str
    ok: bool
    detail: str = ""


def _test_card() -> bytes:
    """A recognizable 16:9 test image: brown field, ivory double border."""
    img = Image.new("RGB", (1920, 1080), (92, 64, 51))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 1879, 1039], outline=(245, 241, 232), width=12)
    d.rectangle([80, 80, 1839, 999], outline=(245, 241, 232), width=4)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def run_doctor(
    cfg: Config,
    host: Optional[str] = None,
    mutate: bool = True,
    client_factory: Callable = FrameTVClient,
    echo: Callable[[str], None] = print,
) -> list[StepResult]:
    results: list[StepResult] = []

    def step(name: str, fn: Callable[[], str]) -> bool:
        try:
            detail = fn() or ""
        except Exception as e:
            results.append(StepResult(name, False, str(e)))
            echo(f"  ✗ {name} — {e}")
            return False
        results.append(StepResult(name, True, detail))
        echo(f"  ✓ {name}" + (f" — {detail}" if detail else ""))
        return True

    target = host or cfg.tv_host
    if not target:
        results.append(
            StepResult("resolve host", False, "no TV host configured (env, settings.json, or --host)")
        )
        echo("  ✗ resolve host — no TV host configured")
        return results
    results.append(StepResult("resolve host", True, target))
    echo(f"  ✓ resolve host — {target}")

    client = client_factory(cfg, target)

    def check_status() -> str:
        s = client.status()
        if not s.get("connected"):
            raise RuntimeError(s.get("error", "not connected"))
        return f"art_mode={s.get('art_mode')}"

    if not step("connect + status", check_status):
        return results

    art_items: list[dict] = []

    def check_list() -> str:
        nonlocal art_items
        art_items = client.list_art()
        return f"{len(art_items)} piece(s) on the TV"

    step("list art", check_list)

    def check_thumb() -> str:
        if not art_items:
            return "skipped (no art on TV)"
        data = client.get_thumbnail(art_items[0]["content_id"])
        return f"{len(data)} bytes"

    step("fetch thumbnail", check_thumb)

    if not mutate:
        return results

    library = Library(cfg)
    uploaded: list[str] = []
    card_path = cfg.library_root / ".doctor_test_card.png"

    def do_upload() -> str:
        card_path.write_bytes(_test_card())
        nonlocal uploaded
        uploaded = client.upload_batch(library, "doctor_test", [card_path])
        if not uploaded:
            raise RuntimeError("upload returned no content_id")
        return uploaded[0]

    step("upload test card", do_upload)

    if uploaded:
        def do_show() -> str:
            client.select_art(uploaded[0])
            return ""

        step("show test card", do_show)

        def do_delete() -> str:
            removed = client.delete_art(uploaded)
            for cid in removed:
                library.remove_upload(cid)
            if set(removed) != set(uploaded):
                raise RuntimeError(f"only removed {removed}")
            return ""

        step("delete test card", do_delete)

    card_path.unlink(missing_ok=True)
    return results
```

- [ ] **Step 4: Add the CLI command to `src/frameforge/cli.py`**

Append after the `cycle` command:

```python
@cli.command()
@click.option("--host", default=None, help="TV IP (defaults to the configured host).")
@click.option("--read-only", is_flag=True, help="Skip the upload/show/delete steps.")
def doctor(host: str | None, read_only: bool) -> None:
    """Check the TV connection lifecycle step by step."""
    from .doctor import run_doctor

    click.echo("FrameForge doctor — checking the TV connection lifecycle:")
    results = run_doctor(Config(), host=host, mutate=not read_only, echo=click.echo)
    failed = [r for r in results if not r.ok]
    if failed:
        click.echo(f"\n{len(failed)} step(s) failed.")
        raise SystemExit(1)
    click.echo("\nAll steps passed.")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_doctor.py -v`
Expected: 5 passed

- [ ] **Step 6: Run the full suite and lint**

Run: `pytest && ruff check src/`
Expected: all tests pass, no lint errors

- [ ] **Step 7: Commit**

```bash
git add src/frameforge/doctor.py src/frameforge/cli.py tests/test_doctor.py
git commit -m "feat: frameforge doctor — TV lifecycle smoke-check CLI"
```

---

### Task 2: Validate against the real TV; fix what breaks

This task is discovery-driven: it produces bug fixes we cannot enumerate in advance. Use the superpowers:systematic-debugging skill for anything that fails. **Requires the TV powered on and the user nearby (a first-time pairing prompt may appear on the TV).**

**Files:**
- Modify: whatever the failures implicate — most likely `src/frameforge/tv_client.py`, `src/frameforge/discover.py`.

**Interfaces:**
- Consumes: Task 1's `frameforge doctor`.
- Produces: a passing `frameforge doctor` run against the real Frame; any fixes committed individually.

- [ ] **Step 1: Discover the TV**

Run: `frameforge find`
Expected: a line like `🖼️  192.168.x.x  QN55LS03…` (an LS03 model = Frame). If nothing is found, debug `discover.py` (check Wi-Fi network, try increasing `timeout`); fix and commit before continuing.

- [ ] **Step 2: Confirm the host is configured**

Run: `cat ~/Pictures/FrameForge/settings.json 2>/dev/null; echo "env: $FRAMEFORGE_TV_HOST"`
If no host is saved anywhere, save the discovered IP: `frameforge doctor --host <IP-from-step-1>` will use it directly; to persist it for the server, run the server once and use onboarding, or write it via
`python -c "from frameforge.config import Config, write_settings; write_settings(Config().library_root, {'tv_host': '<IP>'})"`

- [ ] **Step 3: Run the read-only doctor first**

Run: `frameforge doctor --read-only`
Expected: `resolve host`, `connect + status`, `list art`, `fetch thumbnail` all ✓. First-ever connection triggers a pairing prompt on the TV — accept it with the remote. For each ✗: reproduce, read the error, fix the root cause in the implicated module, re-run, and commit that fix on its own:

```bash
git add <fixed files>
git commit -m "fix(tv): <what actually broke against the 2024 Frame>"
```

- [ ] **Step 4: Run the full mutating doctor**

Run: `frameforge doctor`
Expected: all 7 steps ✓ — the TV briefly shows the brown/ivory test card, then it's deleted. Fix and commit failures as in Step 3.

- [ ] **Step 5: Record findings in the troubleshooting doc**

Add anything learned (quirks, timing, firmware behaviors) to `docs/TROUBLESHOOTING.md` under a `## frameforge doctor` heading, including a sample passing transcript.

```bash
git add docs/TROUBLESHOOTING.md
git commit -m "docs: doctor findings from real-TV validation"
```

---

### Task 3: ES-module refactor of the frontend (behavior-preserving)

No behavior changes. Split `static/app.js` (1,496 lines) into modules so later tasks land in focused files. There is no JS test runner (per spec, frontend testing is manual) — verification is the existing pytest suite (static mount unchanged) plus a browser walkthrough.

**Files:**
- Create: `src/frameforge/static/js/api.js`, `js/mock.js`, `js/util.js`, `js/status.js`, `js/router.js`, `js/views/onboarding.js`, `js/views/themes.js`, `js/views/themeDetail.js`, `js/views/inspect.js`, `js/views/tv.js`, `js/views/schedule.js`, `js/views/settings.js`, `js/main.js`
- Modify: `src/frameforge/static/index.html` (script tag)
- Delete: `src/frameforge/static/app.js` (at the end, once everything is moved)

**Interfaces:**
- Produces (used by all later frontend tasks):
  - `js/api.js`: `export const API_BASE, WS_URL`; `export const authToken, withToken`; `export async function jfetch(url, opts)`; `export const jpost`; `export const api` (the `USE_MOCK ? mockApi : liveApi` object with methods `health, discover, themes, themeDetail, inspect, tvStatus, tvArt, tvUpload, tvDelete, tvSelect, tvSlideshow, settings, schedules, setTvHost, forgetTv, generate, push, testKey, imageUrl, thumbUrl`).
  - `js/util.js`: `export { escapeHtml, relativeTime, highlightJson, wait }`.
  - `js/views/tv.js`: `export { renderTV }`; keeps the module-level `tvView` state object and exports it (`export const tvView`) for the selection/sort tasks.
  - `js/main.js`: entry point; wires router + status WS on load.

- [ ] **Step 1: Move functions into modules — exact mapping**

Move code verbatim (cut-paste, add `export`/`import` lines only). Mapping by current `app.js` line ranges:

| New module | Moves from app.js |
|---|---|
| `js/api.js` | lines 7–38 (`USE_MOCK`→`false` stays, `API_BASE`, `WS_URL`, token capture IIFE, `authToken`, `withToken`), 424–488 (`jfetch`, `jpost`, `liveApi`, `api =` selector) |
| `js/mock.js` | lines 40–422 (`SAMPLE_PROMPTS`, `MOCK_DATA`, `makePlaceholderSvg`, `wait` → move `wait` to util instead, `ensureMockTvArt`, `mockApi`) — `export const mockApi` |
| `js/util.js` | `escapeHtml` (1430), `relativeTime` (1440), `highlightJson` (1457), `wait` (267) |
| `js/status.js` | `STATUS_LABELS`, `statusHistory`, `renderStatus` (504), `connectStatusWS` (525) + status-popover wiring — `export { connectStatusWS }` |
| `js/router.js` | `showRoute` (589), `parseHash` (602), `navigate` (612) + `hashchange` listener — `export { navigate, showRoute }`. Route→render mapping imports the view modules. |
| `js/views/onboarding.js` | `enterOnboarding` (628), `showOnboardingStep` (633), `runDiscover` (655), `confirmTvChoice` (691), `stopPairTimers` (725), `runPairCountdown` (730) — `export { enterOnboarding }` |
| `js/views/themes.js` | `renderThemes` (814), `themeCardEl` (827) + new-theme sheet wiring — `export { renderThemes }` |
| `js/views/themeDetail.js` | `renderThemeDetail` (889), `renderExpansion` (926), `imageTileEl` (941) — `export { renderThemeDetail }` |
| `js/views/inspect.js` | `openInspect` (986) + inspect-close wiring — `export { openInspect }` |
| `js/views/tv.js` | `tvView` state object, `MATTE_STYLES`, `MATTE_COLORS`, `renderTV` (1031) through `renderTvPickers` (1321) — `export { renderTV, tvView }` |
| `js/views/schedule.js` | `renderSchedule` (1360) — `export { renderSchedule }` |
| `js/views/settings.js` | `renderSettings` (1413) — `export { renderSettings }` |
| `js/main.js` | Whatever bootstrapping remains at the bottom of `app.js` (initial `navigate()`, `connectStatusWS()` calls, global listeners) |

Circular-import guard: view modules import from `api.js`/`util.js`/`router.js` only; `router.js` imports the view modules; nothing imports `main.js`.

- [ ] **Step 2: Switch index.html to the module entry**

```html
<!-- replace: <script src="app.js"></script> -->
<script type="module" src="js/main.js"></script>
```

- [ ] **Step 3: Verify — server tests still pass**

Run: `pytest && ruff check src/`
Expected: all pass (backend untouched).

- [ ] **Step 4: Verify — browser walkthrough**

Run: `frameforged` then open `http://localhost:8765`. Checklist — every item must behave exactly as before the refactor:
- Themes grid renders with mosaics; clicking a card opens theme detail; expansion panel loads.
- Clicking an image tile opens the inspect sheet; close works.
- TV screen: status card, both panels populate, select/upload/remove buttons enable/disable with selection, matte/minutes pickers work.
- Schedule and Settings screens render.
- Status chip shows Idle; no console errors on any screen.

- [ ] **Step 5: Delete the old file and commit**

```bash
git rm src/frameforge/static/app.js
git add src/frameforge/static/js src/frameforge/static/index.html
git commit -m "refactor(frontend): split app.js into ES modules, no behavior change"
```

---

### Task 4: Header TV indicator, honest failure messages, one-click re-discovery

**Files:**
- Create: `src/frameforge/static/js/tvhealth.js`
- Modify: `src/frameforge/static/index.html`, `src/frameforge/static/js/main.js`, `src/frameforge/static/js/views/tv.js`, `src/frameforge/static/app.css`

**Interfaces:**
- Consumes: `api.tvStatus()`, `api.discover()`, `api.setTvHost(host)` from `js/api.js`.
- Produces: `js/tvhealth.js` exports `startTvHealth()` (call once from main.js) and `pollTvHealth()` (returns the latest `TVStatus` or null; callable before TV actions); `tvActionError(err) -> string` exported from `js/tvhealth.js` for friendly failure copy.

- [ ] **Step 1: Add the chip to the header in index.html**

Insert before the status-chip button:

```html
<a class="tv-chip" id="tv-chip" href="#/tv" data-state="unknown" title="TV connection">TV · …</a>
```

- [ ] **Step 2: Implement `js/tvhealth.js`**

```javascript
/* Header TV connection indicator + friendly TV error copy.
 * Polls /api/tv/status every 60s while the tab is visible, and on demand. */
import { api } from "./api.js";

const POLL_MS = 60_000;

const LABELS = {
  ok: "TV · connected",
  unreachable: "TV · unreachable",
  none: "TV · not set up",
  unknown: "TV · …",
};

function render(state) {
  const chip = document.getElementById("tv-chip");
  if (!chip) return;
  chip.dataset.state = state;
  chip.textContent = LABELS[state];
}

export async function pollTvHealth() {
  try {
    const s = await api.tvStatus();
    render(!s.host ? "none" : s.connected ? "ok" : "unreachable");
    return s;
  } catch (_) {
    render("unreachable");
    return null;
  }
}

export function startTvHealth() {
  pollTvHealth();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollTvHealth();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") pollTvHealth();
  }, POLL_MS);
}

/* Map raw fetch/HTTP errors from TV actions to copy a person can act on. */
export function tvActionError(err) {
  const msg = String((err && err.message) || err);
  if (/unreachable|refused|timed? ?out|502|503|No TV configured/i.test(msg)) {
    return "TV is unreachable — is it powered on and on this Wi-Fi? (If its IP changed, use “Find my TV again” on the TV screen.)";
  }
  return msg;
}
```

- [ ] **Step 3: Wire into main.js**

```javascript
import { startTvHealth } from "./tvhealth.js";
startTvHealth();
```

- [ ] **Step 4: Friendly failures in views/tv.js**

Import `{ pollTvHealth, tvActionError }`. In `wireTvPanelButtons`, replace the two catch-block messages:
- `alert(\`Remove failed: ${err.message || err}\`)` → `alert(\`Remove failed: ${tvActionError(err)}\`)`
- `alert(\`Upload failed: ${err.message || err}\`)` → `alert(\`Upload failed: ${tvActionError(err)}\`)`

Also call `pollTvHealth()` at the end of both handlers so the header chip reflects reality after any TV action.

- [ ] **Step 5: Unreachable-with-saved-host card + re-discovery in views/tv.js**

In `renderTvStatusCard`, split the not-connected branch: `status.host` set means *unreachable*, not *never set up*:

```javascript
if (!status.connected && !status.host) {
  card.innerHTML = `
    <div class="tv-empty">
      <p class="lede" style="margin:0 0 12px">No TV connected.</p>
      <a class="btn btn-primary" href="#/onboarding">Run setup</a>
    </div>`;
} else if (!status.connected) {
  card.innerHTML = `
    <div class="tv-empty">
      <p class="lede" style="margin:0 0 4px">Can’t reach the TV at ${escapeHtml(status.host)}.</p>
      <p class="onboarding-meta" style="margin:0 0 12px">Is it powered on and on this Wi-Fi? If its address changed, rediscover it — no re-pairing needed.</p>
      <button class="btn btn-secondary" id="tv-retry">Retry</button>
      <button class="btn btn-primary" id="tv-rediscover">Find my TV again</button>
    </div>`;
  document.getElementById("tv-retry").onclick = () => renderTV();
  document.getElementById("tv-rediscover").onclick = async () => {
    const btn = document.getElementById("tv-rediscover");
    btn.disabled = true;
    btn.textContent = "Searching…";
    try {
      const tvs = await api.discover();
      const frame = tvs.find((t) => t.is_frame) || tvs[0];
      if (!frame) {
        alert("No Samsung TVs found on this network.");
        return;
      }
      await api.setTvHost(frame.host);
      renderTV();
    } catch (err) {
      alert(`Discovery failed: ${tvActionError(err)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Find my TV again";
    }
  };
} else { /* existing connected branch unchanged */ }
```

- [ ] **Step 6: Chip styles in app.css**

```css
/* Header TV connection chip */
.tv-chip {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--line, #d8d2c4);
  text-decoration: none;
  color: inherit;
  white-space: nowrap;
}
.tv-chip[data-state="ok"] { border-color: #7ba05b; color: #4a6b34; }
.tv-chip[data-state="unreachable"] { border-color: #c0603f; color: #963f22; }
.tv-chip[data-state="none"] { opacity: 0.6; }
```

(Match existing pill/chip styling in app.css; reuse its variables if defined.)

- [ ] **Step 7: Verify in browser**

Run `frameforged`, open the UI:
- Chip shows `TV · connected` (real TV on) within a second of load.
- Turn the TV off at the wall (or use an unroutable saved host on a test library): chip flips to `TV · unreachable` after next poll or TV action; TV screen shows the unreachable card; *Find my TV again* recovers when the TV is back.

- [ ] **Step 8: Run suite and commit**

```bash
pytest && ruff check src/
git add src/frameforge/static
git commit -m "feat(frontend): TV health chip, honest failure copy, one-click rediscovery"
```

---

### Task 5: Sidecar tolerance — imported sidecars lack prompt/seed fields

**Files:**
- Modify: `src/frameforge/library.py` (`write_manifest`), `src/frameforge/server.py` (`_last_refreshed_iso`, `theme_detail`, `inspect_image`)
- Test: `tests/test_server.py`

**Interfaces:**
- Consumes: sidecar dicts.
- Produces: all endpoints and the manifest writer return 200/success for a theme whose sidecars have `source: "imported"`, `original_filename`, `imported_at` and **no** `prompt`/`expansion_seed`/`generated_at`. Later tasks rely on the fixture helper `_add_imported_fixture(lib_root: Path) -> None` added here.

- [ ] **Step 1: Add fixture helper + failing tests to tests/test_server.py**

Add after `_build_fixture_library`:

```python
def _add_imported_fixture(lib_root: Path) -> None:
    """Add an imported-style entry: sidecar has no prompt/seed/generated_at."""
    d = lib_root / "imported"
    (d / "originals").mkdir(parents=True)
    Image.new("RGB", (3840, 2160), color=(30, 60, 90)).save(d / "img_0001.png")
    (d / "originals" / "sunset.jpg").write_bytes(b"fake-original")
    (d / "img_0001.json").write_text(
        json.dumps(
            {
                "filename": "img_0001.png",
                "theme": "Imported",
                "source": "imported",
                "original_filename": "sunset.jpg",
                "imported_at": "2026-07-01T10:00:00Z",
                "crop": {"x": 0, "y": 128, "w": 4096, "h": 2304},
                "width": 3840,
                "height": 2160,
                "frameforge_version": "0.1.0",
            }
        )
    )
```

Add tests (new fixture variant that includes the imported theme):

```python
@pytest.fixture
def app_with_imported(tmp_path, monkeypatch):
    lib_root = _build_fixture_library(tmp_path)
    _add_imported_fixture(lib_root)
    monkeypatch.setenv("FRAMEFORGE_LIBRARY", str(lib_root))
    monkeypatch.setenv("XAI_API_KEY", "test-key")
    import importlib

    import frameforge.server as server_mod

    importlib.reload(server_mod)
    return TestClient(server_mod.app), lib_root


def test_themes_list_includes_imported(app_with_imported):
    client, _ = app_with_imported
    cards = client.get("/api/themes").json()
    imported = next(c for c in cards if c["slug"] == "imported")
    assert imported["title"] == "Imported"
    assert imported["image_count"] == 1
    assert imported["last_refreshed"] == "2026-07-01T10:00:00Z"  # from imported_at


def test_imported_theme_detail_uses_original_filename(app_with_imported):
    client, _ = app_with_imported
    r = client.get("/api/themes/imported")
    assert r.status_code == 200
    d = r.json()
    assert d["images"][0]["prompt_short"] == "sunset.jpg"
    # expansion never populates for imported themes, even when asked
    r2 = client.get("/api/themes/imported?with_expansion=true")
    assert r2.status_code == 200 and r2.json()["expansion"] is None


def test_imported_inspect_and_manifest(app_with_imported):
    client, lib_root = app_with_imported
    r = client.get("/api/themes/imported/images/img_0001.png/inspect")
    assert r.status_code == 200
    assert r.json()["prompt"] == "sunset.jpg"

    from frameforge.config import Config
    from frameforge.library import Library

    lib = Library(Config(library_root=lib_root))
    manifest = lib.write_manifest("imported")
    assert "img_0001.png" in manifest.read_text()
```

- [ ] **Step 2: Run to verify failures**

Run: `pytest tests/test_server.py -k imported -v`
Expected: FAIL — `KeyError: 'prompt'` / `KeyError: 'generated_at'` / `KeyError: 'expansion_seed'`

- [ ] **Step 3: Make library.py tolerant**

In `write_manifest`, replace the row-building `m[...]` lookups with `.get`:

```python
            for entry in entries:
                m = entry.load_meta()
                writer.writerow(
                    [
                        m.get("filename", ""),
                        m.get("theme", ""),
                        m.get("prompt", ""),
                        m.get("expansion_seed", ""),
                        m.get("image_model", ""),
                        m.get("resolution", ""),
                        m.get("aspect_ratio", ""),
                        m.get("generated_at") or m.get("imported_at", ""),
                        m.get("frameforge_version", ""),
                    ]
                )
```

- [ ] **Step 4: Make server.py tolerant**

- `_last_refreshed_iso`: inside the loop, replace `times.append(e.load_meta()["generated_at"])` with:

```python
        t = e.load_meta().get("generated_at") or e.load_meta().get("imported_at")
        if t:
            times.append(t)
```

(keep the try/except; load meta once into a local.)

- `theme_detail`: `first_meta["theme"]` → `first_meta.get("theme", slug)` (both uses); tile prompt becomes `_short_prompt(meta.get("prompt") or meta.get("original_filename", ""))`; guard expansion:

```python
    if with_expansion and "expansion_seed" in first_meta:
```

and inside it, `e.load_meta().get("prompt", "")` for the prompts list, `first_meta.get("generated_at", "")`, `first_meta.get("frameforge_version", "")`.

- `inspect_image`: `prompt=sidecar.get("prompt") or sidecar.get("original_filename", "")`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_server.py -v`
Expected: all pass, including the three new tests and every pre-existing one.

- [ ] **Step 6: Commit**

```bash
git add src/frameforge/library.py src/frameforge/server.py tests/test_server.py
git commit -m "feat: tolerate imported-image sidecars across manifest and endpoints"
```

---

### Task 6: `imports.py` — crop, fit, save, preserve originals

**Files:**
- Create: `src/frameforge/imports.py`
- Test: `tests/test_imports.py`

**Interfaces:**
- Consumes: `Config` (`theme_dir`, `library_root`).
- Produces (Tasks 7–8 depend on these exact names):
  - Constants: `IMPORTED_SLUG = "imported"`, `IMPORTED_TITLE = "Imported"`, `TARGET_W, TARGET_H = 3840, 2160`, `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`.
  - Exceptions: `ImportTooLarge`, `InvalidImage`, `InvalidCrop`, `OriginalMissing` (all subclass `Exception`).
  - `@dataclass ImportResult(filename: str, original_filename: str, width: int, height: int)`
  - `import_image(cfg: Config, data: bytes, original_name: str, crop: tuple[int, int, int, int] | None) -> ImportResult` — crop is `(x, y, w, h)` in source pixels; `None` = keep original aspect (portrait escape hatch), but 16:9 originals wider than 3840 are still downsized.
  - `recrop_image(cfg: Config, filename: str, crop: tuple[int, int, int, int]) -> ImportResult`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_imports.py
"""Import pipeline: crop math, validation, atomicity, originals."""
import json
from io import BytesIO

import pytest
from PIL import Image

from frameforge.config import Config
from frameforge.imports import (
    IMPORTED_SLUG,
    ImportTooLarge,
    InvalidCrop,
    InvalidImage,
    OriginalMissing,
    import_image,
    recrop_image,
)


def _png_bytes(w: int, h: int, color=(200, 120, 40)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def cfg(tmp_path) -> Config:
    return Config(library_root=tmp_path / "lib")


def test_import_with_crop(cfg):
    data = _png_bytes(4096, 4096)
    r = import_image(cfg, data, "square.png", (0, 1024, 4096, 2304))
    assert r.filename == "img_0001.png"
    d = cfg.theme_dir(IMPORTED_SLUG)
    out = Image.open(d / r.filename)
    assert (out.width, out.height) == (3840, 2160)  # downsized, never upscaled
    meta = json.loads((d / "img_0001.json").read_text())
    assert meta["source"] == "imported"
    assert meta["theme"] == "Imported"
    assert meta["original_filename"] == "square.png"
    assert meta["crop"] == {"x": 0, "y": 1024, "w": 4096, "h": 2304}
    assert (d / "originals" / "square.png").read_bytes() == data


def test_small_crop_not_upscaled(cfg):
    r = import_image(cfg, _png_bytes(1920, 1920), "s.png", (0, 0, 1600, 900))
    out = Image.open(cfg.theme_dir(IMPORTED_SLUG) / r.filename)
    assert (out.width, out.height) == (1600, 900)


def test_import_keep_original_portrait(cfg):
    r = import_image(cfg, _png_bytes(1080, 1920), "portrait.png", None)
    out = Image.open(cfg.theme_dir(IMPORTED_SLUG) / r.filename)
    assert (out.width, out.height) == (1080, 1920)
    meta = json.loads(
        (cfg.theme_dir(IMPORTED_SLUG) / "img_0001.json").read_text()
    )
    assert meta["crop"] is None


def test_import_no_crop_downsizes_16_9(cfg):
    r = import_image(cfg, _png_bytes(7680, 4320), "big.png", None)
    out = Image.open(cfg.theme_dir(IMPORTED_SLUG) / r.filename)
    assert (out.width, out.height) == (3840, 2160)


def test_filenames_increment_and_original_collisions_suffixed(cfg):
    import_image(cfg, _png_bytes(1600, 900), "a.png", None)
    r2 = import_image(cfg, _png_bytes(1600, 900), "a.png", None)
    assert r2.filename == "img_0002.png"
    assert r2.original_filename == "a_1.png"


def test_crop_must_be_16_9(cfg):
    with pytest.raises(InvalidCrop):
        import_image(cfg, _png_bytes(4000, 3000), "x.png", (0, 0, 1000, 1000))


def test_crop_must_be_in_bounds(cfg):
    with pytest.raises(InvalidCrop):
        import_image(cfg, _png_bytes(1920, 1080), "x.png", (500, 0, 1920, 1080))


def test_rejects_non_image(cfg):
    with pytest.raises(InvalidImage):
        import_image(cfg, b"not an image at all", "x.png", None)
    assert not (cfg.theme_dir(IMPORTED_SLUG) / "img_0001.png").exists()


def test_rejects_oversized(cfg, monkeypatch):
    monkeypatch.setattr("frameforge.imports.MAX_UPLOAD_BYTES", 1000)
    with pytest.raises(ImportTooLarge):
        import_image(cfg, _png_bytes(1920, 1080), "x.png", None)


def test_recrop_from_original(cfg):
    data = _png_bytes(4096, 4096)
    r = import_image(cfg, data, "sq.png", (0, 0, 4096, 2304))
    r2 = recrop_image(cfg, r.filename, (0, 1792, 4096, 2304))
    assert r2.filename == r.filename  # same file, replaced in place
    meta = json.loads(
        (cfg.theme_dir(IMPORTED_SLUG) / "img_0001.json").read_text()
    )
    assert meta["crop"]["y"] == 1792
    assert "recropped_at" in meta


def test_recrop_missing_raises(cfg):
    with pytest.raises(OriginalMissing):
        recrop_image(cfg, "img_9999.png", (0, 0, 1600, 900))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_imports.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'frameforge.imports'`

- [ ] **Step 3: Implement `src/frameforge/imports.py`**

```python
"""Import user images into the library: 16:9 crop, originals preserved.

Imported images are ordinary library entries under the reserved `imported`
theme directory; the untouched upload lives in imported/originals/ so a
recrop never loses quality. PNG-then-sidecar write order matters: the
library ignores a PNG with no sidecar, so a crash between the two writes
leaves nothing user-visible.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from . import __version__
from .config import Config

IMPORTED_SLUG = "imported"
IMPORTED_TITLE = "Imported"
TARGET_W, TARGET_H = 3840, 2160
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_RATIO = 16 / 9
_RATIO_TOLERANCE = 0.01


class ImportTooLarge(Exception):
    pass


class InvalidImage(Exception):
    pass


class InvalidCrop(Exception):
    pass


class OriginalMissing(Exception):
    pass


@dataclass
class ImportResult:
    filename: str
    original_filename: str
    width: int
    height: int


def is_16_9(w: int, h: int) -> bool:
    return h > 0 and abs(w / h - _RATIO) <= _RATIO * _RATIO_TOLERANCE


def next_import_filename(theme_dir: Path) -> str:
    nums = [int(p.stem.split("_")[1]) for p in theme_dir.glob("img_*.png")]
    return f"img_{(max(nums) + 1 if nums else 1):04d}.png"


def _save_original(theme_dir: Path, original_name: str, data: bytes) -> Path:
    originals = theme_dir / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    safe = Path(original_name).name or "import"
    dest = originals / safe
    stem, suffix = dest.stem, dest.suffix
    n = 1
    while dest.exists():
        dest = originals / f"{stem}_{n}{suffix}"
        n += 1
    dest.write_bytes(data)
    return dest


def _crop_and_fit(img: Image.Image, crop: tuple[int, int, int, int] | None) -> Image.Image:
    out = img.convert("RGB")
    if crop is None:
        if is_16_9(out.width, out.height) and out.width > TARGET_W:
            out = out.resize((TARGET_W, TARGET_H), Image.LANCZOS)
        return out
    x, y, w, h = crop
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > out.width or y + h > out.height:
        raise InvalidCrop(
            f"Crop ({x},{y},{w},{h}) outside image bounds {out.width}x{out.height}"
        )
    if not is_16_9(w, h):
        raise InvalidCrop(f"Crop {w}x{h} is not 16:9")
    out = out.crop((x, y, x + w, y + h))
    if out.width > TARGET_W:
        out = out.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    return out


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write_png_then_sidecar(
    theme_dir: Path,
    final_name: str,
    out: Image.Image,
    sidecar: dict,
) -> None:
    tmp = theme_dir / (final_name + ".tmp")
    out.save(tmp, format="PNG")
    tmp.rename(theme_dir / final_name)
    (theme_dir / final_name).with_suffix(".json").write_text(
        json.dumps(sidecar, indent=2)
    )


def import_image(
    cfg: Config,
    data: bytes,
    original_name: str,
    crop: tuple[int, int, int, int] | None,
) -> ImportResult:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImportTooLarge(
            f"{len(data)} bytes exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB cap"
        )
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise InvalidImage(f"Not a readable image: {e}")

    out = _crop_and_fit(img, crop)  # validate before touching disk
    theme_dir = cfg.theme_dir(IMPORTED_SLUG)
    theme_dir.mkdir(parents=True, exist_ok=True)
    original_path = _save_original(theme_dir, original_name, data)
    final_name = next_import_filename(theme_dir)
    sidecar = {
        "filename": final_name,
        "theme": IMPORTED_TITLE,
        "source": "imported",
        "original_filename": original_path.name,
        "imported_at": _now(),
        "crop": (
            {"x": crop[0], "y": crop[1], "w": crop[2], "h": crop[3]} if crop else None
        ),
        "width": out.width,
        "height": out.height,
        "frameforge_version": __version__,
    }
    _write_png_then_sidecar(theme_dir, final_name, out, sidecar)
    return ImportResult(final_name, original_path.name, out.width, out.height)


def recrop_image(
    cfg: Config, filename: str, crop: tuple[int, int, int, int]
) -> ImportResult:
    theme_dir = cfg.theme_dir(IMPORTED_SLUG)
    sidecar_path = (theme_dir / filename).with_suffix(".json")
    if not sidecar_path.exists():
        raise OriginalMissing(f"No imported image named {filename}")
    meta = json.loads(sidecar_path.read_text())
    original = theme_dir / "originals" / meta["original_filename"]
    if not original.exists():
        raise OriginalMissing(f"Original file for {filename} is gone")

    img = Image.open(original)
    img.load()
    out = _crop_and_fit(img, crop)
    meta.update(
        {
            "crop": {"x": crop[0], "y": crop[1], "w": crop[2], "h": crop[3]},
            "width": out.width,
            "height": out.height,
            "recropped_at": _now(),
        }
    )
    _write_png_then_sidecar(theme_dir, filename, out, meta)
    return ImportResult(filename, meta["original_filename"], out.width, out.height)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_imports.py -v`
Expected: 11 passed

- [ ] **Step 5: Full suite, lint, commit**

```bash
pytest && ruff check src/
git add src/frameforge/imports.py tests/test_imports.py
git commit -m "feat: import pipeline — 16:9 crop, originals preserved, atomic writes"
```

---

### Task 7: `POST /api/imports` endpoint

**Files:**
- Modify: `src/frameforge/server.py`, `pyproject.toml`
- Test: `tests/test_server.py`

**Interfaces:**
- Consumes: `import_image` and exceptions from Task 6.
- Produces: `POST /api/imports` (multipart: `file`, optional `crop_x/crop_y/crop_w/crop_h` form ints) → `{"slug": "imported", "filename": "img_0001.png", "original_filename": ..., "width": ..., "height": ...}`. Errors: 400 partial crop / bad image / bad crop, 413 oversized. Task 9's frontend calls this.

- [ ] **Step 1: Add the multipart dependency**

In `pyproject.toml` dependencies, after `"websockets>=12.0",` add:

```toml
    "python-multipart>=0.0.9",
```

Run: `pip install -e ".[dev]"`
Expected: installs python-multipart.

- [ ] **Step 2: Write the failing tests (append to tests/test_server.py)**

```python
def _upload_png(w=1920, h=1080):
    from io import BytesIO

    buf = BytesIO()
    Image.new("RGB", (w, h), (10, 120, 90)).save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_import_endpoint_no_crop(app_with_fixture):
    client, lib_root = app_with_fixture
    r = client.post(
        "/api/imports",
        files={"file": ("photo.png", _upload_png(), "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "imported" and body["filename"] == "img_0001.png"
    assert (lib_root / "imported" / "img_0001.png").exists()
    assert (lib_root / "imported" / "originals" / "photo.png").exists()
    # imported theme now appears in the themes list
    slugs = [c["slug"] for c in client.get("/api/themes").json()]
    assert "imported" in slugs


def test_import_endpoint_with_crop(app_with_fixture):
    client, lib_root = app_with_fixture
    r = client.post(
        "/api/imports",
        files={"file": ("wide.png", _upload_png(4000, 3000), "image/png")},
        data={"crop_x": "0", "crop_y": "375", "crop_w": "4000", "crop_h": "2250"},
    )
    assert r.status_code == 200
    out = Image.open(lib_root / "imported" / r.json()["filename"])
    assert (out.width, out.height) == (3840, 2160)


def test_import_endpoint_partial_crop_400(app_with_fixture):
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports",
        files={"file": ("x.png", _upload_png(), "image/png")},
        data={"crop_x": "0"},
    )
    assert r.status_code == 400


def test_import_endpoint_bad_image_400(app_with_fixture):
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports", files={"file": ("x.png", b"garbage", "image/png")}
    )
    assert r.status_code == 400


def test_import_endpoint_oversized_413(app_with_fixture, monkeypatch):
    import frameforge.imports as imports_mod

    monkeypatch.setattr(imports_mod, "MAX_UPLOAD_BYTES", 100)
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports", files={"file": ("x.png", _upload_png(), "image/png")}
    )
    assert r.status_code == 413
```

- [ ] **Step 3: Run to verify failures**

Run: `pytest tests/test_server.py -k import_endpoint -v`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 4: Implement the endpoint in server.py**

Imports at top:

```python
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from .imports import (
    IMPORTED_SLUG,
    ImportTooLarge,
    InvalidCrop,
    InvalidImage,
    import_image,
)
```

(`recrop_image` and `OriginalMissing` are added to this import in Task 8 — importing them now would fail ruff's unused-import check at this task's commit.)

Add after the TV art-management section:

```python
# ----- Image imports -------------------------------------------------------
# Any image from disk becomes a library entry in the reserved "imported"
# collection: cropped to 16:9 server-side, original preserved for recrops.


@app.post("/api/imports")
async def create_import(
    file: UploadFile = File(...),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
) -> dict:
    parts = [crop_x, crop_y, crop_w, crop_h]
    given = [p is not None for p in parts]
    if any(given) and not all(given):
        raise HTTPException(
            status_code=400, detail="Provide all of crop_x/y/w/h, or none"
        )
    crop = (crop_x, crop_y, crop_w, crop_h) if all(given) else None

    data = await file.read()
    cfg = Config()
    try:
        result = await asyncio.to_thread(
            import_image, cfg, data, file.filename or "import", crop
        )
    except ImportTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))
    except (InvalidImage, InvalidCrop) as e:
        raise HTTPException(status_code=400, detail=str(e))
    await asyncio.to_thread(Library(cfg).write_manifest, IMPORTED_SLUG)
    return {
        "slug": IMPORTED_SLUG,
        "filename": result.filename,
        "original_filename": result.original_filename,
        "width": result.width,
        "height": result.height,
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_server.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/frameforge/server.py pyproject.toml tests/test_server.py
git commit -m "feat: POST /api/imports — multipart import with server-side 16:9 crop"
```

---

### Task 8: Recrop endpoint

**Files:**
- Modify: `src/frameforge/server.py`
- Test: `tests/test_server.py`

**Interfaces:**
- Consumes: `recrop_image`, `OriginalMissing`, `InvalidCrop` from Task 6 (already imported in Task 7).
- Produces: `POST /api/imports/{filename}/recrop` with JSON body `{crop_x, crop_y, crop_w, crop_h}` → `{"slug": "imported", "filename": ..., "width": ..., "height": ...}`; 404 unknown filename/missing original, 400 invalid crop.

- [ ] **Step 1: Write the failing tests (append to tests/test_server.py)**

```python
def test_recrop_endpoint(app_with_fixture):
    client, lib_root = app_with_fixture
    up = client.post(
        "/api/imports",
        files={"file": ("sq.png", _upload_png(4000, 4000), "image/png")},
        data={"crop_x": "0", "crop_y": "0", "crop_w": "4000", "crop_h": "2250"},
    )
    filename = up.json()["filename"]
    r = client.post(
        f"/api/imports/{filename}/recrop",
        json={"crop_x": 0, "crop_y": 1750, "crop_w": 4000, "crop_h": 2250},
    )
    assert r.status_code == 200
    meta = json.loads((lib_root / "imported" / filename).with_suffix(".json").read_text())
    assert meta["crop"]["y"] == 1750


def test_recrop_unknown_404(app_with_fixture):
    client, _ = app_with_fixture
    r = client.post(
        "/api/imports/img_9999.png/recrop",
        json={"crop_x": 0, "crop_y": 0, "crop_w": 1600, "crop_h": 900},
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify failures**

Run: `pytest tests/test_server.py -k recrop -v`
Expected: FAIL — 404 route not found (both tests fail before implementation; the second fails for the wrong reason until the route exists)

- [ ] **Step 3: Implement (server.py, after `create_import`)**

Extend the Task 7 import to `from .imports import (IMPORTED_SLUG, ImportTooLarge, InvalidCrop, InvalidImage, OriginalMissing, import_image, recrop_image)`, then add:

```python
class RecropRequest(BaseModel):
    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int


@app.post("/api/imports/{filename}/recrop")
async def recrop(filename: str, body: RecropRequest) -> dict:
    cfg = Config()
    try:
        result = await asyncio.to_thread(
            recrop_image,
            cfg,
            filename,
            (body.crop_x, body.crop_y, body.crop_w, body.crop_h),
        )
    except OriginalMissing as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InvalidCrop as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "slug": IMPORTED_SLUG,
        "filename": result.filename,
        "width": result.width,
        "height": result.height,
    }
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `pytest && ruff check src/`
Expected: all pass.

```bash
git add src/frameforge/server.py tests/test_server.py
git commit -m "feat: recrop endpoint — re-run 16:9 crop from the preserved original"
```

---

### Task 9: Crop overlay + import UI

**Files:**
- Create: `src/frameforge/static/js/crop.js`
- Modify: `src/frameforge/static/js/api.js`, `js/views/tv.js`, `js/views/themeDetail.js`, `src/frameforge/static/index.html`, `src/frameforge/static/app.css`

**Interfaces:**
- Consumes: `POST /api/imports` (Task 7); `jfetch`, `API_BASE` from `js/api.js`.
- Produces: `js/crop.js` exports `async function importWithCrop(files: File[]) -> {imported: Array<{slug, filename}>, sendToTv: boolean}`; `js/api.js` gains `importImage(file, crop|null)` and `recropImage(filename, crop)`.

- [ ] **Step 1: Add API methods to `js/api.js` (inside `liveApi`)**

```javascript
  importImage: (file, crop) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (crop) {
      fd.append("crop_x", Math.round(crop.x));
      fd.append("crop_y", Math.round(crop.y));
      fd.append("crop_w", Math.round(crop.w));
      fd.append("crop_h", Math.round(crop.h));
    }
    return jfetch(`${API_BASE}/api/imports`, { method: "POST", body: fd });
  },
  recropImage: (filename, crop) =>
    jpost(`${API_BASE}/api/imports/${filename}/recrop`, {
      crop_x: Math.round(crop.x),
      crop_y: Math.round(crop.y),
      crop_w: Math.round(crop.w),
      crop_h: Math.round(crop.h),
    }),
```

(`jfetch` only sets the Authorization header, so FormData bodies keep their auto multipart boundary. Add the same two method names to `mockApi` in `js/mock.js` as `async () => ({ slug: "imported", filename: "img_0001.png" })` stubs.)

- [ ] **Step 2: Implement `js/crop.js`**

```javascript
/* 16:9 crop overlay for imports. One modal, files queue through it.
 * Coordinates: crop rect kept in source-image pixels; rendered scaled. */
import { api } from "./api.js";

const RATIO = 16 / 9;
const TOL = 0.01;

let sheet = null;

function buildSheet() {
  sheet = document.createElement("div");
  sheet.className = "crop-backdrop hidden";
  sheet.innerHTML = `
    <div class="crop-sheet" role="dialog" aria-label="Crop image">
      <div class="crop-stage" id="crop-stage">
        <img id="crop-img" alt="" draggable="false" />
        <div class="crop-rect" id="crop-rect">
          <span class="crop-handle" id="crop-handle" aria-label="Resize"></span>
        </div>
      </div>
      <div class="crop-bar">
        <span class="crop-filename" id="crop-filename"></span>
        <span class="crop-queue" id="crop-queue"></span>
      </div>
      <label class="crop-tv-toggle">
        <input type="checkbox" id="crop-send-tv" /> Send to TV after import
      </label>
      <div class="crop-actions">
        <button class="btn btn-ghost" id="crop-skip">Skip</button>
        <button class="btn btn-ghost" id="crop-keep">Keep original (TV mattes it)</button>
        <button class="btn btn-secondary" id="crop-center-rest">Center-crop the rest</button>
        <button class="btn btn-primary" id="crop-import">Import</button>
      </div>
      <p class="crop-error hidden" id="crop-error"></p>
    </div>`;
  document.body.appendChild(sheet);
}

function centeredCrop(w, h) {
  if (w / h > RATIO) {
    const cw = Math.floor(h * RATIO);
    return { x: Math.floor((w - cw) / 2), y: 0, w: cw, h };
  }
  const ch = Math.floor(w / RATIO);
  return { x: 0, y: Math.floor((h - ch) / 2), w, h: ch };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error(`${file.name} is not a readable image`));
    img.src = url;
  });
}

/* Render + drag logic for one image; resolves with the chosen crop
 * ({x,y,w,h} source px), null for keep-original, or the strings
 * "skip" / "center-rest". */
function presentCrop(file, natW, natH, url, queueText) {
  const imgEl = sheet.querySelector("#crop-img");
  const rectEl = sheet.querySelector("#crop-rect");
  const stage = sheet.querySelector("#crop-stage");
  imgEl.src = url;
  sheet.querySelector("#crop-filename").textContent = file.name;
  sheet.querySelector("#crop-queue").textContent = queueText;
  sheet.querySelector("#crop-error").classList.add("hidden");
  sheet.classList.remove("hidden");

  let crop = centeredCrop(natW, natH);

  const scale = () => imgEl.clientWidth / natW;
  const syncRect = () => {
    const s = scale();
    const ox = imgEl.offsetLeft, oy = imgEl.offsetTop;
    rectEl.style.left = `${ox + crop.x * s}px`;
    rectEl.style.top = `${oy + crop.y * s}px`;
    rectEl.style.width = `${crop.w * s}px`;
    rectEl.style.height = `${crop.h * s}px`;
  };
  // Re-sync once the <img> lays out, and on window resize while open
  requestAnimationFrame(syncRect);
  const onResize = () => syncRect();
  window.addEventListener("resize", onResize);

  const clamp = () => {
    crop.x = Math.max(0, Math.min(crop.x, natW - crop.w));
    crop.y = Math.max(0, Math.min(crop.y, natH - crop.h));
  };

  // Drag to move; handle to resize (kept 16:9)
  let drag = null; // {mode:"move"|"resize", startX, startY, orig}
  rectEl.onpointerdown = (e) => {
    e.preventDefault();
    rectEl.setPointerCapture(e.pointerId);
    drag = {
      mode: e.target.id === "crop-handle" ? "resize" : "move",
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...crop },
    };
  };
  rectEl.onpointermove = (e) => {
    if (!drag) return;
    const s = scale();
    const dx = (e.clientX - drag.startX) / s;
    const dy = (e.clientY - drag.startY) / s;
    if (drag.mode === "move") {
      crop.x = drag.orig.x + dx;
      crop.y = drag.orig.y + dy;
    } else {
      const maxW = Math.min(natW - drag.orig.x, (natH - drag.orig.y) * RATIO);
      crop.w = Math.max(320, Math.min(drag.orig.w + dx, maxW));
      crop.h = crop.w / RATIO;
    }
    clamp();
    syncRect();
  };
  rectEl.onpointerup = () => (drag = null);

  return new Promise((resolve) => {
    const done = (v) => {
      window.removeEventListener("resize", onResize);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    sheet.querySelector("#crop-import").onclick = () =>
      done({ x: crop.x, y: crop.y, w: crop.w, h: crop.h });
    sheet.querySelector("#crop-keep").onclick = () => done(null);
    sheet.querySelector("#crop-skip").onclick = () => done("skip");
    sheet.querySelector("#crop-center-rest").onclick = () => done("center-rest");
  });
}

export async function importWithCrop(files) {
  if (!sheet) buildSheet();
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) return { imported: [], sendToTv: false };

  const imported = [];
  let centerRest = false;
  const errEl = () => sheet.querySelector("#crop-error");

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    let loaded;
    try {
      loaded = await loadImage(file);
    } catch (e) {
      errEl().textContent = e.message;
      errEl().classList.remove("hidden");
      continue;
    }
    const { img, url } = loaded;
    const natW = img.naturalWidth, natH = img.naturalHeight;
    const already169 = Math.abs(natW / natH - RATIO) <= RATIO * TOL;

    let choice;
    if (already169 || centerRest) {
      URL.revokeObjectURL(url);
      choice = already169 ? null : centeredCrop(natW, natH);
    } else {
      choice = await presentCrop(file, natW, natH, url, `${i + 1} of ${list.length}`);
      if (choice === "skip") continue;
      if (choice === "center-rest") {
        centerRest = true;
        choice = centeredCrop(natW, natH);
      }
    }

    try {
      const r = await api.importImage(file, choice);
      imported.push({ slug: r.slug, filename: r.filename });
    } catch (e) {
      errEl().textContent = `${file.name}: ${e.message || e}`;
      errEl().classList.remove("hidden");
    }
  }

  const sendToTv = sheet.querySelector("#crop-send-tv").checked;
  sheet.classList.add("hidden");
  return { imported, sendToTv };
}
```

- [ ] **Step 3: Import controls in index.html (library panel header)**

In the library panel's `.panel-actions`, before the select-all button:

```html
<button class="btn btn-secondary btn-small" id="library-import">+ Import</button>
<input type="file" id="import-file-input" accept="image/*" multiple hidden />
```

- [ ] **Step 4: Wire into `js/views/tv.js`**

In `wireTvPanelButtons` add:

```javascript
  const fileInput = document.getElementById("import-file-input");
  document.getElementById("library-import").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    runImport([...fileInput.files]);
    fileInput.value = "";
  };
  const panel = document.getElementById("library-panel");
  panel.ondragover = (e) => {
    e.preventDefault();
    panel.classList.add("drop-target");
  };
  panel.ondragleave = () => panel.classList.remove("drop-target");
  panel.ondrop = (e) => {
    e.preventDefault();
    panel.classList.remove("drop-target");
    runImport([...e.dataTransfer.files]);
  };
```

And add the module-level function (imports `importWithCrop` from `../crop.js`, `tvActionError` from `../tvhealth.js`):

```javascript
async function runImport(files) {
  const { imported, sendToTv } = await importWithCrop(files);
  if (!imported.length) return;
  if (sendToTv) {
    try {
      await api.tvUpload({
        items: imported,
        matte: tvView.matte,
        matte_color: tvView.matteColor,
      });
    } catch (err) {
      alert(`Imported ${imported.length}, but TV upload failed: ${tvActionError(err)}`);
    }
    await refreshOnTv();
  }
  await refreshLibraryPanel(true);
}
```

- [ ] **Step 5: Hide Regenerate for the imported collection in `js/views/themeDetail.js`**

In `renderThemeDetail`, after the detail loads:

```javascript
  document.getElementById("detail-regenerate").classList.toggle("hidden", slug === "imported");
```

- [ ] **Step 6: Crop sheet styles in app.css**

```css
/* ---- Import crop sheet ---- */
.crop-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 16, 8, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.crop-sheet {
  background: var(--paper, #f5f1e8);
  border-radius: 10px;
  padding: 16px;
  max-width: min(920px, 94vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.crop-stage {
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: center;
}
.crop-stage img {
  max-width: 100%;
  max-height: 60vh;
  user-select: none;
  -webkit-user-drag: none;
}
.crop-rect {
  position: absolute;
  border: 2px solid #fff;
  outline: 9999px solid rgba(20, 16, 8, 0.45);
  cursor: move;
  touch-action: none;
}
.crop-handle {
  position: absolute;
  right: -10px;
  bottom: -10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #8a5a2b;
  cursor: nwse-resize;
}
.crop-bar { display: flex; justify-content: space-between; font-size: 13px; }
.crop-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.crop-error { color: #963f22; font-size: 13px; margin: 0; }
.crop-tv-toggle { font-size: 13px; }
#library-panel.drop-target { outline: 2px dashed #8a5a2b; outline-offset: -6px; }
```

- [ ] **Step 7: Verify in browser**

Run `frameforged`, open the TV screen:
- *+ Import* opens the picker; choosing a non-16:9 image shows the crop sheet with a centered 16:9 frame; drag moves it, the corner handle resizes; Import lands it in the library grid under "Imported".
- Dropping 3 files onto the library panel queues them ("1 of 3"); *Center-crop the rest* fast-forwards; *Skip* skips.
- A 16:9 image imports with no crop sheet. *Keep original* on a portrait image imports it unchanged.
- With "Send to TV after import" checked, imported images appear in the On-the-TV panel (real TV).
- Theme detail for "Imported" hides Regenerate. No console errors.

- [ ] **Step 8: Run suite and commit**

```bash
pytest && ruff check src/
git add src/frameforge/static
git commit -m "feat(frontend): drag-drop import with 16:9 crop overlay"
```

---

### Task 10: Lightbox viewer

**Files:**
- Create: `src/frameforge/static/js/lightbox.js`
- Modify: `js/views/tv.js`, `js/views/themeDetail.js`, `src/frameforge/static/app.css`

**Interfaces:**
- Consumes: nothing new from the server.
- Produces: `openLightbox(items, index)` where each item is `{src: string, caption: string, meta: string, actions: Array<{label, className?, onClick: async fn}>}`. Selection task (11) must keep tile double-click/Enter behavior pointing here.

- [ ] **Step 1: Implement `js/lightbox.js`**

```javascript
/* Full-screen image viewer: arrows/swipe navigate, Esc closes, contextual
 * actions in the footer. Build once, reuse. */
import { escapeHtml } from "./util.js";

let box = null;
let items = [];
let idx = 0;

function build() {
  box = document.createElement("div");
  box.className = "lightbox hidden";
  box.innerHTML = `
    <button class="lightbox-close" aria-label="Close">×</button>
    <button class="lightbox-nav lightbox-prev" aria-label="Previous">‹</button>
    <img class="lightbox-img" alt="" />
    <button class="lightbox-nav lightbox-next" aria-label="Next">›</button>
    <div class="lightbox-footer">
      <div class="lightbox-caption"></div>
      <div class="lightbox-meta"></div>
      <div class="lightbox-actions"></div>
    </div>`;
  document.body.appendChild(box);

  box.querySelector(".lightbox-close").onclick = close;
  box.querySelector(".lightbox-prev").onclick = () => show(idx - 1);
  box.querySelector(".lightbox-next").onclick = () => show(idx + 1);
  box.onclick = (e) => {
    if (e.target === box) close();
  };
  document.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(idx - 1);
    if (e.key === "ArrowRight") show(idx + 1);
  });
  let touchX = null;
  box.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  box.addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 48) show(idx + (dx < 0 ? 1 : -1));
    touchX = null;
  });
}

function show(i) {
  if (!items.length) return;
  idx = (i + items.length) % items.length;
  const it = items[idx];
  box.querySelector(".lightbox-img").src = it.src;
  box.querySelector(".lightbox-caption").textContent = it.caption || "";
  box.querySelector(".lightbox-meta").textContent = it.meta || "";
  const actions = box.querySelector(".lightbox-actions");
  actions.innerHTML = "";
  (it.actions || []).forEach((a) => {
    const b = document.createElement("button");
    b.className = a.className || "btn btn-secondary btn-small";
    b.textContent = a.label;
    b.onclick = async () => {
      b.disabled = true;
      try {
        await a.onClick();
      } finally {
        b.disabled = false;
      }
    };
    actions.appendChild(b);
  });
}

function close() {
  box.classList.add("hidden");
}

export function openLightbox(newItems, index = 0) {
  if (!box) build();
  items = newItems;
  box.classList.remove("hidden");
  show(index);
}
```

- [ ] **Step 2: Styles in app.css**

```css
/* ---- Lightbox ---- */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(14, 11, 6, 0.92);
  display: grid;
  grid-template-rows: 1fr auto;
  justify-items: center;
  align-items: center;
}
.lightbox-img { max-width: 92vw; max-height: 78vh; object-fit: contain; grid-row: 1; }
.lightbox-close, .lightbox-nav {
  position: absolute;
  background: none;
  border: none;
  color: #f5f1e8;
  font-size: 40px;
  cursor: pointer;
  padding: 12px 18px;
}
.lightbox-close { top: 8px; right: 12px; }
.lightbox-prev { left: 6px; top: 50%; transform: translateY(-50%); }
.lightbox-next { right: 6px; top: 50%; transform: translateY(-50%); }
.lightbox-footer {
  grid-row: 2;
  width: 100%;
  padding: 12px 20px 20px;
  color: #f5f1e8;
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.lightbox-caption { font-weight: 600; }
.lightbox-meta { opacity: 0.7; font-size: 13px; flex: 1; }
```

- [ ] **Step 3: Wire the on-TV grid (`js/views/tv.js`)**

Add a builder and call it from tile double-click (and a per-tile expand button):

```javascript
import { openLightbox } from "../lightbox.js";

function onTvLightboxItems() {
  const items = tvView.art?.items ?? [];
  return items.map((item) => ({
    src: item.matched && item.theme_slug
      ? api.imageUrl(item.theme_slug, item.filename)
      : api.thumbUrl(item.thumbnail_url),
    caption: item.matched ? `${item.theme_title} · ${item.filename}` : "Uploaded outside FrameForge",
    meta: item.is_current ? "Now showing" : (item.uploaded_at ? `Uploaded ${item.uploaded_at}` : ""),
    actions: item.is_current ? [] : [
      {
        label: "Show on TV now",
        onClick: async () => {
          await api.tvSelect({ content_id: item.content_id });
          await refreshOnTv();
        },
      },
    ],
  }));
}
```

In `onTvTileEl`, add:

```javascript
  el.ondblclick = () => {
    const i = (tvView.art?.items ?? []).findIndex((x) => x.content_id === item.content_id);
    openLightbox(onTvLightboxItems(), Math.max(0, i));
  };
```

- [ ] **Step 4: Wire the library grid (`js/views/tv.js`)**

```javascript
function libLightboxItems() {
  return tvView.libImages.map((im) => ({
    src: api.imageUrl(im.slug, im.filename),
    caption: `${im.theme_title} · ${im.filename}`,
    meta: im.on_tv ? "On the TV" : "",
    actions: im.on_tv ? [] : [
      {
        label: "Upload to TV",
        onClick: async () => {
          await api.tvUpload({
            items: [{ slug: im.slug, filename: im.filename }],
            matte: tvView.matte,
            matte_color: tvView.matteColor,
          });
          await Promise.all([refreshOnTv(), refreshLibraryPanel(false)]);
        },
      },
    ],
  }));
}
```

In `libraryTileEl`, add the matching `el.ondblclick` using the tile's index in `tvView.libImages`.

- [ ] **Step 5: Wire theme detail grids (`js/views/themeDetail.js`)**

In `imageTileEl(slug, img)`, add double-click → `openLightbox` over the detail's `images` array (src `api.imageUrl(slug, im.filename)`, caption `im.filename`, meta `im.prompt_short`, no actions).

- [ ] **Step 6: Verify in browser**

- Double-click any library tile: lightbox opens, ←/→ cycles, Esc closes.
- On-TV tiles open with the TV thumbnail when unmatched, the local full image when matched; *Show on TV now* works from the footer (real TV swaps).
- On the phone (or responsive mode): swipe navigates.

- [ ] **Step 7: Commit**

```bash
git add src/frameforge/static
git commit -m "feat(frontend): lightbox viewer with keyboard, swipe, and TV actions"
```

---

### Task 11: Finder-grade selection

Interaction model (resolves the click-vs-view ambiguity): **single click selects** (replaces selection), **⌘/Ctrl-click toggles**, **Shift-click ranges**, **double-click / Enter opens the lightbox**. On touch: tap opens the lightbox; **long-press (500 ms)** enters selection mode, then taps toggle. The corner `sel-box` always toggles just that tile.

**Files:**
- Create: `src/frameforge/static/js/selection.js`
- Modify: `js/views/tv.js`, `src/frameforge/static/index.html`, `src/frameforge/static/app.css`

**Interfaces:**
- Consumes: existing `tvView.selOnTv` / `tvView.selLib` Sets (kept as the storage; `GridSelection` wraps them).
- Produces: `js/selection.js` exports `class GridSelection { constructor({set, onChange}); setOrder(keys); click(key, ev); toggle(key); rangeTo(key); selectAll(keys); clear(); enterTouchMode(); inTouchMode; }` plus `attachTilePointerHandlers(el, key, sel, openViewer)`.

- [ ] **Step 1: Implement `js/selection.js`**

```javascript
/* Finder-style selection over a grid. The backing store is a caller-owned
 * Set (tvView.selOnTv / tvView.selLib) so existing bulk actions keep working. */

export class GridSelection {
  constructor({ set, onChange }) {
    this.set = set;
    this.onChange = onChange;
    this.order = [];
    this.anchor = null;
    this.inTouchMode = false;
  }

  setOrder(keys) {
    this.order = keys;
    if (this.anchor && !keys.includes(this.anchor)) this.anchor = null;
  }

  click(key, ev) {
    if (ev.shiftKey && this.anchor) {
      this.rangeTo(key);
    } else if (ev.metaKey || ev.ctrlKey || this.inTouchMode) {
      this.toggle(key);
    } else {
      this.set.clear();
      this.set.add(key);
      this.anchor = key;
    }
    this.onChange();
  }

  toggle(key) {
    if (this.set.has(key)) this.set.delete(key);
    else {
      this.set.add(key);
      this.anchor = key;
    }
    this.onChange();
  }

  rangeTo(key) {
    const a = this.order.indexOf(this.anchor);
    const b = this.order.indexOf(key);
    if (a === -1 || b === -1) return this.toggle(key);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.set.add(this.order[i]);
    this.onChange();
  }

  selectAll(keys) {
    keys.forEach((k) => this.set.add(k));
    this.onChange();
  }

  clear() {
    this.set.clear();
    this.anchor = null;
    this.inTouchMode = false;
    this.onChange();
  }

  enterTouchMode() {
    this.inTouchMode = true;
  }
}

const LONG_PRESS_MS = 500;

/* Tile wiring: click/⌘/shift select, dblclick or Enter opens, long-press
 * enters touch selection mode. */
export function attachTilePointerHandlers(el, key, sel, openViewer) {
  el.tabIndex = 0;
  let pressTimer = null;
  let longPressed = false;

  el.onclick = (e) => {
    if (e.target.closest("[data-act]")) return;
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (e.target.closest(".sel-box")) {
      sel.toggle(key);
      return;
    }
    if (sel.inTouchMode || e.pointerType !== "touch") {
      sel.click(key, e);
    } else {
      openViewer(); // touch tap outside selection mode = view
    }
  };
  el.ondblclick = (e) => {
    if (e.target.closest("[data-act]")) return;
    openViewer();
  };
  el.onkeydown = (e) => {
    if (e.key === "Enter") openViewer();
    if (e.key === " ") {
      e.preventDefault();
      sel.toggle(key);
    }
  };
  el.onpointerdown = (e) => {
    if (e.pointerType !== "touch") return;
    pressTimer = setTimeout(() => {
      longPressed = true;
      sel.enterTouchMode();
      sel.toggle(key);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressTimer);
  el.onpointerup = cancelPress;
  el.onpointermove = cancelPress;
  el.onpointercancel = cancelPress;
}
```

Note: `el.onclick` receives a `PointerEvent` in all supported browsers, so `e.pointerType` distinguishes touch; where it's undefined (older Safari), the code treats it as mouse — acceptable.

- [ ] **Step 2: Selection toolbars in index.html**

Add inside each panel, directly under `.panel-header`:

```html
<div class="selection-bar hidden" id="on-tv-selection-bar">
  <span id="on-tv-selection-count"></span>
  <button class="btn btn-ghost btn-small" id="on-tv-clear-sel">Clear</button>
</div>
```

```html
<div class="selection-bar hidden" id="library-selection-bar">
  <span id="library-selection-count"></span>
  <button class="btn btn-ghost btn-small" id="library-clear-sel">Clear</button>
</div>
```

CSS:

```css
.selection-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  font-size: 13px;
  background: rgba(138, 90, 43, 0.08);
  border-radius: 6px;
  margin-bottom: 8px;
}
```

- [ ] **Step 3: Rewire `js/views/tv.js` tiles through GridSelection**

At module level:

```javascript
import { GridSelection, attachTilePointerHandlers } from "../selection.js";

const onTvSel = new GridSelection({ set: null, onChange: () => syncSelectionUi("on-tv") });
const libSel = new GridSelection({ set: null, onChange: () => syncSelectionUi("library") });
```

In `renderTV`, after clearing the Sets: `onTvSel.set = tvView.selOnTv; libSel.set = tvView.selLib;`

Replace `onTvTileEl`'s manual `el.onclick` selection block with:

```javascript
  attachTilePointerHandlers(el, item.content_id, onTvSel, () => {
    const i = (tvView.art?.items ?? []).findIndex((x) => x.content_id === item.content_id);
    openLightbox(onTvLightboxItems(), Math.max(0, i));
  });
```

Same in `libraryTileEl` for selectable (not on-TV) tiles with `libSel` and the key `` `${im.slug}/${im.filename}` ``. Remove the old `el.ondblclick` lines from Task 10 (superseded by `attachTilePointerHandlers`).

In `renderOnTvGrid` add `onTvSel.setOrder(art.items.map((i) => i.content_id))` and a re-sync of each tile's `.selected` class; in `renderLibraryGrid` add `libSel.setOrder(...)` over selectable keys. Select-all buttons call `onTvSel.selectAll(...)` / `libSel.selectAll(...)`; clear buttons call `.clear()`.

Add `syncSelectionUi(panel)`:

```javascript
function syncSelectionUi(panel) {
  const sel = panel === "on-tv" ? tvView.selOnTv : tvView.selLib;
  const bar = document.getElementById(`${panel}-selection-bar`);
  const count = document.getElementById(`${panel}-selection-count`);
  bar.classList.toggle("hidden", sel.size === 0);
  count.textContent = `${sel.size} selected`;
  document
    .querySelectorAll(`#${panel === "on-tv" ? "on-tv-grid" : "library-grid"} .art-tile`)
    .forEach((el) => el.classList.toggle("selected", sel.has(el.dataset.key)));
  updateTvActionButtons();
}
```

(Set `el.dataset.key = <key>` in both tile builders. Wire `on-tv-clear-sel` / `library-clear-sel` in `wireTvPanelButtons`.)

- [ ] **Step 4: Verify in browser**

- Desktop: click selects one; ⌘-click builds a set; shift-click selects a range; space toggles; Enter opens lightbox; double-click opens lightbox; selection bar shows count; bulk Upload/Remove act on the selection.
- Touch (responsive mode/phone): tap opens lightbox; long-press vibrates and enters selection mode; subsequent taps toggle; Clear exits selection mode.

- [ ] **Step 5: Commit**

```bash
git add src/frameforge/static
git commit -m "feat(frontend): Finder-grade selection — ranges, toggles, long-press touch mode"
```

---

### Task 12: Sort, filter, and search

**Files:**
- Modify: `src/frameforge/static/index.html`, `js/views/tv.js`, `src/frameforge/static/app.css`

**Interfaces:**
- Consumes: `tvView.art.items` (fields `content_id, matched, filename, uploaded_at, image_date`) and `tvView.libImages` (fields `slug, theme_title, filename, on_tv`); extend the `refreshLibraryPanel` mapping with `prompt: im.prompt_short` so search can cover prompts.
- Produces: view-state keys `tvView.onTvSort`, `tvView.onTvFilter`, `tvView.libSort`, `tvView.libSearch` (defaults `"newest"`, `"all"`, `"newest"`, `""`).

- [ ] **Step 1: Controls in index.html**

On-TV panel header, before the existing actions:

```html
<select class="panel-filter" id="on-tv-sort" aria-label="Sort">
  <option value="newest">Newest first</option>
  <option value="oldest">Oldest first</option>
  <option value="name">By name</option>
</select>
<select class="panel-filter" id="on-tv-filter" aria-label="Filter">
  <option value="all">All</option>
  <option value="matched">From my library</option>
  <option value="unknown">Other sources</option>
</select>
```

Library panel header, after the theme filter:

```html
<select class="panel-filter" id="library-sort" aria-label="Sort">
  <option value="newest">Newest first</option>
  <option value="oldest">Oldest first</option>
  <option value="name">By name</option>
</select>
<input type="search" class="panel-search" id="library-search" placeholder="Search" aria-label="Search library" />
```

CSS: `.panel-search { font: inherit; padding: 4px 8px; border: 1px solid var(--line, #d8d2c4); border-radius: 6px; max-width: 140px; }`

- [ ] **Step 2: State + helpers in `js/views/tv.js`**

Add to `tvView` defaults: `onTvSort: "newest", onTvFilter: "all", libSort: "newest", libSearch: ""`.

```javascript
function applySort(items, mode, dateOf, nameOf) {
  const arr = [...items];
  if (mode === "name") arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  else {
    arr.sort((a, b) => (dateOf(a) || "").localeCompare(dateOf(b) || ""));
    if (mode === "newest") arr.reverse();
  }
  return arr;
}
```

In `renderOnTvGrid`, before building tiles:

```javascript
  let items = art.items;
  if (tvView.onTvFilter !== "all") {
    items = items.filter((i) => (tvView.onTvFilter === "matched") === i.matched);
  }
  items = applySort(
    items,
    tvView.onTvSort,
    (i) => i.uploaded_at || i.image_date || "",
    (i) => i.filename || i.content_id,
  );
```

(and build tiles/`setOrder` from this `items` array.)

In `renderLibraryGrid`:

```javascript
  let images = tvView.libImages;
  const q = tvView.libSearch.trim().toLowerCase();
  if (q) {
    images = images.filter((im) =>
      [im.filename, im.theme_title, im.prompt || ""].some((s) => s.toLowerCase().includes(q)),
    );
  }
  images = applySort(images, tvView.libSort, (im) => im.filename, (im) => im.filename);
```

(Generated filenames are `img_NNNN` so name and generation order coincide; `newest`/`oldest` reverse or keep that order within a theme.)

Wire in `wireTvPanelButtons`:

```javascript
  const bind = (id, key, rerender) => {
    const el = document.getElementById(id);
    el.value = tvView[key];
    el.oninput = () => {
      tvView[key] = el.value;
      rerender();
    };
  };
  bind("on-tv-sort", "onTvSort", renderOnTvGrid);
  bind("on-tv-filter", "onTvFilter", renderOnTvGrid);
  bind("library-sort", "libSort", renderLibraryGrid);
  bind("library-search", "libSearch", renderLibraryGrid);
```

- [ ] **Step 3: Verify in browser**

- On-TV: filter *Other sources* shows only unmatched art; sort flips order.
- Library: search narrows as you type (matches prompt text too); sort works; selection survives re-render only for still-visible tiles (acceptable).

- [ ] **Step 4: Commit**

```bash
git add src/frameforge/static
git commit -m "feat(frontend): sort, filter, and search on the TV screen panels"
```

---

### Task 13: Now-showing treatment

**Files:**
- Modify: `js/views/tv.js`, `src/frameforge/static/index.html`, `src/frameforge/static/app.css`

**Interfaces:**
- Consumes: `art.current_content_id` and `item.is_current` (already provided by `/api/tv/art`); the "NOW SHOWING" badge already renders in `onTvTileEl`.
- Produces: current art pinned first + a now-showing strip.

- [ ] **Step 1: Strip markup in index.html (above `#on-tv-grid`)**

```html
<p class="now-showing-strip hidden" id="now-showing-strip"></p>
```

CSS:

```css
.now-showing-strip {
  font-size: 13px;
  margin: 0 0 8px;
  padding: 6px 10px;
  background: rgba(123, 160, 91, 0.12);
  border-left: 3px solid #7ba05b;
  cursor: pointer;
}
```

- [ ] **Step 2: Pin + strip in `renderOnTvGrid` (`js/views/tv.js`)**

After the Task 12 filter/sort block:

```javascript
  items = [...items].sort((a, b) => Number(b.is_current) - Number(a.is_current));

  const strip = document.getElementById("now-showing-strip");
  const current = (art.items || []).find((i) => i.is_current);
  strip.classList.toggle("hidden", !current);
  if (current) {
    const label = current.matched
      ? `${current.theme_title} · ${current.filename}`
      : "art uploaded outside FrameForge";
    strip.textContent = `Now on the wall: ${label}`;
    strip.onclick = () => {
      const el = document.querySelector(`#on-tv-grid .art-tile[data-key="${current.content_id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  }
```

(The pin sort is stable, so it composes with Task 12's ordering. `refreshOnTv` already re-fetches after *Show now*, so the badge and strip follow reality rather than assumption.)

- [ ] **Step 3: Verify in browser (real TV)**

- The current artwork sits first with its badge; the strip names it; clicking the strip scrolls to it.
- *Show now* on another piece: after the refresh, pin + badge + strip all move to it.

- [ ] **Step 4: Commit**

```bash
git add src/frameforge/static
git commit -m "feat(frontend): pin and announce the artwork now showing on the wall"
```

---

### Task 14: Docs, WIRING contract, and final validation

**Files:**
- Modify: `README.md`, `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/WIRING.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–13.
- Produces: docs matching reality; a recorded full pass of the validation checklist.

- [ ] **Step 1: Update WIRING.md**

Add the two new endpoints with request/response shapes exactly as implemented: `POST /api/imports` (multipart fields, success shape, 400/413 cases) and `POST /api/imports/{filename}/recrop` (JSON body, 404/400 cases). Note that `imported` is a reserved theme slug.

- [ ] **Step 2: Update README.md and USER_GUIDE.md**

- README: extend "Managing what's on the TV" with a short *Importing your own images* paragraph (drag-drop or + Import, 16:9 crop sheet, originals kept in `imported/originals/`, send-to-TV toggle) and mention `frameforge doctor` under Development or a new Troubleshooting pointer.
- USER_GUIDE: document the import flow, lightbox (double-click/Enter, arrows, swipe), selection model (click/⌘/shift; long-press on touch), sort/filter/search controls, now-showing strip, TV health chip, and the unreachable-TV recovery card.

- [ ] **Step 3: Update TROUBLESHOOTING.md**

Add: `frameforge doctor` usage and reading its output; "TV IP changed" → *Find my TV again*; import errors (413 cap, unreadable file).

- [ ] **Step 4: Full automated pass**

Run: `pytest -v && ruff check src/`
Expected: every test passes (existing + doctor + imports + endpoint suites), lint clean.

- [ ] **Step 5: Real-TV end-to-end pass**

With the real Frame on:

1. `frameforge doctor` → all steps ✓.
2. In the UI: import a non-16:9 image with the crop sheet, "Send to TV" checked → it appears in the On-the-TV panel and (via lightbox → *Show on TV now*) on the wall.
3. Remove it from the TV via selection + *Remove from TV* → gone from the panel and the wall.
4. Recrop path: none in UI yet beyond API (by design — UI recrop is future); confirm `POST /api/imports/<file>/recrop` via curl if desired.

- [ ] **Step 6: iPhone PWA pass**

From the phone (server bound to LAN with token, per README):
- Crop sheet: drag and resize with touch.
- Long-press selection; tap-to-view lightbox; swipe navigation.
- TV chip states render; Add to Home Screen still works.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/
git commit -m "docs: imports, doctor, and TV-screen browser UX"
```

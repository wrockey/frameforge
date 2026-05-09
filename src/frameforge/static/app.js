/* FrameForge frontend — vanilla JS, hash-routed, mock-first.
 * ---------------------------------------------------------------------------
 * Toggle USE_MOCK to false once the server is reachable and the visuals match
 * Claude Design. Each api.* method maps 1:1 to an endpoint in WIRING.md.
 */

const USE_MOCK = false;
const API_BASE = "http://localhost:8765";
const WS_URL = "ws://localhost:8765/ws/status";

/* ===========================================================================
 * MOCK_DATA
 * Shapes mirror the Pydantic models in server.py. Keep these in sync if the
 * server contract changes.
 * ========================================================================= */

const SAMPLE_PROMPTS = [
  "A weathered ranger reads by lantern-light at the mouth of a slot canyon, ochre dust hanging in the beam, late-Hokusai composition, cool indigo shadows.",
  "A brass diving bell descending into a kelp forest at golden hour, bioluminescent shoals threading the columns, rendered like a 1970s science encyclopedia plate.",
  "Sunrise over a derelict carnival in the high desert, tilt-a-whirl scaffolding catching pink light, foreground sage in soft focus, painterly brushwork.",
  "A cartographer's tower at the edge of a frozen lake, candle-warmth in every window, aurora threading low above pine — vertical Japanese woodblock palette.",
  "Pulp paperback cover: lone aviator silhouetted in a hangar mouth, prop-wash kicking up ribbons of dust, ivory overcast, 1947 magazine print stock.",
  "An overgrown observatory dome cracked open like a fruit, stargazer's ladder ascending into Milky Way, mossy verdigris on the copper, twilight blues.",
  "Festival night in a fishing village, paper lanterns reflected in still harbor water, vendors threading the wharf, watercolor wash with ink-line accents.",
  "Foreground figure crossing a swing-bridge over a chasm of cloud, pack-mule trailing, peach dawn breaking through the mist, Maxfield Parrish luminance.",
  "A clockwork lighthouse at dusk, gears visible behind storm-glass, beam carving across a violet sea, oil-on-board with deep impasto highlights.",
  "Late-summer wheat field bisected by a dirt road, lone diner glowing at the horizon, contrails drawing chalk lines on a peach sky.",
  "Antique brass diving suit standing sentinel on a coral terrace, schools of fish in the blue distance, painted as a scientific illustration plate.",
  "A heron at the edge of a misted pond, dawn just breaking, single brushstroke composition over warm rice paper.",
];

function makePlaceholderSvg(seed, hue) {
  // Deterministic, mock-only image stand-in. Real images come from
  // /api/themes/{slug}/images/{filename} when USE_MOCK=false.
  const h2 = (hue + 30) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
    `<defs><linearGradient id="g${seed}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue},36%,62%)"/>` +
    `<stop offset="100%" stop-color="hsl(${h2},48%,28%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#g${seed})"/>` +
    `<circle cx="${80 + (seed % 8) * 20}" cy="${50 + (seed % 5) * 14}" r="22" fill="rgba(255,255,255,0.35)"/>` +
    `<text x="14" y="170" font-family="ui-monospace,monospace" font-size="11" fill="rgba(255,255,255,0.7)">img_${String(seed).padStart(4, "0")}</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const MOCK_DATA = {
  health: { ok: true, version: "0.1.0" },

  discover: [
    {
      host: "192.168.1.74",
      model_name: "QN65LS03DAFXZA",
      mac: "9C:8C:CD:12:34:56",
      is_frame: true,
    },
    {
      host: "192.168.1.211",
      model_name: "UN50CU7000FXZA",
      mac: "78:BD:BC:AB:CD:EF",
      is_frame: false,
    },
  ],

  themes: [
    {
      slug: "vintage_pulp_fantasy",
      title: "vintage pulp fantasy",
      image_count: 30,
      last_refreshed: "2026-05-07T03:14:22Z",
      size_mb: 84.2,
      image_model: "grok-imagine-image-quality",
      state: "on_tv",
      preview_filenames: [
        "img_0001.png",
        "img_0009.png",
        "img_0017.png",
        "img_0024.png",
      ],
    },
    {
      slug: "studio_ghibli_skies",
      title: "studio ghibli skies",
      image_count: 30,
      last_refreshed: "2026-05-04T12:02:00Z",
      size_mb: 76.8,
      image_model: "grok-imagine-image-quality",
      state: "idle",
      preview_filenames: [
        "img_0002.png",
        "img_0006.png",
        "img_0014.png",
        "img_0028.png",
      ],
    },
    {
      slug: "mid_century_observatory",
      title: "mid-century observatory",
      image_count: 12,
      last_refreshed: "2026-05-09T01:48:11Z",
      size_mb: 28.4,
      image_model: "grok-imagine-image-quality",
      state: "generating",
      preview_filenames: [
        "img_0001.png",
        "img_0004.png",
        "img_0008.png",
        "img_0011.png",
      ],
    },
  ],

  // Built lazily by mockApi.themeDetail
  themeDetail(slug) {
    const theme = MOCK_DATA.themes.find((t) => t.slug === slug);
    if (!theme) return null;
    const hue = { vintage_pulp_fantasy: 28, studio_ghibli_skies: 200, mid_century_observatory: 260 }[slug] ?? 180;
    const images = Array.from({ length: theme.image_count }, (_, i) => ({
      filename: `img_${String(i + 1).padStart(4, "0")}.png`,
      prompt_short: SAMPLE_PROMPTS[i % SAMPLE_PROMPTS.length].split(" ").slice(0, 6).join(" ") + "…",
      on_tv: theme.state === "on_tv" && i < 24,
      _hue: hue,
      _seed: i + 1,
    }));
    return {
      slug: theme.slug,
      title: theme.title,
      image_count: theme.image_count,
      last_refreshed: theme.last_refreshed,
      size_mb: theme.size_mb,
      image_model: theme.image_model,
      version_pin: "0.1.0",
      state: theme.state,
      expansion: {
        theme: theme.title,
        seed: "a91c4f7e3b22",
        count: theme.image_count,
        prompts: Array.from({ length: theme.image_count }, (_, i) => SAMPLE_PROMPTS[i % SAMPLE_PROMPTS.length]),
        text_model: "grok-4.3",
        generated_at: theme.last_refreshed,
        frameforge_version: "0.1.0",
      },
      images,
    };
  },

  inspect(slug, filename) {
    const detail = MOCK_DATA.themeDetail(slug);
    if (!detail) return null;
    const idx = detail.images.findIndex((im) => im.filename === filename);
    const tile = detail.images[idx];
    const fullPrompt = detail.expansion.prompts[idx] || SAMPLE_PROMPTS[0];
    return {
      filename,
      prompt: fullPrompt,
      sidecar: {
        filename,
        theme: detail.title,
        prompt: fullPrompt,
        expansion_seed: detail.expansion.seed,
        expansion_index: idx,
        image_model: "grok-imagine-image-quality",
        text_model_for_expansion: "grok-4.3",
        provider: "xai",
        resolution: "2k",
        aspect_ratio: "16:9",
        generated_at: detail.last_refreshed,
        frameforge_version: "0.1.0",
      },
      on_tv: tile?.on_tv ?? false,
      regen_count: 0,
      _hue: tile?._hue ?? 180,
      _seed: tile?._seed ?? 1,
    };
  },

  tvStatus: {
    connected: true,
    host: "192.168.1.74",
    model_name: "QN65LS03DAFXZA",
    mac: "9C:8C:CD:12:34:56",
    art_mode: "on",
    last_seen: "2026-05-09T13:42:05Z",
    images_on_tv: 24,
    storage_cap: 80,
  },

  settings: {
    image_model: "grok-imagine-image-quality",
    text_model: "grok-4.3",
    resolution: "2k",
    aspect_ratio: "16:9",
    target_count: 30,
    pin_versions: false,
    save_provenance: true,
  },

  schedules: [
    {
      id: "sch_001",
      theme_slug: "vintage_pulp_fantasy",
      theme_title: "vintage pulp fantasy",
      cron: "0 3 * * 0",
      next_run: "2026-05-10T03:00:00Z",
      enabled: true,
    },
    {
      id: "sch_002",
      theme_slug: "studio_ghibli_skies",
      theme_title: "studio ghibli skies",
      cron: "0 6 * * 3",
      next_run: "2026-05-13T06:00:00Z",
      enabled: true,
    },
    {
      id: "sch_003",
      theme_slug: "mid_century_observatory",
      theme_title: "mid-century observatory",
      cron: "0 22 * * 5",
      next_run: "2026-05-15T22:00:00Z",
      enabled: false,
    },
  ],
};

/* ===========================================================================
 * API wrapper
 * Each method returns a Promise. Mock branch returns canned data after a tiny
 * delay; live branch fetches the WIRING.md endpoints.
 * ========================================================================= */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mockApi = {
  async health() {
    await wait(40);
    return MOCK_DATA.health;
  },
  async discover() {
    await wait(900);
    return MOCK_DATA.discover;
  },
  async themes() {
    await wait(80);
    return MOCK_DATA.themes;
  },
  async themeDetail(slug, withExpansion = false) {
    await wait(80);
    const d = MOCK_DATA.themeDetail(slug);
    if (!d) throw new Error("not found");
    if (!withExpansion) return { ...d, expansion: null };
    return d;
  },
  async inspect(slug, filename) {
    await wait(60);
    const i = MOCK_DATA.inspect(slug, filename);
    if (!i) throw new Error("not found");
    return i;
  },
  async tvStatus() {
    await wait(80);
    return MOCK_DATA.tvStatus;
  },
  async settings() {
    await wait(40);
    return MOCK_DATA.settings;
  },
  async schedules() {
    await wait(60);
    return MOCK_DATA.schedules;
  },
  async generate(slug, body) {
    await wait(60);
    return { started: true, theme: body.theme, slug };
  },
  async push(slug, body) {
    await wait(60);
    return { started: true };
  },
  async testKey(_key) {
    await wait(500);
    return { ok: true };
  },
  imageUrl(slug, filename) {
    // For mocks, generate a deterministic placeholder. Live impl returns
    // /api/themes/{slug}/images/{filename}.
    const detail = MOCK_DATA.themeDetail(slug);
    const tile = detail?.images.find((im) => im.filename === filename);
    return makePlaceholderSvg(tile?._seed ?? 1, tile?._hue ?? 180);
  },
};

const liveApi = {
  health: () => fetch(`${API_BASE}/api/health`).then((r) => r.json()),
  discover: () => fetch(`${API_BASE}/api/discover`).then((r) => r.json()),
  themes: () => fetch(`${API_BASE}/api/themes`).then((r) => r.json()),
  themeDetail: (slug, withExpansion = false) =>
    fetch(`${API_BASE}/api/themes/${slug}?with_expansion=${withExpansion}`).then((r) => r.json()),
  inspect: (slug, filename) =>
    fetch(`${API_BASE}/api/themes/${slug}/images/${filename}/inspect`).then((r) => r.json()),
  tvStatus: () => fetch(`${API_BASE}/api/tv/status`).then((r) => r.json()),
  settings: () => fetch(`${API_BASE}/api/settings`).then((r) => r.json()),
  schedules: () => fetch(`${API_BASE}/api/schedules`).then((r) => r.json()),
  generate: (slug, body) =>
    fetch(`${API_BASE}/api/themes/${slug}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  push: (slug, body) =>
    fetch(`${API_BASE}/api/themes/${slug}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
  testKey: (key) =>
    fetch(`${API_BASE}/api/settings/test-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }).then((r) => r.json()),
  imageUrl: (slug, filename) => `${API_BASE}/api/themes/${slug}/images/${filename}`,
};

const api = USE_MOCK ? mockApi : liveApi;

/* ===========================================================================
 * Status chip + WebSocket
 * ========================================================================= */

const STATUS_LABELS = {
  idle: "Idle",
  expanding: "Expanding…",
  uploading: "Uploading to TV…",
  error: "Error: see Settings",
};

const statusHistory = [];
const STATUS_HISTORY_MAX = 12;

function renderStatus(payload) {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  dot.dataset.state = payload.state;
  if (payload.state === "generating" && payload.total != null) {
    label.textContent = `Generating ${payload.done} of ${payload.total}…`;
  } else {
    label.textContent = STATUS_LABELS[payload.state] || payload.state;
  }

  statusHistory.unshift({ at: new Date().toLocaleTimeString(), payload });
  if (statusHistory.length > STATUS_HISTORY_MAX) statusHistory.pop();
  const ul = document.getElementById("status-history");
  ul.innerHTML = statusHistory
    .map((h) => {
      const json = JSON.stringify(h.payload);
      return `<li><span style="color:var(--ink-30)">${h.at}</span> ${escapeHtml(json)}</li>`;
    })
    .join("");
}

function connectStatusWS() {
  if (USE_MOCK) {
    // Demo cycle so the chip isn't dead during visual review.
    renderStatus({ state: "idle" });
    let step = 0;
    const cycle = () => {
      const seq = [
        { state: "idle" },
        { state: "expanding", theme_slug: "vintage_pulp_fantasy" },
        { state: "generating", theme_slug: "vintage_pulp_fantasy", done: 7, total: 30 },
        { state: "generating", theme_slug: "vintage_pulp_fantasy", done: 14, total: 30 },
        { state: "uploading", theme_slug: "vintage_pulp_fantasy" },
        { state: "idle" },
      ];
      renderStatus(seq[step % seq.length]);
      step += 1;
    };
    cycle();
    setInterval(cycle, 8000);
    return;
  }

  let ws;
  const open = () => {
    ws = new WebSocket(WS_URL);
    ws.onmessage = (e) => {
      try {
        renderStatus(JSON.parse(e.data));
      } catch (_) {}
    };
    ws.onclose = () => setTimeout(open, 2000);
    ws.onerror = () => ws.close();
  };
  open();
}

document.getElementById("status-chip").addEventListener("click", () => {
  document.getElementById("status-popover").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  const popover = document.getElementById("status-popover");
  const chip = document.getElementById("status-chip");
  if (!popover.contains(e.target) && !chip.contains(e.target)) {
    popover.classList.add("hidden");
  }
});

/* ===========================================================================
 * Hash router
 *   #/onboarding    → multi-step welcome flow
 *   #/themes        → grid (default)
 *   #/themes/:slug  → detail
 *   #/tv #/schedule #/settings
 * ========================================================================= */

const routes = {
  onboarding: () => showRoute("onboarding") || enterOnboarding(),
  themes: () => showRoute("themes") || renderThemes(),
  "theme-detail": (slug) => showRoute("theme-detail") || renderThemeDetail(slug),
  tv: () => showRoute("tv") || renderTV(),
  schedule: () => showRoute("schedule") || renderSchedule(),
  settings: () => showRoute("settings") || renderSettings(),
};

function showRoute(name) {
  document.querySelectorAll(".route").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.route !== name);
  });
  document.querySelectorAll(".primary-nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
  document.getElementById("inspect-sheet").classList.add("hidden");
  // Returning falsy so the route handler proceeds to render
  return false;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h) return { name: "themes" };
  if (h.startsWith("onboarding")) return { name: "onboarding" };
  const parts = h.split("/");
  if (parts[0] === "themes" && parts[1]) return { name: "theme-detail", slug: parts[1] };
  if (parts[0] === "themes") return { name: "themes" };
  return { name: parts[0] };
}

function navigate() {
  const { name, slug } = parseHash();
  const handler = routes[name];
  if (handler) handler(slug);
  else routes.themes();
}

window.addEventListener("hashchange", navigate);

/* ===========================================================================
 * Onboarding
 * ========================================================================= */

let onboardingStep = 1;
let chosenTV = null;

function enterOnboarding() {
  onboardingStep = 1;
  showOnboardingStep(1);
}

function showOnboardingStep(n) {
  onboardingStep = n;
  document.querySelectorAll("[data-step-pane]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.stepPane !== String(n));
  });
  document.querySelectorAll("#onboarding-steps li").forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle("active", step === n);
    li.classList.toggle("done", step < n);
  });
  if (n === 2) runDiscover();
  if (n === 3) runPairCountdown();
}

document.querySelectorAll("[data-onboarding-next]").forEach((b) =>
  b.addEventListener("click", () => showOnboardingStep(onboardingStep + 1)),
);
document.querySelectorAll("[data-onboarding-back]").forEach((b) =>
  b.addEventListener("click", () => showOnboardingStep(onboardingStep - 1)),
);

async function runDiscover() {
  const scanner = document.getElementById("discover-scanner");
  const results = document.getElementById("discover-results");
  const confirm = document.getElementById("discover-confirm");
  scanner.classList.remove("hidden");
  results.classList.add("hidden");
  confirm.classList.add("hidden");
  results.innerHTML = "";
  const tvs = await api.discover();
  scanner.classList.add("hidden");
  results.classList.remove("hidden");
  const frame = tvs.find((t) => t.is_frame);
  if (frame) {
    chosenTV = frame;
    confirm.classList.remove("hidden");
    results.innerHTML = `
      <div class="discovered-tv selected">
        <div>
          <div class="tv-frame-marker">FRAME · LS03</div>
          <div class="tv-model">${escapeHtml(frame.model_name)}</div>
          <div class="tv-meta">${frame.host} · MAC ${frame.mac}</div>
        </div>
      </div>
    `;
  } else if (tvs.length) {
    results.innerHTML = `<p class="onboarding-meta">Found ${tvs.length} Samsung TV(s), but no Frame.</p>`;
  } else {
    results.innerHTML = `<p class="onboarding-meta">Nothing on the network. Try Search again, or enter the IP manually.</p>`;
  }
}

document.getElementById("discover-rescan").addEventListener("click", runDiscover);
document.getElementById("discover-manual").addEventListener("click", () => {
  document.getElementById("manual-ip").classList.toggle("hidden");
});
document.getElementById("manual-ip-go").addEventListener("click", () => {
  const v = document.getElementById("manual-ip-input").value.trim();
  if (!v) return;
  chosenTV = { host: v, model_name: "(manual)", mac: "", is_frame: true };
  showOnboardingStep(3);
});
document.getElementById("discover-confirm").addEventListener("click", () => showOnboardingStep(3));

function runPairCountdown() {
  const ring = document.getElementById("pair-ring");
  const text = document.getElementById("pair-countdown-text");
  const status = document.getElementById("pair-status");
  const cont = document.getElementById("pair-continue");
  let t = 30;
  text.textContent = t;
  cont.classList.add("hidden");
  status.textContent = "Waiting for confirmation on the TV…";
  const tick = setInterval(() => {
    t -= 1;
    text.textContent = t;
    if (t === 18) {
      // pretend the TV accepted
      status.textContent = "Paired. Token saved.";
      cont.classList.remove("hidden");
    }
    if (t <= 0) {
      clearInterval(tick);
      status.textContent = "Timed out. Try again from your TV remote.";
    }
  }, 1000);
  cont.onclick = () => {
    clearInterval(tick);
    showOnboardingStep(4);
  };
}

document.getElementById("key-toggle").addEventListener("click", () => {
  const inp = document.getElementById("api-key");
  const btn = document.getElementById("key-toggle");
  if (inp.type === "password") {
    inp.type = "text";
    btn.textContent = "hide";
  } else {
    inp.type = "password";
    btn.textContent = "show";
  }
});

document.getElementById("key-test").addEventListener("click", async () => {
  const result = document.getElementById("key-result");
  const key = document.getElementById("api-key").value.trim();
  if (!key) {
    result.textContent = "Paste a key first.";
    result.className = "key-result err";
    return;
  }
  result.textContent = "Testing…";
  result.className = "key-result";
  const r = await api.testKey(key);
  if (r.ok) {
    result.textContent = "Connection OK.";
    result.className = "key-result ok";
  } else {
    result.textContent = `Failed: ${r.message || "unknown error"}`;
    result.className = "key-result err";
  }
});

document.getElementById("key-finish").addEventListener("click", () => {
  location.hash = "#/themes";
});

/* ===========================================================================
 * Themes screen
 * ========================================================================= */

async function renderThemes() {
  const grid = document.getElementById("theme-grid");
  const empty = document.getElementById("theme-empty");
  grid.innerHTML = "";
  const themes = await api.themes();
  if (!themes.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  themes.forEach((t) => grid.appendChild(themeCardEl(t)));
}

function themeCardEl(t) {
  const el = document.createElement("article");
  el.className = "theme-card";
  el.onclick = (e) => {
    if (e.target.closest(".theme-card-toolbar")) return;
    location.hash = `#/themes/${t.slug}`;
  };
  const previews = (t.preview_filenames || []).slice(0, 4);
  while (previews.length < 4) previews.push(previews[0] || "img_0001.png");
  const lastRefreshed = relativeTime(t.last_refreshed);
  const stateLabel = t.state === "on_tv" ? "ON TV" : t.state === "generating" ? "GENERATING…" : "";
  const stateClass = t.state === "on_tv" ? "pill-on-tv" : t.state === "generating" ? "pill-generating" : "";
  el.innerHTML = `
    <div class="theme-mosaic">
      ${previews.map((f) => `<div style="background-image:url('${api.imageUrl(t.slug, f)}')"></div>`).join("")}
    </div>
    <div class="theme-card-body">
      <h3 class="theme-card-title">${escapeHtml(t.title)}</h3>
      <div class="theme-card-meta">${t.image_count} images · refreshed ${lastRefreshed}</div>
    </div>
    ${stateLabel ? `<span class="pill ${stateClass} pill-state">${stateLabel}</span>` : ""}
    <div class="theme-card-toolbar">
      <button title="Push to TV" data-act="push">↑</button>
      <button title="Regenerate" data-act="regen">↻</button>
      <button title="Edit" data-act="edit">✎</button>
    </div>
  `;
  el.querySelector('[data-act="push"]').onclick = (e) => {
    e.stopPropagation();
    api.push(t.slug, { minutes: 30, matte: "shadowbox", matte_color: "polar" });
  };
  el.querySelector('[data-act="regen"]').onclick = (e) => {
    e.stopPropagation();
    api.generate(t.slug, { theme: t.title });
  };
  return el;
}

document.getElementById("new-theme").addEventListener("click", () => {
  document.getElementById("new-theme-sheet").classList.remove("hidden");
});
document.getElementById("new-theme-cancel").addEventListener("click", () => {
  document.getElementById("new-theme-sheet").classList.add("hidden");
});
document.getElementById("new-theme-count").addEventListener("input", (e) => {
  document.getElementById("new-theme-count-display").textContent = e.target.value;
});
document.getElementById("new-theme-go").addEventListener("click", async () => {
  const theme = document.getElementById("new-theme-input").value.trim();
  const count = Number(document.getElementById("new-theme-count").value);
  if (!theme) return;
  const slug = theme.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  await api.generate(slug, { theme, count });
  document.getElementById("new-theme-sheet").classList.add("hidden");
});

/* ===========================================================================
 * Theme detail
 * ========================================================================= */

let currentDetail = null;

async function renderThemeDetail(slug) {
  const detail = await api.themeDetail(slug, false);
  currentDetail = detail;
  document.getElementById("detail-title").textContent = detail.title;
  document.getElementById("detail-meta").textContent =
    `${detail.image_count} images · refreshed ${relativeTime(detail.last_refreshed)} · ${detail.size_mb} MB · v${detail.version_pin} · ${detail.image_model}`;
  document.getElementById("detail-on-tv-pill").classList.toggle("hidden", detail.state !== "on_tv");

  // Reset expansion panel
  const panel = document.getElementById("expansion-panel");
  panel.open = false;
  document.getElementById("expansion-summary-meta").textContent =
    `${detail.image_count} prompts · seed pending`;
  document.getElementById("expansion-body").innerHTML =
    '<p class="onboarding-meta">Click to load expansion data.</p>';

  panel.addEventListener(
    "toggle",
    async () => {
      if (!panel.open) return;
      const full = await api.themeDetail(slug, true);
      renderExpansion(full.expansion);
    },
    { once: true },
  );

  // Image grid
  const grid = document.getElementById("image-grid");
  grid.innerHTML = "";
  detail.images.forEach((img) => grid.appendChild(imageTileEl(slug, img)));

  document.getElementById("detail-push").onclick = () =>
    api.push(slug, { minutes: 30, matte: "shadowbox", matte_color: "polar" });
  document.getElementById("detail-regenerate").onclick = () =>
    api.generate(slug, { theme: detail.title });
}

function renderExpansion(exp) {
  document.getElementById("expansion-summary-meta").textContent =
    `${exp.count} prompts · seed ${exp.seed}`;
  const body = document.getElementById("expansion-body");
  body.innerHTML = `
    <ol class="expansion-prompts">
      ${exp.prompts.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
    </ol>
    <div class="expansion-footer">
      GENERATED ${exp.generated_at} · ${exp.text_model} · expansion v${exp.frameforge_version}
      <a class="reexpand" href="#">Re-expand</a>
    </div>
  `;
}

function imageTileEl(slug, img) {
  const el = document.createElement("div");
  el.className = "image-tile";
  el.innerHTML = `
    <div class="image-tile-frame" style="background-image:url('${api.imageUrl(slug, img.filename)}')">
      ${img.on_tv ? '<span class="corner-dot" title="On TV"></span>' : ""}
      <div class="tile-toolbar">
        <button title="Regenerate" data-act="regen">↻</button>
        <button title="Inspect" data-act="inspect">⊕</button>
        <button title="Toggle on TV" data-act="toggle">◐</button>
      </div>
    </div>
    <div class="image-tile-caption">${escapeHtml(img.prompt_short)}</div>
  `;
  el.querySelector('[data-act="inspect"]').onclick = () => openInspect(slug, img.filename);
  return el;
}

/* ===========================================================================
 * Inspect side sheet
 * ========================================================================= */

async function openInspect(slug, filename) {
  const sheet = document.getElementById("inspect-sheet");
  sheet.classList.remove("hidden");
  const payload = await api.inspect(slug, filename);
  document.getElementById("inspect-image").style.backgroundImage = `url('${api.imageUrl(slug, filename)}')`;
  document.getElementById("inspect-prompt").textContent = payload.prompt;
  document.getElementById("inspect-provenance-name").textContent = filename.replace(".png", ".json").toUpperCase();
  document.getElementById("inspect-json").innerHTML = highlightJson(payload.sidecar);
  document.getElementById("inspect-pill-on-tv").classList.toggle("on", payload.on_tv);
  document.getElementById("inspect-pill-regen").textContent = `REGENERATED ${payload.regen_count}×`;
}

document.getElementById("inspect-close").addEventListener("click", () => {
  document.getElementById("inspect-sheet").classList.add("hidden");
});

/* ===========================================================================
 * TV screen
 * ========================================================================= */

const MATTE_STYLES = ["shadowbox", "neat", "panoramic", "wide", "double", "triple", "single", "thin"];
const MATTE_COLORS = [
  ["polar", "#f5f1e8"],
  ["sand", "#d8c9a9"],
  ["sage", "#7a8a6f"],
  ["ink", "#1e2a44"],
  ["brass", "#a4824a"],
  ["dove", "#bcb6a8"],
  ["coal", "#2c2c2c"],
  ["cream", "#ece6d6"],
];

async function renderTV() {
  const status = await api.tvStatus();
  const card = document.getElementById("tv-card");
  if (!status.connected) {
    card.innerHTML = `
      <div class="tv-empty">
        <p class="lede" style="margin:0 0 12px">No TV connected.</p>
        <a class="btn btn-primary" href="#/onboarding">Run setup</a>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div>
        <h2 class="tv-model-name">${escapeHtml(status.model_name || "Frame TV")}</h2>
        <span class="pill connected-pill">CONNECTED</span>
        <dl class="tv-meta-row">
          <dt>HOST</dt><dd>${status.host || "—"}</dd>
          <dt>MAC</dt><dd>${status.mac || "—"}</dd>
          <dt>ART MODE</dt><dd>${status.art_mode || "—"}</dd>
          <dt>LAST SEEN</dt><dd>${relativeTime(status.last_seen)}</dd>
          <dt>ON TV</dt><dd>${status.images_on_tv} / ${status.storage_cap}</dd>
        </dl>
      </div>
      <div class="tv-actions">
        <button class="btn btn-ghost">Reconnect</button>
        <button class="btn btn-ghost btn-danger">Forget TV</button>
      </div>
    `;
  }

  // Pickers (idempotent re-render is fine; mock state lives in DOM classes)
  const matte = document.getElementById("matte-picker");
  matte.innerHTML = MATTE_STYLES.map(
    (s, i) => `<button class="swatch ${i === 0 ? "selected" : ""}" data-style data-value="${s}" title="${s}"></button>`,
  ).join("");
  matte.querySelectorAll(".swatch").forEach((b) =>
    b.addEventListener("click", () => {
      matte.querySelectorAll(".swatch").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    }),
  );
  const color = document.getElementById("matte-color-picker");
  color.innerHTML = MATTE_COLORS.map(
    ([name, hex], i) =>
      `<button class="swatch ${i === 0 ? "selected" : ""}" data-value="${name}" title="${name}" style="background:${hex}"></button>`,
  ).join("");
  color.querySelectorAll(".swatch").forEach((b) =>
    b.addEventListener("click", () => {
      color.querySelectorAll(".swatch").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    }),
  );
  document.querySelectorAll("#minutes-picker button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#minutes-picker button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    }),
  );
}

/* ===========================================================================
 * Schedule (mock-only render — endpoints are roadmap)
 * ========================================================================= */

async function renderSchedule() {
  const schedules = await api.schedules();
  const list = document.getElementById("schedule-list");
  list.innerHTML = schedules
    .map(
      (s) => `
        <li>
          <div>
            <div>${escapeHtml(s.theme_title)}</div>
            <div class="schedule-meta">${s.cron} · next ${relativeTime(s.next_run)}</div>
          </div>
          <div>
            <span class="pill ${s.enabled ? "pill-on-tv" : ""}">${s.enabled ? "ENABLED" : "PAUSED"}</span>
          </div>
        </li>
      `,
    )
    .join("");

  // Build a simple 7-day x 6-hour grid showing schedule hits as filled cells.
  const cal = document.getElementById("week-calendar");
  cal.innerHTML = "";
  const days = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  days.forEach((d, i) => {
    const div = document.createElement("div");
    if (i === 0) div.className = "day-header";
    else div.className = "day-header";
    div.textContent = d;
    cal.appendChild(div);
  });
  // 6 row buckets: 0-4, 4-8, 8-12, 12-16, 16-20, 20-24
  const labels = ["00", "04", "08", "12", "16", "20"];
  for (let row = 0; row < 6; row++) {
    const lab = document.createElement("div");
    lab.className = "hour-label";
    lab.textContent = labels[row];
    cal.appendChild(lab);
    for (let day = 0; day < 7; day++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      // mock: schedule sch_001 hits Sunday 03:00, sch_002 Wed 06:00, sch_003 Fri 22:00
      if ((day === 6 && row === 0) || (day === 2 && row === 1) || (day === 4 && row === 5)) {
        slot.classList.add("has-event");
      }
      cal.appendChild(slot);
    }
  }
}

/* ===========================================================================
 * Settings
 * ========================================================================= */

async function renderSettings() {
  const s = await api.settings();
  const h = await api.health();
  document.getElementById("setting-image-model").textContent = s.image_model;
  document.getElementById("setting-text-model").textContent = s.text_model;
  document.getElementById("setting-resolution").textContent = s.resolution;
  document.getElementById("setting-aspect").textContent = s.aspect_ratio;
  document.getElementById("setting-count").textContent = s.target_count;
  document.getElementById("setting-pin-versions").checked = s.pin_versions ?? false;
  document.getElementById("setting-save-provenance").checked = s.save_provenance ?? true;
  document.getElementById("about-version").textContent = h.version;
}

/* ===========================================================================
 * Helpers
 * ========================================================================= */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function relativeTime(iso) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3.6e6)} hr ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} day${Math.floor(diff / day) === 1 ? "" : "s"} ago`;
  if (diff < 0) return `in ${Math.floor(-diff / day)} day(s)`;
  return new Date(iso).toLocaleDateString();
}

/* JSON syntax highlighter using the .json-* classes specified in WIRING.md.
 * Walks the JSON character-by-character so that values containing entity-
 * reference characters (`&`, `<`, `>`) are escaped without confusing the
 * tokenizer. */
function highlightJson(obj) {
  const json = JSON.stringify(obj, null, 2);
  const out = [];
  let i = 0;
  while (i < json.length) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') {
        if (json[j] === "\\") j += 2;
        else j += 1;
      }
      const str = json.slice(i, j + 1);
      let k = j + 1;
      while (k < json.length && /\s/.test(json[k])) k++;
      const cls = json[k] === ":" ? "json-key" : "json-string";
      out.push(`<span class="${cls}">${escapeHtml(str)}</span>`);
      i = j + 1;
    } else if ((c === "-" || (c >= "0" && c <= "9")) && /[\s,:\[]/.test(json[i - 1] || " ")) {
      let j = i + 1;
      while (j < json.length && /[0-9.eE+\-]/.test(json[j])) j++;
      out.push(`<span class="json-number">${escapeHtml(json.slice(i, j))}</span>`);
      i = j;
    } else if (/[{}\[\],:]/.test(c)) {
      out.push(`<span class="json-punct">${escapeHtml(c)}</span>`);
      i++;
    } else {
      out.push(escapeHtml(c));
      i++;
    }
  }
  return out.join("");
}

/* ===========================================================================
 * Bootstrap
 * ========================================================================= */

connectStatusWS();
navigate();

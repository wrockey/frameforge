import { wait } from "./util.js";

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
    const images = Array.from({ length: theme.image_count }, (_, i) => {
      const onTv = theme.state === "on_tv" && i < 24;
      return {
        filename: `img_${String(i + 1).padStart(4, "0")}.png`,
        prompt_short: SAMPLE_PROMPTS[i % SAMPLE_PROMPTS.length].split(" ").slice(0, 6).join(" ") + "…",
        on_tv: onTv,
        content_id: onTv ? `MY_F${String(i + 1).padStart(4, "0")}` : null,
        _hue: hue,
        _seed: i + 1,
      };
    });
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

/* Mutable mock TV state so upload/remove/show-now feel real in mock mode. */
let mockTvArt = null;

function ensureMockTvArt() {
  if (mockTvArt) return mockTvArt;
  const items = [];
  MOCK_DATA.themes
    .filter((t) => t.state === "on_tv")
    .forEach((t) => {
      const detail = MOCK_DATA.themeDetail(t.slug);
      detail.images
        .filter((im) => im.on_tv)
        .forEach((im, n) => {
          items.push({
            content_id: im.content_id,
            matched: true,
            theme_slug: t.slug,
            theme_title: t.title,
            filename: im.filename,
            uploaded_at: t.last_refreshed,
            is_current: n === 2,
            thumbnail_url: makePlaceholderSvg(im._seed, im._hue),
          });
        });
    });
  // One piece of art uploaded outside FrameForge (e.g. the SmartThings app)
  items.push({
    content_id: "MY_F9001",
    matched: false,
    theme_slug: null,
    theme_title: null,
    filename: null,
    uploaded_at: null,
    is_current: false,
    thumbnail_url: makePlaceholderSvg(77, 0),
  });
  mockTvArt = {
    connected: true,
    source: "tv",
    current_content_id: items.find((i) => i.is_current)?.content_id ?? null,
    items,
  };
  return mockTvArt;
}

export const mockApi = {
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
  async tvArt() {
    await wait(500);
    return ensureMockTvArt();
  },
  async tvUpload(body) {
    await wait(800);
    const art = ensureMockTvArt();
    const uploaded = [];
    body.items.forEach((it, n) => {
      const cid = `MY_F${9100 + art.items.length + n}`;
      art.items.push({
        content_id: cid,
        matched: true,
        theme_slug: it.slug,
        theme_title: it.slug.replace(/_/g, " "),
        filename: it.filename,
        uploaded_at: new Date().toISOString(),
        is_current: false,
        thumbnail_url: makePlaceholderSvg(Number(it.filename.replace(/\D/g, "")) || 1, 120),
      });
      uploaded.push(cid);
    });
    return { uploaded, count: uploaded.length };
  },
  async tvDelete(body) {
    await wait(400);
    const art = ensureMockTvArt();
    art.items = art.items.filter((i) => !body.content_ids.includes(i.content_id));
    return { removed: body.content_ids, failed: [] };
  },
  async tvSelect(body) {
    await wait(200);
    const art = ensureMockTvArt();
    art.items.forEach((i) => (i.is_current = i.content_id === body.content_id));
    art.current_content_id = body.content_id;
    return { ok: true, content_id: body.content_id };
  },
  async tvSlideshow(body) {
    await wait(200);
    return { ok: true, minutes: body.minutes };
  },
  async setTvHost(host) {
    await wait(120);
    return { ok: true, host, env_override: false };
  },
  async forgetTv() {
    await wait(120);
    MOCK_DATA.tvStatus.connected = false;
    return { ok: true };
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
  thumbUrl: (url) => url,
  importImage: async () => ({ slug: "imported", filename: "img_0001.png" }),
  recropImage: async () => ({ slug: "imported", filename: "img_0001.png" }),
};

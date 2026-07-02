import { mockApi } from "./mock.js";

export const USE_MOCK = false;
// Derive from wherever the page was served so the UI works from a phone on
// the LAN, not just localhost. file:// prototyping falls back to localhost.
export const API_BASE = location.protocol.startsWith("http")
  ? location.origin
  : "http://localhost:8765";
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/status";

/* ---- API token (for servers started with FRAMEFORGE_API_TOKEN) ----------
 * Accepted once via ?token=… in the URL (then scrubbed from the address bar),
 * kept in localStorage, and attached to every request: as a Bearer header on
 * fetches, as a query param on image/WebSocket URLs that can't set headers. */

const TOKEN_KEY = "frameforge_token";

(function captureTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  const t = params.get("token");
  if (!t) return;
  localStorage.setItem(TOKEN_KEY, t);
  params.delete("token");
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
})();

export const authToken = () => localStorage.getItem(TOKEN_KEY) || "";

export function withToken(url) {
  const t = authToken();
  if (!t) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t);
}

/* ===========================================================================
 * API wrapper
 * Each method returns a Promise. Mock branch returns canned data after a tiny
 * delay; live branch fetches the WIRING.md endpoints.
 * ========================================================================= */

/* fetch that surfaces FastAPI error details as thrown Errors, so button
 * handlers can show "TV upload failed: …" instead of silently succeeding.
 * On 401 it prompts once for the API token and retries. */
export async function jfetch(url, opts = {}, retried = false) {
  const headers = { ...(opts.headers || {}) };
  const t = authToken();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const r = await fetch(url, { ...opts, headers });
  if (r.status === 401 && !retried) {
    const entered = window.prompt("This FrameForge server requires an API token:");
    if (entered && entered.trim()) {
      localStorage.setItem(TOKEN_KEY, entered.trim());
      return jfetch(url, opts, true);
    }
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const body = await r.json();
      if (body.detail) msg = body.detail;
    } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

export const jpost = (url, body) =>
  jfetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const liveApi = {
  health: () => jfetch(`${API_BASE}/api/health`),
  discover: () => jfetch(`${API_BASE}/api/discover`),
  themes: () => jfetch(`${API_BASE}/api/themes`),
  themeDetail: (slug, withExpansion = false) =>
    jfetch(`${API_BASE}/api/themes/${slug}?with_expansion=${withExpansion}`),
  inspect: (slug, filename) =>
    jfetch(`${API_BASE}/api/themes/${slug}/images/${filename}/inspect`),
  tvStatus: () => jfetch(`${API_BASE}/api/tv/status`),
  tvArt: () => jfetch(`${API_BASE}/api/tv/art`),
  tvUpload: (body) => jpost(`${API_BASE}/api/tv/art/upload`, body),
  tvDelete: (body) => jpost(`${API_BASE}/api/tv/art/delete`, body),
  tvSelect: (body) => jpost(`${API_BASE}/api/tv/art/select`, body),
  tvSlideshow: (body) => jpost(`${API_BASE}/api/tv/slideshow`, body),
  settings: () => jfetch(`${API_BASE}/api/settings`),
  schedules: () => jfetch(`${API_BASE}/api/schedules`),
  setTvHost: (host) =>
    jfetch(`${API_BASE}/api/tv/host`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host }),
    }),
  forgetTv: () => jfetch(`${API_BASE}/api/tv/host`, { method: "DELETE" }),
  generate: (slug, body) => jpost(`${API_BASE}/api/themes/${slug}/generate`, body),
  push: (slug, body) => jpost(`${API_BASE}/api/themes/${slug}/push`, body),
  testKey: (key) => jpost(`${API_BASE}/api/settings/test-key`, { key }),
  imageUrl: (slug, filename) =>
    withToken(`${API_BASE}/api/themes/${slug}/images/${filename}`),
  thumbUrl: (url) => (url.startsWith("data:") ? url : withToken(`${API_BASE}${url}`)),
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
};

export const api = USE_MOCK ? mockApi : liveApi;

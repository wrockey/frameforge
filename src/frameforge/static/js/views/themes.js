import { api } from "../api.js";
import { escapeHtml, relativeTime } from "../util.js";

/* ===========================================================================
 * Themes screen
 * ========================================================================= */

export async function renderThemes() {
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

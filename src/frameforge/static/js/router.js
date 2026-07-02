import { enterOnboarding, stopPairTimers } from "./views/onboarding.js";
import { renderThemes } from "./views/themes.js";
import { renderThemeDetail } from "./views/themeDetail.js";
import { renderTV } from "./views/tv.js";
import { renderSchedule } from "./views/schedule.js";
import { renderSettings } from "./views/settings.js";

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

export function showRoute(name) {
  if (name !== "onboarding") stopPairTimers();
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

export function navigate() {
  const { name, slug } = parseHash();
  const handler = routes[name];
  if (handler) handler(slug);
  else routes.themes();
}

window.addEventListener("hashchange", navigate);

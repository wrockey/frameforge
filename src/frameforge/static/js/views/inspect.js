import { api } from "../api.js";
import { highlightJson } from "../util.js";

/* ===========================================================================
 * Inspect side sheet
 * ========================================================================= */

export async function openInspect(slug, filename) {
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

import { api } from "../api.js";

/* ===========================================================================
 * Settings
 * ========================================================================= */

export async function renderSettings() {
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

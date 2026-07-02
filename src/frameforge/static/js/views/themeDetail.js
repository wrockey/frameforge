import { api } from "../api.js";
import { escapeHtml, relativeTime } from "../util.js";
import { tvView } from "./tv.js";
import { openInspect } from "./inspect.js";

/* ===========================================================================
 * Theme detail
 * ========================================================================= */

let currentDetail = null;

export async function renderThemeDetail(slug) {
  const detail = await api.themeDetail(slug, false);
  currentDetail = detail;
  document.getElementById("detail-title").textContent = detail.title;
  document.getElementById("detail-meta").textContent =
    `${detail.image_count} images · refreshed ${relativeTime(detail.last_refreshed)} · ${detail.size_mb} MB · v${detail.version_pin} · ${detail.image_model}`;
  document.getElementById("detail-on-tv-pill").classList.toggle("hidden", detail.state !== "on_tv");
  document.getElementById("detail-regenerate").classList.toggle("hidden", slug === "imported");

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
        <button title="${img.on_tv ? "Remove from TV" : "Send to TV"}" data-act="toggle">${img.on_tv ? "−" : "+"}</button>
      </div>
    </div>
    <div class="image-tile-caption">${escapeHtml(img.prompt_short)}</div>
  `;
  el.querySelector('[data-act="inspect"]').onclick = () => openInspect(slug, img.filename);
  el.querySelector('[data-act="toggle"]').onclick = async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      if (img.on_tv) {
        if (!img.content_id) throw new Error("No TV record for this image");
        await api.tvDelete({ content_ids: [img.content_id] });
      } else {
        await api.tvUpload({
          items: [{ slug, filename: img.filename }],
          matte: tvView.matte,
          matte_color: tvView.matteColor,
        });
      }
      renderThemeDetail(slug); // re-render to pick up the new on-TV state
    } catch (err) {
      btn.disabled = false;
      btn.textContent = img.on_tv ? "−" : "+";
      alert(`TV update failed: ${err.message || err}`);
    }
  };
  return el;
}

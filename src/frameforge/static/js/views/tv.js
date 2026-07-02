import { api } from "../api.js";
import { escapeHtml, relativeTime } from "../util.js";
import { pollTvHealth, tvActionError } from "../tvhealth.js";

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

/* All TV-screen state in one place. Selections are Sets so multi-select
 * survives re-renders of the grids. */
export const tvView = {
  minutes: 30,
  matte: "shadowbox",
  matteColor: "polar",
  art: null, // last /api/tv/art payload
  libTheme: "all",
  libImages: [], // flattened [{slug, theme_title, filename, on_tv, content_id}]
  selOnTv: new Set(), // content_ids
  selLib: new Set(), // "slug/filename" keys
};

export async function renderTV() {
  tvView.selOnTv.clear();
  tvView.selLib.clear();
  renderTvPickers();
  wireTvPanelButtons();
  renderTvStatusCard();
  await Promise.all([refreshOnTv(), refreshLibraryPanel(true)]);
}

async function renderTvStatusCard() {
  const card = document.getElementById("tv-card");
  const status = await api.tvStatus();
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
  } else {
    card.innerHTML = `
      <div>
        <h2 class="tv-model-name">${escapeHtml(status.model_name || "Frame TV")}</h2>
        <span class="pill connected-pill">CONNECTED</span>
        <dl class="tv-meta-row">
          <dt>HOST</dt><dd>${status.host || "—"}</dd>
          <dt>ART MODE</dt><dd>${status.art_mode || "—"}</dd>
          <dt>LAST SEEN</dt><dd>${relativeTime(status.last_seen)}</dd>
          <dt>ON TV</dt><dd>${status.images_on_tv} / ${status.storage_cap}</dd>
        </dl>
      </div>
      <div class="tv-actions">
        <button class="btn btn-ghost btn-danger" id="tv-forget">Forget TV</button>
      </div>
    `;
    document.getElementById("tv-forget").onclick = async () => {
      if (!confirm("Forget this TV? The saved host and pairing token are removed; art on the TV stays put.")) return;
      try {
        await api.forgetTv();
      } catch (err) {
        alert(`Could not forget the TV: ${err.message || err}`);
        return;
      }
      renderTV();
    };
  }
}

/* ---- Left panel: what's on the TV ---- */

async function refreshOnTv() {
  const grid = document.getElementById("on-tv-grid");
  grid.innerHTML = '<p class="panel-loading">Reading the TV…</p>';
  let art;
  try {
    art = await api.tvArt();
  } catch (_) {
    art = { connected: false, source: "cache", current_content_id: null, items: [] };
  }
  tvView.art = art;
  const ids = new Set(art.items.map((i) => i.content_id));
  tvView.selOnTv = new Set([...tvView.selOnTv].filter((id) => ids.has(id)));
  renderOnTvGrid();
}

function renderOnTvGrid() {
  const art = tvView.art || { items: [], source: "cache" };
  document.getElementById("on-tv-stale").classList.toggle("hidden", art.source !== "cache");
  const n = art.items.length;
  document.getElementById("on-tv-count").textContent = n
    ? `${n} image${n === 1 ? "" : "s"}`
    : "";
  const grid = document.getElementById("on-tv-grid");
  grid.innerHTML = "";
  art.items.forEach((item) => grid.appendChild(onTvTileEl(item)));
  document.getElementById("on-tv-empty").classList.toggle("hidden", n > 0);
  updateTvActionButtons();
}

function onTvTileEl(item) {
  const el = document.createElement("div");
  el.className = "art-tile";
  const caption = item.matched
    ? `${item.theme_title} · ${item.filename}`
    : "Uploaded outside FrameForge";
  el.innerHTML = `
    <div class="art-thumb" style="background-image:url('${api.thumbUrl(item.thumbnail_url)}')">
      <span class="sel-box" aria-hidden="true"></span>
      ${item.is_current ? '<span class="pill pill-now">NOW SHOWING</span>' : ""}
      ${item.is_current ? "" : `
      <div class="art-toolbar">
        <button data-act="show" title="Display this image on the TV now">Show now</button>
      </div>`}
    </div>
    <div class="art-caption ${item.matched ? "" : "art-caption-dim"}">${escapeHtml(caption)}</div>
  `;
  const sync = () => el.classList.toggle("selected", tvView.selOnTv.has(item.content_id));
  el.onclick = (e) => {
    if (e.target.closest("[data-act]")) return;
    if (tvView.selOnTv.has(item.content_id)) tvView.selOnTv.delete(item.content_id);
    else tvView.selOnTv.add(item.content_id);
    sync();
    updateTvActionButtons();
  };
  const showBtn = el.querySelector('[data-act="show"]');
  if (showBtn) {
    showBtn.onclick = async (e) => {
      e.stopPropagation();
      showBtn.disabled = true;
      showBtn.textContent = "Showing…";
      try {
        await api.tvSelect({ content_id: item.content_id });
        await refreshOnTv();
      } catch (err) {
        showBtn.textContent = "Failed";
        setTimeout(() => {
          showBtn.disabled = false;
          showBtn.textContent = "Show now";
        }, 1600);
      }
    };
  }
  sync();
  return el;
}

/* ---- Right panel: local library ---- */

async function refreshLibraryPanel(rebuildFilter = false) {
  const grid = document.getElementById("library-grid");
  grid.innerHTML = '<p class="panel-loading">Loading library…</p>';
  const themes = await api.themes();

  if (rebuildFilter) {
    const sel = document.getElementById("library-theme-filter");
    sel.innerHTML =
      `<option value="all">All themes</option>` +
      themes.map((t) => `<option value="${t.slug}">${escapeHtml(t.title)}</option>`).join("");
    if (!themes.some((t) => t.slug === tvView.libTheme)) tvView.libTheme = "all";
    sel.value = tvView.libTheme;
    sel.onchange = () => {
      tvView.libTheme = sel.value;
      tvView.selLib.clear();
      refreshLibraryPanel(false);
    };
  }

  const slugs = tvView.libTheme === "all" ? themes.map((t) => t.slug) : [tvView.libTheme];
  const details = await Promise.all(
    slugs.map((s) => api.themeDetail(s, false).catch(() => null)),
  );
  const images = [];
  details.filter(Boolean).forEach((d) => {
    d.images.forEach((im) =>
      images.push({
        slug: d.slug,
        theme_title: d.title,
        filename: im.filename,
        on_tv: im.on_tv,
        content_id: im.content_id ?? null,
      }),
    );
  });
  tvView.libImages = images;
  const selectable = new Set(
    images.filter((im) => !im.on_tv).map((im) => `${im.slug}/${im.filename}`),
  );
  tvView.selLib = new Set([...tvView.selLib].filter((k) => selectable.has(k)));
  renderLibraryGrid();
}

function renderLibraryGrid() {
  const grid = document.getElementById("library-grid");
  grid.innerHTML = "";
  tvView.libImages.forEach((im) => grid.appendChild(libraryTileEl(im)));
  document.getElementById("library-empty").classList.toggle("hidden", tvView.libImages.length > 0);
  updateTvActionButtons();
}

function libraryTileEl(im) {
  const key = `${im.slug}/${im.filename}`;
  const el = document.createElement("div");
  el.className = "art-tile" + (im.on_tv ? " art-tile-on-tv" : "");
  el.innerHTML = `
    <div class="art-thumb" style="background-image:url('${api.imageUrl(im.slug, im.filename)}')">
      ${im.on_tv ? '<span class="pill pill-on-tv art-badge">ON TV</span>' : '<span class="sel-box" aria-hidden="true"></span>'}
    </div>
    <div class="art-caption">${escapeHtml(im.theme_title)} · ${escapeHtml(im.filename)}</div>
  `;
  if (im.on_tv) {
    el.title = "Already on the TV — remove it from the left panel";
  } else {
    const sync = () => el.classList.toggle("selected", tvView.selLib.has(key));
    el.onclick = () => {
      if (tvView.selLib.has(key)) tvView.selLib.delete(key);
      else tvView.selLib.add(key);
      sync();
      updateTvActionButtons();
    };
    sync();
  }
  return el;
}

/* ---- Panel buttons + shared actions ---- */

function updateTvActionButtons() {
  const rm = document.getElementById("on-tv-remove");
  const up = document.getElementById("library-upload");
  const nRm = tvView.selOnTv.size;
  const nUp = tvView.selLib.size;
  rm.disabled = nRm === 0;
  rm.textContent = nRm ? `Remove ${nRm} from TV` : "Remove from TV";
  up.disabled = nUp === 0;
  up.textContent = nUp ? `Upload ${nUp} to TV` : "Upload to TV";
}

function wireTvPanelButtons() {
  document.getElementById("on-tv-refresh").onclick = () => refreshOnTv();
  document.getElementById("on-tv-retry").onclick = () => refreshOnTv();

  document.getElementById("on-tv-select-all").onclick = () => {
    const items = tvView.art?.items ?? [];
    if (tvView.selOnTv.size === items.length) tvView.selOnTv.clear();
    else items.forEach((i) => tvView.selOnTv.add(i.content_id));
    renderOnTvGrid();
  };

  document.getElementById("library-select-all").onclick = () => {
    const selectable = tvView.libImages.filter((im) => !im.on_tv);
    if (tvView.selLib.size === selectable.length) tvView.selLib.clear();
    else selectable.forEach((im) => tvView.selLib.add(`${im.slug}/${im.filename}`));
    renderLibraryGrid();
  };

  document.getElementById("on-tv-remove").onclick = async () => {
    const ids = [...tvView.selOnTv];
    if (!ids.length) return;
    const msg = `Remove ${ids.length} image${ids.length === 1 ? "" : "s"} from the TV? Your local files are kept.`;
    if (!confirm(msg)) return;
    const btn = document.getElementById("on-tv-remove");
    btn.disabled = true;
    btn.textContent = "Removing…";
    try {
      const r = await api.tvDelete({ content_ids: ids });
      tvView.selOnTv.clear();
      if (r.failed?.length) alert(`${r.failed.length} image(s) could not be removed.`);
    } catch (err) {
      alert(`Remove failed: ${tvActionError(err)}`);
    }
    await Promise.all([refreshOnTv(), refreshLibraryPanel(false), renderTvStatusCard()]);
    pollTvHealth();
  };

  document.getElementById("library-upload").onclick = async () => {
    const items = [...tvView.selLib].map((k) => {
      const i = k.indexOf("/");
      return { slug: k.slice(0, i), filename: k.slice(i + 1) };
    });
    if (!items.length) return;
    const btn = document.getElementById("library-upload");
    btn.disabled = true;
    btn.textContent = `Uploading ${items.length}…`;
    try {
      await api.tvUpload({
        items,
        matte: tvView.matte,
        matte_color: tvView.matteColor,
      });
      tvView.selLib.clear();
    } catch (err) {
      alert(`Upload failed: ${tvActionError(err)}`);
    }
    await Promise.all([refreshOnTv(), refreshLibraryPanel(false), renderTvStatusCard()]);
    pollTvHealth();
  };

  document.getElementById("slideshow-apply").onclick = async () => {
    const btn = document.getElementById("slideshow-apply");
    const out = document.getElementById("slideshow-result");
    btn.disabled = true;
    out.textContent = "";
    try {
      await api.tvSlideshow({ minutes: tvView.minutes });
      out.textContent = `Slideshow restarted — one image every ${tvView.minutes} min.`;
    } catch (err) {
      out.textContent = `Failed: ${err.message || err}`;
    }
    btn.disabled = false;
  };
}

function renderTvPickers() {
  const matte = document.getElementById("matte-picker");
  matte.innerHTML = MATTE_STYLES.map(
    (s) =>
      `<button class="swatch ${s === tvView.matte ? "selected" : ""}" data-style data-value="${s}" title="${s}"></button>`,
  ).join("");
  matte.querySelectorAll(".swatch").forEach((b) => {
    b.onclick = () => {
      tvView.matte = b.dataset.value;
      matte.querySelectorAll(".swatch").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    };
  });
  const color = document.getElementById("matte-color-picker");
  color.innerHTML = MATTE_COLORS.map(
    ([name, hex]) =>
      `<button class="swatch ${name === tvView.matteColor ? "selected" : ""}" data-value="${name}" title="${name}" style="background:${hex}"></button>`,
  ).join("");
  color.querySelectorAll(".swatch").forEach((b) => {
    b.onclick = () => {
      tvView.matteColor = b.dataset.value;
      color.querySelectorAll(".swatch").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    };
  });
  document.querySelectorAll("#minutes-picker button").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.value) === tvView.minutes);
    b.onclick = () => {
      tvView.minutes = Number(b.dataset.value);
      document.querySelectorAll("#minutes-picker button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    };
  });
}

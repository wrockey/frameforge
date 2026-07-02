import { api } from "../api.js";
import { escapeHtml, relativeTime } from "../util.js";
import { pollTvHealth, tvActionError } from "../tvhealth.js";
import { importWithCrop } from "../crop.js";
import { openLightbox } from "../lightbox.js";
import { GridSelection, attachTilePointerHandlers } from "../selection.js";

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
  onTvSort: "newest",
  onTvFilter: "all",
  libSort: "newest",
  libSearch: "",
};

const onTvSel = new GridSelection({ set: null, onChange: () => syncSelectionUi("on-tv") });
const libSel = new GridSelection({ set: null, onChange: () => syncSelectionUi("library") });

export async function renderTV() {
  tvView.selOnTv.clear();
  tvView.selLib.clear();
  onTvSel.set = tvView.selOnTv;
  libSel.set = tvView.selLib;
  renderTvPickers();
  wireTvPanelButtons();
  renderTvStatusCard();
  await Promise.all([refreshOnTv(), refreshLibraryPanel(true)]);
}

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

function applySort(items, mode, dateOf, nameOf) {
  const arr = [...items];
  if (mode === "name") arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  else {
    arr.sort((a, b) => (dateOf(a) || "").localeCompare(dateOf(b) || ""));
    if (mode === "newest") arr.reverse();
  }
  return arr;
}

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
  [...tvView.selOnTv].forEach((id) => {
    if (!ids.has(id)) tvView.selOnTv.delete(id);
  });
  renderOnTvGrid();
}

function renderOnTvGrid() {
  const art = tvView.art || { items: [], source: "cache" };
  document.getElementById("on-tv-stale").classList.toggle("hidden", art.source !== "cache");

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

  const n = art.items.length;
  document.getElementById("on-tv-count").textContent = n
    ? `${n} image${n === 1 ? "" : "s"}`
    : "";
  const grid = document.getElementById("on-tv-grid");
  grid.innerHTML = "";
  items.forEach((item) => grid.appendChild(onTvTileEl(item)));
  document.getElementById("on-tv-empty").classList.toggle("hidden", n > 0);
  onTvSel.setOrder(items.map((i) => i.content_id));
  syncSelectionUi("on-tv");
}

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

function onTvTileEl(item) {
  const el = document.createElement("div");
  el.className = "art-tile";
  el.dataset.key = item.content_id;
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
  attachTilePointerHandlers(el, item.content_id, onTvSel, () => {
    const i = (tvView.art?.items ?? []).findIndex((x) => x.content_id === item.content_id);
    openLightbox(onTvLightboxItems(), Math.max(0, i));
  });
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
  el.classList.toggle("selected", tvView.selOnTv.has(item.content_id));
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
        prompt: im.prompt_short,
      }),
    );
  });
  tvView.libImages = images;
  const selectable = new Set(
    images.filter((im) => !im.on_tv).map((im) => `${im.slug}/${im.filename}`),
  );
  [...tvView.selLib].forEach((k) => {
    if (!selectable.has(k)) tvView.selLib.delete(k);
  });
  renderLibraryGrid();
}

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

function renderLibraryGrid() {
  let images = tvView.libImages;
  const q = tvView.libSearch.trim().toLowerCase();
  if (q) {
    images = images.filter((im) =>
      [im.filename, im.theme_title, im.prompt || ""].some((s) => s.toLowerCase().includes(q)),
    );
  }
  images = applySort(images, tvView.libSort, (im) => im.filename, (im) => im.filename);

  const grid = document.getElementById("library-grid");
  grid.innerHTML = "";
  images.forEach((im) => grid.appendChild(libraryTileEl(im)));
  document.getElementById("library-empty").classList.toggle("hidden", images.length > 0);
  const selectable = images.filter((im) => !im.on_tv).map((im) => `${im.slug}/${im.filename}`);
  libSel.setOrder(selectable);
  syncSelectionUi("library");
}

function libraryTileEl(im) {
  const key = `${im.slug}/${im.filename}`;
  const el = document.createElement("div");
  el.className = "art-tile" + (im.on_tv ? " art-tile-on-tv" : "");
  el.dataset.key = key;
  el.innerHTML = `
    <div class="art-thumb" style="background-image:url('${api.imageUrl(im.slug, im.filename)}')">
      ${im.on_tv ? '<span class="pill pill-on-tv art-badge">ON TV</span>' : '<span class="sel-box" aria-hidden="true"></span>'}
    </div>
    <div class="art-caption">${escapeHtml(im.theme_title)} · ${escapeHtml(im.filename)}</div>
  `;
  const openViewer = () => {
    const i = tvView.libImages.findIndex((x) => x.slug === im.slug && x.filename === im.filename);
    openLightbox(libLightboxItems(), Math.max(0, i));
  };
  if (im.on_tv) {
    el.title = "Already on the TV — remove it from the left panel";
    el.ondblclick = openViewer;
  } else {
    attachTilePointerHandlers(el, key, libSel, openViewer);
    el.classList.toggle("selected", tvView.selLib.has(key));
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

function wireTvPanelButtons() {
  document.getElementById("on-tv-refresh").onclick = () => refreshOnTv();
  document.getElementById("on-tv-retry").onclick = () => refreshOnTv();

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

  document.getElementById("on-tv-select-all").onclick = () => {
    const ids = (tvView.art?.items ?? []).map((i) => i.content_id);
    if (tvView.selOnTv.size === ids.length) onTvSel.clear();
    else onTvSel.selectAll(ids);
  };

  document.getElementById("library-select-all").onclick = () => {
    const selectable = tvView.libImages.filter((im) => !im.on_tv).map((im) => `${im.slug}/${im.filename}`);
    if (tvView.selLib.size === selectable.length) libSel.clear();
    else libSel.selectAll(selectable);
  };

  document.getElementById("on-tv-clear-sel").onclick = () => onTvSel.clear();
  document.getElementById("library-clear-sel").onclick = () => libSel.clear();

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
      onTvSel.clear();
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
      libSel.clear();
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

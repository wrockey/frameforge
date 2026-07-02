/* 16:9 crop overlay for imports. One modal, files queue through it.
 * Coordinates: crop rect kept in source-image pixels; rendered scaled. */
import { api } from "./api.js";

const RATIO = 16 / 9;
const TOL = 0.01;

let sheet = null;

function buildSheet() {
  sheet = document.createElement("div");
  sheet.className = "crop-backdrop hidden";
  sheet.innerHTML = `
    <div class="crop-sheet" role="dialog" aria-label="Crop image">
      <div class="crop-stage" id="crop-stage">
        <img id="crop-img" alt="" draggable="false" />
        <div class="crop-rect" id="crop-rect">
          <span class="crop-handle" id="crop-handle" aria-label="Resize"></span>
        </div>
      </div>
      <div class="crop-bar">
        <span class="crop-filename" id="crop-filename"></span>
        <span class="crop-queue" id="crop-queue"></span>
      </div>
      <label class="crop-tv-toggle">
        <input type="checkbox" id="crop-send-tv" /> Send to TV after import
      </label>
      <div class="crop-actions">
        <button class="btn btn-ghost" id="crop-skip">Skip</button>
        <button class="btn btn-ghost" id="crop-keep">Keep original (TV mattes it)</button>
        <button class="btn btn-secondary" id="crop-center-rest">Center-crop the rest</button>
        <button class="btn btn-primary" id="crop-import">Import</button>
      </div>
      <p class="crop-error hidden" id="crop-error"></p>
    </div>`;
  document.body.appendChild(sheet);
}

function centeredCrop(w, h) {
  if (w / h > RATIO) {
    const cw = Math.floor(h * RATIO);
    return { x: Math.floor((w - cw) / 2), y: 0, w: cw, h };
  }
  const ch = Math.floor(w / RATIO);
  return { x: 0, y: Math.floor((h - ch) / 2), w, h: ch };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} is not a readable image`));
    };
    img.src = url;
  });
}

/* Render + drag logic for one image; resolves with the chosen crop
 * ({x,y,w,h} source px), null for keep-original, or the strings
 * "skip" / "center-rest". */
function presentCrop(file, natW, natH, url, queueText) {
  const imgEl = sheet.querySelector("#crop-img");
  const rectEl = sheet.querySelector("#crop-rect");
  imgEl.src = url;
  sheet.querySelector("#crop-filename").textContent = file.name;
  sheet.querySelector("#crop-queue").textContent = queueText;
  sheet.querySelector("#crop-error").classList.add("hidden");
  sheet.classList.remove("hidden");

  let crop = centeredCrop(natW, natH);

  const scale = () => imgEl.clientWidth / natW;
  const syncRect = () => {
    const s = scale();
    const ox = imgEl.offsetLeft, oy = imgEl.offsetTop;
    rectEl.style.left = `${ox + crop.x * s}px`;
    rectEl.style.top = `${oy + crop.y * s}px`;
    rectEl.style.width = `${crop.w * s}px`;
    rectEl.style.height = `${crop.h * s}px`;
  };
  // Re-sync once the <img> lays out, and on window resize while open
  requestAnimationFrame(syncRect);
  const onResize = () => syncRect();
  window.addEventListener("resize", onResize);

  const clamp = () => {
    crop.x = Math.max(0, Math.min(crop.x, natW - crop.w));
    crop.y = Math.max(0, Math.min(crop.y, natH - crop.h));
  };

  // Drag to move; handle to resize (kept 16:9)
  let drag = null; // {mode:"move"|"resize", startX, startY, orig}
  rectEl.onpointerdown = (e) => {
    e.preventDefault();
    rectEl.setPointerCapture(e.pointerId);
    drag = {
      mode: e.target.id === "crop-handle" ? "resize" : "move",
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...crop },
    };
  };
  rectEl.onpointermove = (e) => {
    if (!drag) return;
    const s = scale();
    const dx = (e.clientX - drag.startX) / s;
    const dy = (e.clientY - drag.startY) / s;
    if (drag.mode === "move") {
      crop.x = drag.orig.x + dx;
      crop.y = drag.orig.y + dy;
    } else {
      const maxW = Math.min(natW - drag.orig.x, (natH - drag.orig.y) * RATIO);
      crop.w = Math.max(320, Math.min(drag.orig.w + dx, maxW));
      crop.h = crop.w / RATIO;
    }
    clamp();
    syncRect();
  };
  rectEl.onpointerup = () => (drag = null);

  return new Promise((resolve) => {
    const done = (v) => {
      window.removeEventListener("resize", onResize);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    sheet.querySelector("#crop-import").onclick = () =>
      done({ x: crop.x, y: crop.y, w: crop.w, h: crop.h });
    sheet.querySelector("#crop-keep").onclick = () => done(null);
    sheet.querySelector("#crop-skip").onclick = () => done("skip");
    sheet.querySelector("#crop-center-rest").onclick = () => done("center-rest");
  });
}

export async function importWithCrop(files) {
  if (!sheet) buildSheet();
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) return { imported: [], sendToTv: false };

  const imported = [];
  let centerRest = false;
  const failures = [];
  const errEl = () => sheet.querySelector("#crop-error");

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    let loaded;
    try {
      loaded = await loadImage(file);
    } catch (e) {
      failures.push(e.message);
      errEl().textContent = e.message;
      errEl().classList.remove("hidden");
      continue;
    }
    const { img, url } = loaded;
    const natW = img.naturalWidth, natH = img.naturalHeight;
    const already169 = Math.abs(natW / natH - RATIO) <= RATIO * TOL;

    let choice;
    if (already169 || centerRest) {
      URL.revokeObjectURL(url);
      choice = already169 ? null : centeredCrop(natW, natH);
    } else {
      choice = await presentCrop(file, natW, natH, url, `${i + 1} of ${list.length}`);
      if (choice === "skip") continue;
      if (choice === "center-rest") {
        centerRest = true;
        choice = centeredCrop(natW, natH);
      }
    }

    try {
      const r = await api.importImage(file, choice);
      imported.push({ slug: r.slug, filename: r.filename });
    } catch (e) {
      failures.push(`${file.name}: ${e.message || e}`);
      errEl().textContent = `${file.name}: ${e.message || e}`;
      errEl().classList.remove("hidden");
    }
  }

  if (failures.length) {
    alert(`${failures.length} file(s) could not be imported:\n` + failures.join("\n"));
  }

  const sendToTv = sheet.querySelector("#crop-send-tv").checked;
  sheet.classList.add("hidden");
  return { imported, sendToTv };
}

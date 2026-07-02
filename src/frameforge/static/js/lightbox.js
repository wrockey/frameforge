/* Full-screen image viewer: arrows/swipe navigate, Esc closes, contextual
 * actions in the footer. Build once, reuse. */
import { escapeHtml } from "./util.js";

let box = null;
let items = [];
let idx = 0;

function build() {
  box = document.createElement("div");
  box.className = "lightbox hidden";
  box.innerHTML = `
    <button class="lightbox-close" aria-label="Close">×</button>
    <button class="lightbox-nav lightbox-prev" aria-label="Previous">‹</button>
    <img class="lightbox-img" alt="" />
    <button class="lightbox-nav lightbox-next" aria-label="Next">›</button>
    <div class="lightbox-footer">
      <div class="lightbox-caption"></div>
      <div class="lightbox-meta"></div>
      <div class="lightbox-actions"></div>
    </div>`;
  document.body.appendChild(box);

  box.querySelector(".lightbox-close").onclick = close;
  box.querySelector(".lightbox-prev").onclick = () => show(idx - 1);
  box.querySelector(".lightbox-next").onclick = () => show(idx + 1);
  box.onclick = (e) => {
    if (e.target === box) close();
  };
  document.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(idx - 1);
    if (e.key === "ArrowRight") show(idx + 1);
  });
  let touchX = null;
  box.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  box.addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 48) show(idx + (dx < 0 ? 1 : -1));
    touchX = null;
  });
}

function show(i) {
  if (!items.length) return;
  idx = (i + items.length) % items.length;
  const it = items[idx];
  box.querySelector(".lightbox-img").src = it.src;
  box.querySelector(".lightbox-caption").textContent = it.caption || "";
  box.querySelector(".lightbox-meta").textContent = it.meta || "";
  const actions = box.querySelector(".lightbox-actions");
  actions.innerHTML = "";
  (it.actions || []).forEach((a) => {
    const b = document.createElement("button");
    b.className = a.className || "btn btn-secondary btn-small";
    b.textContent = a.label;
    b.onclick = async () => {
      b.disabled = true;
      try {
        await a.onClick();
      } finally {
        b.disabled = false;
      }
    };
    actions.appendChild(b);
  });
}

function close() {
  box.classList.add("hidden");
}

export function openLightbox(newItems, index = 0) {
  if (!box) build();
  items = newItems;
  box.classList.remove("hidden");
  show(index);
}

import { USE_MOCK, WS_URL, withToken } from "./api.js";
import { escapeHtml } from "./util.js";

/* ===========================================================================
 * Status chip + WebSocket
 * ========================================================================= */

const STATUS_LABELS = {
  idle: "Idle",
  expanding: "Expanding…",
  uploading: "Uploading to TV…",
  error: "Error: see Settings",
};

const statusHistory = [];
const STATUS_HISTORY_MAX = 12;

function renderStatus(payload) {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  dot.dataset.state = payload.state;
  if (payload.state === "generating" && payload.total != null) {
    label.textContent = `Generating ${payload.done} of ${payload.total}…`;
  } else {
    label.textContent = STATUS_LABELS[payload.state] || payload.state;
  }

  statusHistory.unshift({ at: new Date().toLocaleTimeString(), payload });
  if (statusHistory.length > STATUS_HISTORY_MAX) statusHistory.pop();
  const ul = document.getElementById("status-history");
  ul.innerHTML = statusHistory
    .map((h) => {
      const json = JSON.stringify(h.payload);
      return `<li><span style="color:var(--ink-30)">${h.at}</span> ${escapeHtml(json)}</li>`;
    })
    .join("");
}

export function connectStatusWS() {
  if (USE_MOCK) {
    // Demo cycle so the chip isn't dead during visual review.
    renderStatus({ state: "idle" });
    let step = 0;
    const cycle = () => {
      const seq = [
        { state: "idle" },
        { state: "expanding", theme_slug: "vintage_pulp_fantasy" },
        { state: "generating", theme_slug: "vintage_pulp_fantasy", done: 7, total: 30 },
        { state: "generating", theme_slug: "vintage_pulp_fantasy", done: 14, total: 30 },
        { state: "uploading", theme_slug: "vintage_pulp_fantasy" },
        { state: "idle" },
      ];
      renderStatus(seq[step % seq.length]);
      step += 1;
    };
    cycle();
    setInterval(cycle, 8000);
    return;
  }

  let ws;
  const open = () => {
    ws = new WebSocket(withToken(WS_URL));
    ws.onmessage = (e) => {
      try {
        renderStatus(JSON.parse(e.data));
      } catch (_) {}
    };
    ws.onclose = () => setTimeout(open, 2000);
    ws.onerror = () => ws.close();
  };
  open();
}

document.getElementById("status-chip").addEventListener("click", () => {
  document.getElementById("status-popover").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  const popover = document.getElementById("status-popover");
  const chip = document.getElementById("status-chip");
  if (!popover.contains(e.target) && !chip.contains(e.target)) {
    popover.classList.add("hidden");
  }
});

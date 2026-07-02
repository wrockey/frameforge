/* Header TV connection indicator + friendly TV error copy.
 * Polls /api/tv/status every 60s while the tab is visible, and on demand. */
import { api } from "./api.js";

const POLL_MS = 60_000;

const LABELS = {
  ok: "TV · connected",
  unreachable: "TV · unreachable",
  none: "TV · not set up",
  unknown: "TV · …",
};

function render(state) {
  const chip = document.getElementById("tv-chip");
  if (!chip) return;
  chip.dataset.state = state;
  chip.textContent = LABELS[state];
}

export async function pollTvHealth() {
  try {
    const s = await api.tvStatus();
    render(!s.host ? "none" : s.connected ? "ok" : "unreachable");
    return s;
  } catch (_) {
    render("unreachable");
    return null;
  }
}

export function startTvHealth() {
  pollTvHealth();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollTvHealth();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") pollTvHealth();
  }, POLL_MS);
}

/* Map raw fetch/HTTP errors from TV actions to copy a person can act on. */
export function tvActionError(err) {
  const msg = String((err && err.message) || err);
  if (/unreachable|refused|timed? ?out|502|503|No TV configured/i.test(msg)) {
    return "TV is unreachable — is it powered on and on this Wi-Fi? (If its IP changed, use “Find my TV again” on the TV screen.)";
  }
  return msg;
}

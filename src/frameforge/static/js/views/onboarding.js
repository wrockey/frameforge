import { api, USE_MOCK } from "../api.js";
import { escapeHtml } from "../util.js";

/* ===========================================================================
 * Onboarding
 * ========================================================================= */

let onboardingStep = 1;
let chosenTV = null;

export function enterOnboarding() {
  onboardingStep = 1;
  showOnboardingStep(1);
}

function showOnboardingStep(n) {
  onboardingStep = n;
  stopPairTimers();
  document.querySelectorAll("[data-step-pane]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.stepPane !== String(n));
  });
  document.querySelectorAll("#onboarding-steps li").forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle("active", step === n);
    li.classList.toggle("done", step < n);
  });
  if (n === 2) runDiscover();
  if (n === 3) runPairCountdown();
}

document.querySelectorAll("[data-onboarding-next]").forEach((b) =>
  b.addEventListener("click", () => showOnboardingStep(onboardingStep + 1)),
);
document.querySelectorAll("[data-onboarding-back]").forEach((b) =>
  b.addEventListener("click", () => showOnboardingStep(onboardingStep - 1)),
);

async function runDiscover() {
  const scanner = document.getElementById("discover-scanner");
  const results = document.getElementById("discover-results");
  const confirm = document.getElementById("discover-confirm");
  scanner.classList.remove("hidden");
  results.classList.add("hidden");
  confirm.classList.add("hidden");
  results.innerHTML = "";
  const tvs = await api.discover();
  scanner.classList.add("hidden");
  results.classList.remove("hidden");
  const frame = tvs.find((t) => t.is_frame);
  if (frame) {
    chosenTV = frame;
    confirm.classList.remove("hidden");
    results.innerHTML = `
      <div class="discovered-tv selected">
        <div>
          <div class="tv-frame-marker">FRAME · LS03</div>
          <div class="tv-model">${escapeHtml(frame.model_name)}</div>
          <div class="tv-meta">${frame.host} · MAC ${frame.mac}</div>
        </div>
      </div>
    `;
  } else if (tvs.length) {
    results.innerHTML = `<p class="onboarding-meta">Found ${tvs.length} Samsung TV(s), but no Frame.</p>`;
  } else {
    results.innerHTML = `<p class="onboarding-meta">Nothing on the network. Try Search again, or enter the IP manually.</p>`;
  }
}

document.getElementById("discover-rescan").addEventListener("click", runDiscover);
document.getElementById("discover-manual").addEventListener("click", () => {
  document.getElementById("manual-ip").classList.toggle("hidden");
});
/* Save the chosen host to the server (settings.json), then move to pairing. */
async function confirmTvChoice(btn) {
  if (!chosenTV) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const r = await api.setTvHost(chosenTV.host);
    if (r.env_override) {
      alert(
        "Saved, but FRAMEFORGE_TV_HOST is set in the server's environment and overrides this choice.",
      );
    }
    showOnboardingStep(3);
  } catch (err) {
    alert(`Could not save the TV: ${err.message || err}`);
  }
  btn.disabled = false;
  btn.textContent = original;
}

document.getElementById("manual-ip-go").addEventListener("click", (e) => {
  const v = document.getElementById("manual-ip-input").value.trim();
  if (!v) return;
  chosenTV = { host: v, model_name: "(manual)", mac: "", is_frame: true };
  confirmTvChoice(e.currentTarget);
});
document.getElementById("discover-confirm").addEventListener("click", (e) => {
  confirmTvChoice(e.currentTarget);
});

/* Pairing: connecting to the TV triggers the allow/deny prompt on its screen,
 * so we simply poll /api/tv/status until it reports connected. */
let pairTimers = [];

export function stopPairTimers() {
  pairTimers.forEach(clearInterval);
  pairTimers = [];
}

function runPairCountdown() {
  const text = document.getElementById("pair-countdown-text");
  const status = document.getElementById("pair-status");
  const cont = document.getElementById("pair-continue");
  stopPairTimers();
  let t = 45;
  let polling = false;
  text.textContent = t;
  cont.classList.add("hidden");
  status.textContent = "Waiting for confirmation on the TV…";
  const done = (ok) => {
    stopPairTimers();
    if (ok) {
      status.textContent = "Paired. Token saved.";
      cont.classList.remove("hidden");
    } else {
      status.textContent = "Timed out. Go back and try again, remote in hand.";
    }
  };
  const tick = setInterval(() => {
    t -= 1;
    text.textContent = t;
    if (USE_MOCK && t === 33) done(true); // demo: pretend the TV accepted
    if (t <= 0) done(false);
  }, 1000);
  pairTimers.push(tick);
  if (!USE_MOCK) {
    const poll = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const s = await api.tvStatus();
        if (s.connected) done(true);
      } catch (_) {}
      polling = false;
    }, 3000);
    pairTimers.push(poll);
  }
  cont.onclick = () => {
    stopPairTimers();
    showOnboardingStep(4);
  };
}

document.getElementById("key-toggle").addEventListener("click", () => {
  const inp = document.getElementById("api-key");
  const btn = document.getElementById("key-toggle");
  if (inp.type === "password") {
    inp.type = "text";
    btn.textContent = "hide";
  } else {
    inp.type = "password";
    btn.textContent = "show";
  }
});

document.getElementById("key-test").addEventListener("click", async () => {
  const result = document.getElementById("key-result");
  const key = document.getElementById("api-key").value.trim();
  if (!key) {
    result.textContent = "Paste a key first.";
    result.className = "key-result err";
    return;
  }
  result.textContent = "Testing…";
  result.className = "key-result";
  const r = await api.testKey(key);
  if (r.ok) {
    result.textContent = "Connection OK.";
    result.className = "key-result ok";
  } else {
    result.textContent = `Failed: ${r.message || "unknown error"}`;
    result.className = "key-result err";
  }
});

document.getElementById("key-finish").addEventListener("click", () => {
  location.hash = "#/themes";
});

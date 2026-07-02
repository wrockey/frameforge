import { api } from "../api.js";
import { escapeHtml, relativeTime } from "../util.js";

/* ===========================================================================
 * Schedule (mock-only render — endpoints are roadmap)
 * ========================================================================= */

export async function renderSchedule() {
  const schedules = await api.schedules();
  const list = document.getElementById("schedule-list");
  list.innerHTML = schedules
    .map(
      (s) => `
        <li>
          <div>
            <div>${escapeHtml(s.theme_title)}</div>
            <div class="schedule-meta">${s.cron} · next ${relativeTime(s.next_run)}</div>
          </div>
          <div>
            <span class="pill ${s.enabled ? "pill-on-tv" : ""}">${s.enabled ? "ENABLED" : "PAUSED"}</span>
          </div>
        </li>
      `,
    )
    .join("");

  // Build a simple 7-day x 6-hour grid showing schedule hits as filled cells.
  const cal = document.getElementById("week-calendar");
  cal.innerHTML = "";
  const days = ["", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  days.forEach((d, i) => {
    const div = document.createElement("div");
    if (i === 0) div.className = "day-header";
    else div.className = "day-header";
    div.textContent = d;
    cal.appendChild(div);
  });
  // 6 row buckets: 0-4, 4-8, 8-12, 12-16, 16-20, 20-24
  const labels = ["00", "04", "08", "12", "16", "20"];
  for (let row = 0; row < 6; row++) {
    const lab = document.createElement("div");
    lab.className = "hour-label";
    lab.textContent = labels[row];
    cal.appendChild(lab);
    for (let day = 0; day < 7; day++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      // mock: schedule sch_001 hits Sunday 03:00, sch_002 Wed 06:00, sch_003 Fri 22:00
      if ((day === 6 && row === 0) || (day === 2 && row === 1) || (day === 4 && row === 5)) {
        slot.classList.add("has-event");
      }
      cal.appendChild(slot);
    }
  }
}

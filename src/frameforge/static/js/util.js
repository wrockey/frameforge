/* ===========================================================================
 * Helpers
 * ========================================================================= */

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function relativeTime(iso) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3.6e6)} hr ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} day${Math.floor(diff / day) === 1 ? "" : "s"} ago`;
  if (diff < 0) return `in ${Math.floor(-diff / day)} day(s)`;
  return new Date(iso).toLocaleDateString();
}

/* JSON syntax highlighter using the .json-* classes specified in WIRING.md.
 * Walks the JSON character-by-character so that values containing entity-
 * reference characters (`&`, `<`, `>`) are escaped without confusing the
 * tokenizer. */
export function highlightJson(obj) {
  const json = JSON.stringify(obj, null, 2);
  const out = [];
  let i = 0;
  while (i < json.length) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') {
        if (json[j] === "\\") j += 2;
        else j += 1;
      }
      const str = json.slice(i, j + 1);
      let k = j + 1;
      while (k < json.length && /\s/.test(json[k])) k++;
      const cls = json[k] === ":" ? "json-key" : "json-string";
      out.push(`<span class="${cls}">${escapeHtml(str)}</span>`);
      i = j + 1;
    } else if ((c === "-" || (c >= "0" && c <= "9")) && /[\s,:\[]/.test(json[i - 1] || " ")) {
      let j = i + 1;
      while (j < json.length && /[0-9.eE+\-]/.test(json[j])) j++;
      out.push(`<span class="json-number">${escapeHtml(json.slice(i, j))}</span>`);
      i = j;
    } else if (/[{}\[\],:]/.test(c)) {
      out.push(`<span class="json-punct">${escapeHtml(c)}</span>`);
      i++;
    } else {
      out.push(escapeHtml(c));
      i++;
    }
  }
  return out.join("");
}

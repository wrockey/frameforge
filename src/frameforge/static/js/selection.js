/* Finder-style selection over a grid. The backing store is a caller-owned
 * Set (tvView.selOnTv / tvView.selLib) so existing bulk actions keep working. */

export class GridSelection {
  constructor({ set, onChange }) {
    this.set = set;
    this.onChange = onChange;
    this.order = [];
    this.anchor = null;
    this.inTouchMode = false;
  }

  setOrder(keys) {
    this.order = keys;
    if (this.anchor && !keys.includes(this.anchor)) this.anchor = null;
  }

  click(key, ev) {
    if (ev.shiftKey && this.anchor) {
      this.rangeTo(key);
    } else if (ev.metaKey || ev.ctrlKey || this.inTouchMode) {
      this.toggle(key);
    } else {
      this.set.clear();
      this.set.add(key);
      this.anchor = key;
    }
    this.onChange();
  }

  toggle(key) {
    if (this.set.has(key)) this.set.delete(key);
    else {
      this.set.add(key);
      this.anchor = key;
    }
    this.onChange();
  }

  rangeTo(key) {
    const a = this.order.indexOf(this.anchor);
    const b = this.order.indexOf(key);
    if (a === -1 || b === -1) return this.toggle(key);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.set.add(this.order[i]);
    this.onChange();
  }

  selectAll(keys) {
    keys.forEach((k) => this.set.add(k));
    this.onChange();
  }

  clear() {
    this.set.clear();
    this.anchor = null;
    this.inTouchMode = false;
    this.onChange();
  }

  enterTouchMode() {
    this.inTouchMode = true;
  }
}

const LONG_PRESS_MS = 500;

/* Tile wiring: click/⌘/shift select, dblclick or Enter opens, long-press
 * enters touch selection mode. */
export function attachTilePointerHandlers(el, key, sel, openViewer) {
  el.tabIndex = 0;
  let pressTimer = null;
  let longPressed = false;

  el.onclick = (e) => {
    if (e.target.closest("[data-act]")) return;
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (e.target.closest(".sel-box")) {
      sel.toggle(key);
      return;
    }
    if (sel.inTouchMode || e.pointerType !== "touch") {
      sel.click(key, e);
    } else {
      openViewer(); // touch tap outside selection mode = view
    }
  };
  el.ondblclick = (e) => {
    if (e.target.closest("[data-act]")) return;
    openViewer();
  };
  el.onkeydown = (e) => {
    if (e.target.closest("[data-act]")) return;
    if (e.key === "Enter") openViewer();
    if (e.key === " ") {
      e.preventDefault();
      sel.toggle(key);
    }
  };
  el.onpointerdown = (e) => {
    if (e.pointerType !== "touch") return;
    pressTimer = setTimeout(() => {
      longPressed = true;
      sel.enterTouchMode();
      sel.toggle(key);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressTimer);
  el.onpointerup = cancelPress;
  el.onpointermove = cancelPress;
  el.onpointercancel = cancelPress;
}

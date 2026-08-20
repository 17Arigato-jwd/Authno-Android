/**
 * extensionSurfaces.js — the two things an extension can put in the editor.
 *
 * Spec: docs/extension-system-v2-spec.md §4a (panels) and §8b (overlay dots).
 *
 * They are modelled together because they *are* one system. Both are
 * per-extension, both are colour-coded, and both live in the same corner of the
 * editor — specified apart, they would collide there. A collapsed panel is a
 * dot; an open panel suppresses its extension's dot, so there is never a second
 * indicator saying the same thing.
 *
 * This module holds no DOM. It answers "what should be on screen", and the
 * component draws it. That split is what makes the rules below testable:
 *
 *   - the editor's text column never drops below 45 characters, and the PANEL
 *     yields, not the editor
 *   - opening a panel never moves the caret, and only the user can open one
 *   - a panel re-renders at most 4 times a second, whatever it asks for
 *   - at most three dots, then a `+n`
 *
 * The measure floor is the one to keep if the rest is ever rewritten. A panel
 * that squeezes prose below a comfortable line length has made the app worse at
 * its only job, and a writer will not thank a word counter for it.
 */

const MAX_DOTS = 3;
const MIN_MEASURE_CHARS = 45;
const PANEL_MIN_PX = 280;
const PANEL_MAX_PX = 480;
const PANEL_DEFAULT_PX = 320;
const PHONE_MAX_PX = 720;
const RENDER_HZ = 4;

/**
 * Dot colours. Distinguishable from each other, and never the only carrier of
 * meaning — the expanded sheet names the extension in text (§8b), because a
 * colour-only indicator fails for anyone who cannot tell two of these apart.
 */
export const DOT_COLOURS = [
  '#3b7dd8', '#c8562b', '#2e8b6f', '#8a5cc4',
  '#b8892b', '#4a7fa8', '#a8477a', '#5f8f3a',
];

/**
 * A stable colour for an extension id.
 *
 * Deterministic rather than assigned in load order: a dot that changes colour
 * because a different extension happened to start first is a dot nobody can
 * learn. FNV-1a, because it only has to be stable and well spread.
 */
export function colourFor(extId) {
  let h = 0x811c9dc5;
  const s = String(extId ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return DOT_COLOURS[h % DOT_COLOURS.length];
}

/**
 * Can a panel dock without pushing the text column below the floor?
 *
 * Returns what the layout should do, not a boolean, because there are three
 * answers and the third is the interesting one: a phone does not dock at all,
 * it presents a sheet.
 */
export function panelPlacement({ viewportPx, charPx = 8.5, panelPx = PANEL_DEFAULT_PX }) {
  const width = Number(viewportPx) || 0;

  if (width < PHONE_MAX_PX) {
    // No phone is wide enough to hold a panel beside a text column and leave
    // either usable, so the panel becomes a sheet over the bottom of the
    // editor. Same frame, same API — the extension does not choose.
    return { mode: 'sheet', panelPx: width, detents: [120, Math.round(width * 0.5)] };
  }

  const wanted = Math.min(PANEL_MAX_PX, Math.max(PANEL_MIN_PX, Number(panelPx) || PANEL_DEFAULT_PX));
  const measureAfter = (width - wanted) / charPx;
  if (measureAfter >= MIN_MEASURE_CHARS) {
    return { mode: 'dock', panelPx: wanted, measureChars: Math.floor(measureAfter) };
  }

  // Try the panel at its minimum before giving up on docking at all.
  const atMin = (width - PANEL_MIN_PX) / charPx;
  if (atMin >= MIN_MEASURE_CHARS) {
    return { mode: 'dock', panelPx: PANEL_MIN_PX, measureChars: Math.floor(atMin) };
  }

  // The panel yields, not the editor. It collapses to its dot rather than
  // shrinking further or overlaying the text column.
  return { mode: 'collapsed', panelPx: 0, measureChars: Math.floor(width / charPx) };
}

export const SURFACE_LIMITS = {
  MAX_DOTS, MIN_MEASURE_CHARS, PANEL_MIN_PX, PANEL_MAX_PX, PANEL_DEFAULT_PX, PHONE_MAX_PX, RENDER_HZ,
};

/**
 * The editor's extension chrome: which dots show, which panel is open.
 *
 * @param {object}   [o]
 * @param {Function} [o.now]
 * @param {Function} [o.onChange]  called when what should be on screen changes
 */
export function createSurfaces({ now = () => Date.now(), onChange = null } = {}) {
  /** extId → { text, at } */
  const overlays = new Map();
  /** extId → { panelId, lastRenderAt, pendingRender } */
  const panels = new Map();

  let openPanel = null;      // { extId, panelId } — at most one, ever
  let lastOpen = null;       // restored on next launch

  /**
   * Listeners, plus the constructor's onChange for callers that build their
   * own instance.
   *
   * `surfaces()` takes no options and returns whatever already exists, so a
   * component that could only be told about changes by CONSTRUCTING the
   * singleton would never be told about anything — the first extension to set
   * an overlay creates it, and that happens at activation, before the editor
   * has mounted. subscribe() is how a component joins one it did not make.
   */
  const listeners = new Set();
  const notify = () => {
    if (onChange) { try { onChange(); } catch { /* the UI's problem */ } }
    for (const fn of listeners) { try { fn(); } catch { /* one listener's */ } }
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    // ── Overlay (§8b) ────────────────────────────────────────────────────────

    /** An extension sets its one line. The host owns colour and position. */
    setOverlay(extId, text) {
      const line = String(text ?? '').slice(0, 120);
      if (!line) return this.clearOverlay(extId);
      overlays.set(String(extId), { text: line, at: now() });
      notify();
      return true;
    },

    clearOverlay(extId) {
      const had = overlays.delete(String(extId));
      if (had) notify();
      return had;
    },

    /**
     * What the corner should draw.
     *
     * An extension whose panel is open gets no dot: one indicator per
     * extension, never two saying the same thing (§4a.6).
     */
    dots() {
      const all = [...overlays.entries()]
        .filter(([extId]) => !(openPanel && openPanel.extId === extId))
        .map(([extId, o]) => ({
          extId,
          text: o.text,
          colour: colourFor(extId),
          // The dot draws at 8dp; the touch target is 48dp. Carried here so a
          // component cannot quietly use the visual size for both.
          sizeDp: 8,
          targetDp: 48,
          // Never colour alone: the sheet names the extension, and the dot
          // carries this for a screen reader.
          label: `${extId}: ${o.text}`,
        }));

      const shown = all.slice(0, MAX_DOTS);
      return {
        shown,
        overflow: Math.max(0, all.length - MAX_DOTS),
        total: all.length,
      };
    },

    // ── Panels (§4a) ─────────────────────────────────────────────────────────

    /**
     * Open a panel. `bySystem` exists so the rule can be enforced rather than
     * documented: an extension that could raise a panel mid-sentence would eat
     * the keystrokes typed into it, so only a user action opens one.
     */
    openPanel(extId, panelId, { bySystem = false } = {}) {
      if (bySystem) return { ok: false, reason: 'only-user-can-open' };
      const id = String(extId);
      openPanel = { extId: id, panelId: String(panelId) };
      lastOpen = { ...openPanel };
      if (!panels.has(id)) panels.set(id, { lastRenderAt: null });
      notify();
      // The caret does not move. Stated in the return so a component that
      // forgets is contradicting an explicit contract rather than an omission.
      return { ok: true, moveFocus: false, open: { ...openPanel } };
    },

    closePanel() {
      if (!openPanel) return false;
      openPanel = null;
      notify();
      return true;
    },

    /** Pressing the button of the panel already open closes it. */
    togglePanel(extId, panelId) {
      if (openPanel && openPanel.extId === String(extId) && openPanel.panelId === String(panelId)) {
        this.closePanel();
        return { ok: true, open: null, moveFocus: false };
      }
      return this.openPanel(extId, panelId);
    },

    /** Only one panel is visible at a time; buttons swap rather than stack. */
    open() { return openPanel ? { ...openPanel } : null; },
    lastOpened() { return lastOpen ? { ...lastOpen } : null; },

    /** Restore on launch, if that panel's extension is still installed. */
    restore(installedIds) {
      if (!lastOpen) return null;
      const ids = new Set((installedIds ?? []).map(String));
      if (!ids.has(lastOpen.extId)) { lastOpen = null; return null; }
      openPanel = { ...lastOpen };
      notify();
      return { ...openPanel };
    },

    /**
     * May this panel re-render now?
     *
     * Host-throttled to 4 Hz whatever the panel asks for, and paused entirely
     * while collapsed or closed. The canonical panel is live statistics, and
     * the naive version puts an extension's render on the typing path.
     */
    mayRender(extId, { collapsed = false } = {}) {
      const id = String(extId);
      if (!openPanel || openPanel.extId !== id) return false;
      if (collapsed) return false;

      // `null`, not 0: a panel that has never rendered must render at once.
      // Initialising to 0 refused the FIRST render whenever the clock was near
      // zero, which on a fresh session is every time — a panel that opened
      // blank and stayed blank for a quarter of a second.
      const state = panels.get(id) ?? { lastRenderAt: null };
      const at = now();
      if (state.lastRenderAt !== null && at - state.lastRenderAt < 1000 / RENDER_HZ) return false;
      state.lastRenderAt = at;
      panels.set(id, state);
      return true;
    },

    /** Everything an extension owns here, dropped when it stops. */
    forget(extId) {
      const id = String(extId);
      overlays.delete(id);
      panels.delete(id);
      if (openPanel && openPanel.extId === id) openPanel = null;
      if (lastOpen && lastOpen.extId === id) lastOpen = null;
      notify();
    },

    reset() {
      overlays.clear();
      panels.clear();
      openPanel = null;
      lastOpen = null;
    },
  };
}

let shared = null;
export function surfaces() {
  if (!shared) shared = createSurfaces();
  return shared;
}
export function __resetSurfaces() {
  if (shared) shared.reset();
  shared = null;
}

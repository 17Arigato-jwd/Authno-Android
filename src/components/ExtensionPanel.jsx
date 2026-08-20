/**
 * ExtensionPanel.jsx — an extension beside the editor, without costing the editor.
 *
 * `extensionSurfaces.panelPlacement()` decides dock, sheet or collapsed from
 * the viewport width and nothing else. This draws that decision. The rule it
 * exists to protect is the one worth restating every time this file is opened:
 *
 *   **The panel yields, not the editor.** Below 45 characters of measure the
 *   panel collapses to its dot rather than shrinking further or overlaying the
 *   text column. A panel that squeezes prose below a comfortable line length
 *   has made the app worse at its only job, and a writer will not thank a word
 *   counter for it.
 *
 * Two more the model owns and this must not undo:
 *
 *   - **Opening never moves the caret.** `openPanel` returns `moveFocus:
 *     false` explicitly so a component that steals focus is contradicting a
 *     stated contract rather than filling a gap. Nothing here calls `focus()`.
 *   - **Only a user action opens one.** The model refuses `bySystem`, so an
 *     extension cannot raise a panel mid-sentence and eat the keystrokes.
 *
 * The panel body is `ExtensionPage` in `inline` mode — the same loader, the
 * same sandboxed frame, the same permission checks as a full page. A panel is
 * a page in a narrower box, and giving it its own loader would be a second
 * place for the frame's policy to be got wrong.
 */

import { useCallback, useEffect, useState } from 'react';
import { DSIcons, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../DesignSystem';
import { useExtensions } from '../utils/ExtensionContext';
import { surfaces, panelPlacement, colourFor, SURFACE_LIMITS } from '../utils/extensionSurfaces';
import ExtensionPage from './ExtensionPage';

/**
 * How wide a character actually is, in the font the editor is set in.
 *
 * The measure floor is expressed in CHARACTERS — 45 of them — and
 * `panelPlacement` divides pixels by a per-character width to check it. Its
 * default is 8.5, which is roughly right for the app's body size in its own
 * font and wrong for everybody who has changed either.
 *
 * That is not a rounding error. A reader at 1.5x text has characters half
 * again as wide, so a panel the default arithmetic says leaves 52 characters
 * actually leaves 35 — below the floor, on the screen of the person the floor
 * exists to protect. Measuring makes the rule true rather than approximately
 * true.
 *
 * Measured off the editor element itself — it carries its own `--font-editor`
 * and its own font size, both of which the reader chooses and neither of which
 * matches the app's body text. Falls back to `body` when the editor is not on
 * screen, which is the case wherever a panel is open outside it.
 *
 * A sample rather than one glyph: proportional fonts make "0" and "i" differ
 * by a factor of three, and prose is neither.
 */
/** Exported so a test can compute an exact per-character width from it. */
export const CHAR_SAMPLE = 'The quick brown fox jumps over the lazy dog and again';
const SAMPLE = CHAR_SAMPLE;

function useCharWidth(selector = '[data-tour="editor"], body') {
  const [px, setPx] = useState(8.5);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const measure = () => {
      const host = document.querySelector(selector) ?? document.body;
      if (!host) return;
      // Null for a detached element in some engines, and undefined whenever a
      // test stands it in. A measurement is an optimisation over the default,
      // not something worth throwing from a layout effect for.
      const cs = window.getComputedStyle?.(host);
      if (!cs) return;

      const probe = document.createElement('span');
      probe.textContent = SAMPLE;
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0;';
      probe.style.font = cs.font || `${cs.fontSize ?? ''} ${cs.fontFamily ?? ''}`.trim();
      if (cs.letterSpacing) probe.style.letterSpacing = cs.letterSpacing;
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / SAMPLE.length;
      probe.remove();
      // A measurement of zero means the probe never laid out — a hidden
      // container, or jsdom, which reports 0 for everything. Keeping the
      // default beats dividing by nothing.
      if (w > 0) setPx(w);
    };

    measure();
    // Re-measured on resize because a font-size in vw, a container query or a
    // rotation all change it, and none of them fire a font event.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [selector]);

  return px;
}

/** The viewport, watched. Placement is a pure function of it. */
function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    // Rotating a tablet changes the mode, not just the width — a docked panel
    // becomes a sheet — so this has to be live rather than read once.
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return w;
}

function PanelHeader({ title, accent, onClose }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SPACING.sm,
      padding: `${SPACING.sm}px ${SPACING.md}px`,
      borderBottom: `1px solid ${COLORS.border}`,
      flexShrink: 0,
    }}>
      <span aria-hidden="true" style={{
        width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0,
      }} />
      <span style={{
        flex: 1, minWidth: 0,
        fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.semibold,
        color: COLORS.textSecondary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{title}</span>
      <button
        onClick={onClose}
        aria-label={`Close ${title}`}
        style={{
          // 44 square. A close button that is hard to hit on the one surface
          // sitting next to somebody's writing is the worst place to save space.
          width: 44, height: 44, marginRight: -SPACING.sm,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: 'transparent', color: COLORS.textSubtle,
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <DSIcons.X size={16} />
      </button>
    </div>
  );
}

export default function ExtensionPanel({ accentHex = COLORS.violetDark, session = null }) {
  const { extensions } = useExtensions();
  const [, forceRender] = useState(0);
  const width = useViewportWidth();
  const charPx = useCharWidth();

  useEffect(() => surfaces().subscribe(() => forceRender((n) => n + 1)), []);

  const open = surfaces().open();
  const close = useCallback(() => { surfaces().closePanel(); }, []);

  // Escape closes it. A panel is not a modal — it does not trap focus — but it
  // is the frontmost thing an extension put on screen, and Escape is what a
  // person reaches for.
  useEffect(() => {
    if (!open) return undefined;
    const on = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open, close]);

  if (!open) return null;

  const extension = extensions.find((e) => String(e.id) === open.extId);
  // The extension went away — uninstalled, or disabled — while its panel was
  // open. Closing rather than drawing an empty box.
  if (!extension) {
    surfaces().closePanel();
    return null;
  }

  const placement = panelPlacement({ viewportPx: width, charPx });

  // Collapsed is not "draw a narrow panel". It is the panel giving up its
  // space entirely; the dot in the corner is what remains, and ExtensionDots
  // already draws that.
  if (placement.mode === 'collapsed') return null;

  const accent = colourFor(open.extId);
  const pageDef = extension.pages?.[open.panelId] ?? extension.contributes?.pages?.[open.panelId];
  const title = pageDef?.title ?? extension.name ?? open.extId;

  const body = (
    <>
      <PanelHeader title={title} accent={accent} onClose={close} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ExtensionPage
          extension={extension}
          pageId={open.panelId}
          session={session}
          accentHex={accentHex}
          onBack={close}
          inline
        />
      </div>
    </>
  );

  if (placement.mode === 'sheet') {
    return (
      <div
        role="complementary"
        aria-label={title}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 110,
          height: `${placement.detents[placement.detents.length - 1]}px`,
          maxHeight: '60vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface, rgba(20,20,26,0.98))',
          borderTop: `1px solid ${COLORS.border}`,
          borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
          boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {body}
      </div>
    );
  }

  // Docked. `panelPx` is what the model decided the editor can spare, which is
  // not always what the panel asked for — it is capped so the measure floor
  // holds. Using it as a fixed width rather than a flex basis means nothing
  // downstream can negotiate it back up.
  return (
    <aside
      aria-label={title}
      style={{
        width: placement.panelPx, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        minHeight: 0, height: '100%',
        borderLeft: `1px solid ${COLORS.border}`,
        background: 'var(--surface, rgba(255,255,255,0.02))',
      }}
    >
      {body}
    </aside>
  );
}

/** Exported for the tests, so the measure floor is asserted rather than trusted. */
export const PANEL_LIMITS = SURFACE_LIMITS;

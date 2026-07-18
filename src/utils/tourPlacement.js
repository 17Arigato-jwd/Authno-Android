/**
 * tourPlacement.js — where a tour/coach card sits relative to its spotlight.
 *
 * The hard rule (author feedback): the card must NEVER cover the thing it's
 * pointing at. So instead of "below the target, clamped" (which overlaps the
 * moment the target is tall or centred), we look for a gutter — the free band
 * on each side of the hole — and drop the card into the first one that fully
 * fits. Order of preference: below, right, left, above.
 *
 * If the hole is so large that no gutter can hold the card (an open full-screen
 * form, the editor page), there is nothing to sit beside — so we switch to
 * "float": a compact card tucked into a corner with NO dimming, leaving the
 * content fully visible and usable. Reading/writing steps ask for this mode
 * directly via `float`.
 *
 * Returns { style, dim }:
 *   style — the fixed-position style object for the card
 *   dim   — whether the caller should render the dark overlay + spotlight hole
 */
export function computeTourCard({ hole, cardW, cardH, vw, vh, float }) {
  const M = 12;    // viewport margin
  const GAP = 14;  // breathing room between hole and card

  // Reading / writing / large-form steps: never dim, dock a compact card in
  // the bottom-right corner (ragged line-ends of LTR text, away from the
  // primary bottom-centre actions of most forms).
  if (float) {
    return { style: { position: 'fixed', right: 16, bottom: 16, width: cardW }, dim: false };
  }

  // No target → centred card over a dimmed screen.
  if (!hole) {
    return {
      style: { position: 'fixed', top: Math.max(M, (vh - cardH) / 2), left: Math.max(M, (vw - cardW) / 2), width: cardW },
      dim: true,
    };
  }

  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const clampX = (x) => Math.max(M, Math.min(x, vw - cardW - M));
  const clampY = (y) => Math.max(M, Math.min(y, vh - cardH - M));
  const holeBottom = hole.top + hole.height;
  const holeRight = hole.left + hole.width;

  // Below the hole
  if (holeBottom + GAP + cardH <= vh - M) {
    return { style: { position: 'fixed', top: holeBottom + GAP, left: clampX(cx - cardW / 2), width: cardW }, dim: true };
  }
  // Right of the hole
  if (holeRight + GAP + cardW <= vw - M) {
    return { style: { position: 'fixed', top: clampY(cy - cardH / 2), left: holeRight + GAP, width: cardW }, dim: true };
  }
  // Left of the hole
  if (hole.left - GAP - cardW >= M) {
    return { style: { position: 'fixed', top: clampY(cy - cardH / 2), left: hole.left - GAP - cardW, width: cardW }, dim: true };
  }
  // Above the hole
  if (hole.top - GAP - cardH >= M) {
    return { style: { position: 'fixed', top: hole.top - GAP - cardH, left: clampX(cx - cardW / 2), width: cardW }, dim: true };
  }

  // Nothing fits beside it — the spotlight fills the screen. Drop the dim (so
  // the content isn't double-obscured by shade AND card) and float the card
  // into whichever corner sits furthest from the hole's centre of mass.
  const preferBottom = (vh - holeBottom) >= hole.top;
  const preferRight = (vw - holeRight) >= hole.left;
  return {
    style: {
      position: 'fixed', width: cardW,
      left: preferRight ? undefined : 16,
      right: preferRight ? 16 : undefined,
      top: preferBottom ? undefined : 16,
      bottom: preferBottom ? 16 : undefined,
    },
    dim: false,
  };
}

#!/usr/bin/env node
/**
 * check-theme-tokens.mjs — the two ways a themed token stops being a colour.
 *
 * v1.1.16 repointed the DesignSystem's colour tokens at CSS variables so the
 * whole system would follow the active theme. Two things did not survive the
 * change, and both failed silently — no error, no warning, just an element
 * painted in nothing:
 *
 *   1. `${COLORS.danger}1a` — appending a hex alpha to a token. That is fine
 *      for a literal (`#ed4245` + `1a`) and meaningless for a variable
 *      (`var(--ds-danger, #ed4245)1a`), so CSS drops the declaration. Every
 *      badge, pill and danger button built that way was transparent.
 *
 *   2. A hardcoded neutral panel under themed text. FrostedModal, BottomSheet
 *      and Toast each painted a near-black ground while their contents used
 *      COLORS.textPrimary, which on Sepia or Paper is near-black too. The
 *      error log did the same in hex rather than rgba(), which is how it
 *      survived the first version of this check.
 *
 *   3. A var() nothing defines. --onb-* was eleven names and 57 references
 *      across the gate and the rescue screen with not one definition, so the
 *      inline fallbacks were the only values that existed — and they drifted
 *      until --onb-border meant four different alphas. --text-6 had no
 *      fallback at all, so the declaration was simply dropped.
 *
 * None of these is visible in the dark default, which is where everything
 * gets looked at, so all of them survived a release. This is the cheap
 * standing guard.
 *
 * Usage: node scripts/check-theme-tokens.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** Token keys whose value is a var() — the ones alpha cannot be appended to. */
const THEMED = (() => {
  const text = fs.readFileSync(path.join(SRC, 'DesignSystem/tokens.js'), 'utf8');
  const block = text.slice(text.indexOf('export const COLORS'), text.indexOf('export const GRADIENTS'));
  const keys = new Set();
  for (const m of block.matchAll(/^\s*([A-Za-z0-9]+):\s*'var\(/gm)) keys.add(m[1]);
  return keys;
})();

/**
 * Files whose whole job is to be an overlay panel. A hardcoded rgba() ground
 * anywhere else is usually a coloured tint (a danger wash, a highlight) and
 * those work on both themes; it is specifically the greys that break.
 */
/**
 * Files where a literal colour is the point, not a mistake.
 *
 * A theme file is a list of literal colours by definition — that is what a
 * theme is. tokens.js holds the brand hues and the pre-hydration fallbacks.
 * Backgrounds/ draws generative art from its own palettes.
 */
const OWNS_ITS_COLOURS = (p) =>
  (/theme\/Theme[A-Za-z]*\.js$/.test(p) && !/ThemeBase\.js$/.test(p))
  || /DesignSystem\/tokens\.js$/.test(p)
  || p.includes(`${path.sep}Backgrounds${path.sep}`);

/** Every source file, including the ones above. */
const walkAll = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walkAll(p);
  return /\.(jsx?|mjs|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
});

/** The ones a hardcoded colour is a finding in. */
const walk = (dir) => walkAll(dir).filter((p) => /\.(jsx?|mjs)$/.test(p) && !OWNS_ITS_COLOURS(p));

/**
 * The rgb of a hardcoded background on this line, or null.
 *
 * Both notations, because the first version of this check only read rgba()
 * and the error log's `background: "#0f0f1a"` walked straight past it.
 */
function readGround(line) {
  const fn = /(?:background|backgroundColor):\s*['"]rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(line);
  if (fn) return [fn[1], fn[2], fn[3]].map(Number);
  const hx = /(?:background|backgroundColor):\s*['"](#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)['"]/.exec(line);
  if (!hx) return null;
  let h = hx[1].slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const problems = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');

  src.split('\n').forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;

    // 1. Alpha appended to a var()-backed token.
    for (const m of line.matchAll(/\$\{COLORS\.([A-Za-z0-9]+)\}([0-9a-fA-F]{2})\b/g)) {
      if (THEMED.has(m[1])) {
        problems.push(`${at}  \${COLORS.${m[1]}}${m[2]} — COLORS.${m[1]} is a var(); `
          + `appending alpha makes it invalid CSS and the element paints nothing. `
          + `Use a finished token (${m[1]}Soft / ${m[1]}Line / ${m[1]}Fill) instead.`);
      }
    }

    // 2. A grey panel ground, written either way. Colours are fine — they
    //    read on both themes — so only near-neutral fills count, and only as
    //    a background.
    const rgb = readGround(line);
    if (rgb) {
      const [r, g, b] = rgb;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // Pure white and pure black are the shared idiom for a scrim or a tint
      // that a component legitimately owns; it is the *chosen* dark grey that
      // means "panel", and that is what has to follow the theme.
      const neutralGrey = spread <= 24 && !(r === g && g === b && (r === 0 || r === 255));
      if (neutralGrey) {
        problems.push(`${at}  background: rgb(${r},${g},${b}) — a hardcoded panel ground. `
          + `Themed text is painted on this, so it has to follow the theme too: `
          + `use COLORS.panel / COLORS.sheet / COLORS.toast.`);
      }
    }
  });
}

// ── 3. Every var(--x) somebody asks for is a var(--x) somebody sets ────────
//
// A CSS custom property that nothing defines does not error. With a fallback
// it silently becomes the fallback, which is how --onb-border came to mean
// four different alphas at eleven call sites; without one the whole
// declaration is dropped and the element inherits, which is what --text-6 did
// to the disabled chapter arrows.
{
  const text = walkAll(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const used = new Set([...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const set = new Set([
    ...[...text.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]),
    ...[...text.matchAll(/setProperty\(\s*['"](--[\w-]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/['"](--[\w-]+)['"]\s*[,:]/g)].map((m) => m[1]),
  ]);
  for (const v of [...used].sort()) {
    if (set.has(v)) continue;
    const bare = new RegExp(`var\\(${v}\\)`).test(text);
    problems.push(`var(${v}) — referenced, never defined. `
      + (bare
        ? `At least one site passes no fallback, so the declaration is dropped entirely `
          + `and the element inherits whatever is above it.`
        : `Every site falls back to its own inline value, which is how one name `
          + `comes to mean several different things.`));
  }
}

if (problems.length) {
  console.error(`✖ ${problems.length} themed-token problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`✔ no alpha appended to var() tokens, no hardcoded panel grounds, `
  + `no undefined CSS variables (${THEMED.size} themed keys)`);

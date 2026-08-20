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
 *   2. A hardcoded rgba() panel under themed text. FrostedModal, BottomSheet
 *      and Toast each painted a near-black ground while their contents used
 *      COLORS.textPrimary, which on Sepia or Paper is near-black too.
 *
 * Neither is visible in the dark default, which is where everything gets
 * looked at, so both survived a release. This is the cheap standing guard.
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
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return /\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
});

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

    // 2. A grey rgba() panel ground. Colours are fine — they read on both
    //    themes — so only near-neutral fills count, and only as a background.
    const bg = /(?:background|backgroundColor):\s*'rgba\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\)'/.exec(line);
    if (bg) {
      const [r, g, b] = [bg[1], bg[2], bg[3]].map(Number);
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      // Pure white and pure black are the shared idiom for a scrim or a tint
      // that a component legitimately owns; it is the *chosen* dark grey that
      // means "panel", and that is what has to follow the theme.
      const neutralGrey = spread <= 12 && !(r === g && g === b && (r === 0 || r === 255));
      if (neutralGrey) {
        problems.push(`${at}  background: rgba(${r},${g},${b},…) — a hardcoded panel ground. `
          + `Themed text is painted on this, so it has to follow the theme too: `
          + `use COLORS.panel / COLORS.sheet / COLORS.toast.`);
      }
    }
  });
}

if (problems.length) {
  console.error(`✖ ${problems.length} themed-token problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`✔ no alpha appended to var() tokens, no hardcoded panel grounds (${THEMED.size} themed keys)`);

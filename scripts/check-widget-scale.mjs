#!/usr/bin/env node
/**
 * check-widget-scale.mjs — do the home-screen widgets use the app's own scale?
 *
 * The widget layouts already reference `@color/ds_*`, and there is a comment in
 * each saying colours must come from the design system. Type, spacing and radii
 * were never given the same treatment, so they drifted to whatever looked right
 * at the time: 10sp, 14dp, 5dp, 3dp, 7dp, 12dp radius — none of which exist
 * anywhere in tokens.js.
 *
 * That is the specific way a widget ends up looking like the app and worse than
 * it. Same palette, different proportions. Nobody can point at the mistake
 * because there is no single mistake; there are twenty small ones.
 *
 * So the scale is checked the way the colours already are. Values are compared
 * against tokens.js directly, so the two cannot drift apart.
 *
 * Usage: node scripts/check-widget-scale.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUTS = join(root, 'android/app/src/main/res/layout');
const DRAWABLES = join(root, 'android/app/src/main/res/drawable');

const RED = '\x1b[31m', GREEN = '\x1b[32m', YEL = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';

/** Read the scale straight from tokens.js, so this cannot go stale. */
function tokens() {
  const src = readFileSync(join(root, 'src/DesignSystem/tokens.js'), 'utf8');
  const grab = (re) => {
    const m = src.match(re);
    if (!m) throw new Error(`could not read ${re} from tokens.js`);
    return [...m[1].matchAll(/(\w+):\s*(\d+)/g)].map((x) => Number(x[2]));
  };
  return {
    size: grab(/size:\s*\{([^}]*)\}/),
    spacing: grab(/export const SPACING = \{([^}]*)\}/),
    radius: grab(/export const RADIUS = \{([^}]*)\}/),
  };
}

const T = tokens();
const onScale = (v, scale) => scale.includes(v);

/** Values allowed regardless: 0, and hairlines a scale does not describe. */
const ALWAYS_OK = new Set([0, 1, 2]);

const files = readdirSync(LAYOUTS)
  .filter((f) => /widget/i.test(f) && f.endsWith('.xml'))
  .map((f) => join(LAYOUTS, f))
  .concat(readdirSync(DRAWABLES)
    .filter((f) => /widget/i.test(f) && f.endsWith('.xml'))
    .map((f) => join(DRAWABLES, f)));

let problems = 0;
const summary = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Attribute values only — never the comments, which discuss the very numbers
  // being replaced and would otherwise report themselves.
  const body = src.replace(/<!--[\s\S]*?-->/g, '');
  const rel = file.slice(root.length + 1);
  const found = [];

  for (const [, attr, num] of body.matchAll(/android:(\w+)="(\d+(?:\.\d+)?)sp"/g)) {
    const v = Number(num);
    // A step granularity is how finely autosize may search between the min and
    // the max. It is not a size anything is ever rendered at, so it has no
    // business being on a type scale — 1sp is exactly right and would be
    // reported as three steps below the smallest real size.
    if (attr === 'autoSizeStepGranularity') continue;
    if (!onScale(v, T.size)) found.push({ kind: 'text', attr, v, near: nearest(v, T.size) });
  }

  for (const [, attr, num] of body.matchAll(/android:(\w+)="(\d+(?:\.\d+)?)dp"/g)) {
    const v = Number(num);
    if (ALWAYS_OK.has(v)) continue;
    const scale = /radius/i.test(attr) ? T.radius : T.spacing;
    // Icon and control sizes are laid out on the spacing scale too; a widget
    // has no separate size ramp and inventing one is how this started.
    if (!onScale(v, scale)) {
      found.push({ kind: /radius/i.test(attr) ? 'radius' : 'space', attr, v, near: nearest(v, scale) });
    }
  }

  if (found.length) {
    problems += found.length;
    summary.push([rel, found]);
  }
}

function nearest(v, scale) {
  return scale.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

console.log('Widget layouts against the design system scale\n');
console.log(`${DIM}text  ${T.size.join(', ')}${OFF}`);
console.log(`${DIM}space ${T.spacing.join(', ')}${OFF}`);
console.log(`${DIM}radii ${T.radius.join(', ')}${OFF}\n`);

for (const [rel, found] of summary) {
  console.log(`${YEL}${rel}${OFF}`);
  const byValue = new Map();
  for (const f of found) {
    const key = `${f.kind}:${f.v}:${f.near}`;
    byValue.set(key, (byValue.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...byValue.entries()].sort()) {
    const [kind, v, near] = key.split(':');
    const unit = kind === 'text' ? 'sp' : 'dp';
    console.log(`  ${kind.padEnd(6)} ${String(v + unit).padEnd(7)} ×${String(count).padEnd(3)} ${DIM}→ nearest on scale: ${near}${unit}${OFF}`);
  }
  console.log('');
}

if (problems) {
  console.log(`${RED}${problems} off-scale value(s) across ${summary.length} file(s).${OFF}`);
  console.log('Same palette, different proportions — which is what makes a widget');
  console.log('look like the app and worse than it.');
  process.exit(1);
}
console.log(`${GREEN}Every widget dimension is on the design system scale.${OFF}`);

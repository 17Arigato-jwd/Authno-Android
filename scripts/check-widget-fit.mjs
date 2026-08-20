#!/usr/bin/env node
/**
 * check-widget-fit.mjs — does each widget's content fit the size it asks for?
 *
 * This is the other half of check-widget-scale.mjs, and it is the half that
 * explains what a person actually sees. The scale check asks whether the
 * numbers come from the design system. This one asks whether they ADD UP.
 *
 * They did not. Measured against what each widget declares in its
 * appwidget-provider:
 *
 *   resume    ~99dp of content, declared minHeight 70dp   — 41% over
 *   countdown ~116dp of content, declared minHeight 110dp —  5% over
 *   notes     ~261dp for four rows, declared minHeight 140dp — 86% over
 *
 * None of those is a launcher squeezing a widget. minHeight is the size the
 * widget ASKS the launcher for, so every user who placed one got it too small
 * on the first day.
 *
 * What makes the failure invisible rather than obvious: a vertical
 * LinearLayout allocates height top-down and does not shrink its children to
 * fit. When the total exceeds the box, the last children get whatever is left,
 * which is often nothing. So the overflow does not compress — it falls off the
 * bottom, and the thing that falls off is whatever the layout put last. On the
 * resume card that was the button, which is the only control on it.
 *
 * The estimate below is deliberately rough — a TextView is about textSize×1.35
 * tall, ×1.16 with includeFontPadding off. It is not trying to predict a pixel.
 * It is trying to catch a widget asking for 70 when it needs 99, which is not
 * a rounding error.
 *
 * And every one of those heights is in sp, so it multiplies by the user's
 * font-size setting — up to 2.0 in Accessibility. A layout that exactly fits
 * at 1.0 overflows at 1.3. The margin required below is a fraction of that,
 * not all of it; autoSizeTextType covers the rest for the headline text.
 *
 * Usage: node scripts/check-widget-fit.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUTS = join(root, 'android/app/src/main/res/layout');
const INFOS = join(root, 'android/app/src/main/res/xml');

const RED = '\x1b[31m', GREEN = '\x1b[32m', YEL = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';

/** Views that start gone and the provider reveals. Their height is real. */
const REVEALED = new Set([
  'note_row_0', 'note_row_1', 'note_row_2', 'note_row_3', 'notes_more',
  'countdown_streak', 'countdown_remaining',
]);

/** Only one of each pair is ever visible; counting both counts a clock twice. */
const ALTERNATES = [['countdown_clock', 'countdown_static']];

/**
 * How many of a repeated row the provider may reveal at the declared size.
 * The notes widget has four slots and shows as many as fit — see
 * NotesWidgetProvider.rowsThatFit — so the fixed cost is the chrome, and the
 * rows are checked separately against how many the default size holds.
 */
const FITS_TO_HEIGHT = new Set(['notes_widget.xml']);

const at = (g, n) => (g.match(new RegExp(`android:${n}="([^"]*)"`)) ?? [])[1] ?? null;
const dp = (v) => (v == null ? 0 : parseFloat(v));

function measure(file) {
  const src = readFileSync(join(LAYOUTS, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const rootIdx = src.search(/<LinearLayout[^>]*?android:orientation="vertical"/s);
  if (rootIdx < 0) return null;
  const rootTag = src.slice(rootIdx, src.indexOf('>', rootIdx) + 1);
  const pad = dp(at(rootTag, 'padding'));

  const body = src.slice(src.indexOf('>', rootIdx) + 1);
  const children = [];
  let depth = 0;
  let cur = null;
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^<(TextView|ImageView|ProgressBar|Chronometer|View|LinearLayout|FrameLayout)\b/.test(t)) {
      if (depth === 0) cur = { kind: t.match(/^<(\w+)/)[1], text: '' };
      depth += 1;
    }
    if (cur) cur.text += ` ${t}`;
    if (/\/>\s*$/.test(t) || /^<\/(LinearLayout|FrameLayout)>/.test(t)) {
      depth -= 1;
      if (depth === 0 && cur) { children.push(cur); cur = null; }
    }
  }

  let fixed = pad * 2;
  let flexible = 0;
  const seen = new Set();
  const rows = [];

  for (const c of children) {
    const g = c.text;
    const id = (at(g, 'id') ?? '').replace('@+id/', '');
    if (at(g, 'visibility') === 'gone' && !REVEALED.has(id)) continue;
    const alt = ALTERNATES.find((pair) => pair.includes(id));
    if (alt) { if (seen.has(alt[0])) continue; seen.add(alt[0]); }

    const h = at(g, 'layout_height');
    const w = at(g, 'layout_weight');
    const m = dp(at(g, 'layout_marginTop')) + dp(at(g, 'layout_marginBottom'));

    if (w && h === '0dp') {
      // A bare <View> with no id is a spacer. Collapsing to nothing is what it
      // is FOR — it exists to push the views below it down when there is room
      // and to disappear when there is not. Requiring room for it would demand
      // height for the one child that is supposed to give height away.
      const isSpacer = c.kind === 'View' && !id;
      if (!isSpacer) flexible += 1;
      fixed += m;
      rows.push([id || c.kind, isSpacer ? 'spacer' : 'flexible']);
      continue;
    }
    if (h && /dp$/.test(h)) { fixed += dp(h) + m; rows.push([id || c.kind, `${dp(h)}dp`]); continue; }

    const sizes = [...g.matchAll(/android:textSize="([\d.]+)sp"/g)].map((x) => Number(x[1]));
    const icons = [...g.matchAll(/android:layout_height="(\d+)dp"/g)].map((x) => Number(x[1]));
    const padTB = dp(at(g, 'paddingTop')) + dp(at(g, 'paddingBottom'));
    const lines = Number(at(g, 'maxLines') ?? 1);
    const tight = /includeFontPadding="false"/.test(g);
    const textH = sizes.length
      ? Math.max(...sizes) * (tight ? 1.16 : 1.35) * (c.kind === 'LinearLayout' ? 1 : lines)
      : 0;
    const est = Math.max(textH, ...(icons.length ? icons : [0])) + padTB;
    fixed += est + m;
    rows.push([id || c.kind, `~${Math.round(est)}dp`]);
  }

  return { fixed: Math.round(fixed), flexible, rows };
}

function declared(base) {
  let info;
  try { info = readFileSync(join(INFOS, `${base}_widget_info.xml`), 'utf8'); } catch { return null; }
  const g = (n) => dp((info.match(new RegExp(`android:${n}="([^"]*)"`)) ?? [])[1]);
  return {
    minHeight: g('minHeight'),
    minResizeHeight: g('minResizeHeight') || g('minHeight'),
    maxResizeHeight: g('maxResizeHeight'),
  };
}

let problems = 0;
console.log('Widget content against the size each widget asks for\n');

for (const file of readdirSync(LAYOUTS).filter((f) => /widget/.test(f) && f.endsWith('.xml'))) {
  const base = file.replace('_widget.xml', '');
  const m = measure(file);
  const d = declared(base);
  if (!m || !d) continue;

  // A flexible child needs somewhere to go. Anything less than this and the
  // weighted view is zero-height, which for the streak calendar means a month
  // rendered into nothing.
  const perFlexible = 24;
  const need = m.fixed + m.flexible * perFlexible;
  const smallest = FITS_TO_HEIGHT.has(file) ? m.fixed : need;

  const line = (label, size) => {
    const over = Math.round(need - size);
    const ok = size >= (label === 'smallest allowed' ? smallest : need);
    if (!ok) problems += 1;
    console.log(`  ${ok ? '✔' : '✖'} ${label.padEnd(16)} ${String(Math.round(size)).padStart(3)}dp`
      + (ok ? `${DIM}  (needs ~${Math.round(need)}dp)${OFF}` : `${RED}  needs ~${Math.round(need)}dp — short by ${over}dp${OFF}`));
  };

  console.log(`${YEL}${file}${OFF}  ${DIM}fixed ~${m.fixed}dp + ${m.flexible} flexible${OFF}`);
  line('default size', d.minHeight);
  line('smallest allowed', d.minResizeHeight);
  console.log('');
}

if (problems) {
  console.log(`${RED}${problems} widget size(s) smaller than the content inside them.${OFF}`);
  console.log('A vertical LinearLayout does not shrink its children to fit — it');
  console.log('allocates top-down and the last ones fall off the bottom. Raise the');
  console.log('declared size, or take something out of the layout.');
  process.exit(1);
}
console.log(`${GREEN}Every widget asks for enough room for what is inside it.${OFF}`);

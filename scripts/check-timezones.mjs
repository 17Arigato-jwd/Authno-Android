/**
 * The writing day, in timezones that are not the one you develop in.
 *
 *   npm run check:timezones
 *
 * ── Why this is a script and not a test ──────────────────────────────────────
 *
 * A zone is a property of the process, fixed before the first Date is
 * constructed. Setting `process.env.TZ` inside a jest file does nothing here —
 * measured: `getTimezoneOffset()` still returns 0 — so the suite can only ever
 * exercise the container's UTC, which is the one zone with no DST in it. This
 * re-executes itself once per zone with TZ set, which is the only way to reach
 * the days that are 23 and 25 hours long.
 *
 * ── What it caught ───────────────────────────────────────────────────────────
 *
 * `extensionHours` subtracted two timestamps and divided by an hour, which
 * measures ELAPSED hours. Every boundary it was measuring between — midnight,
 * the 4am cap — is a wall-clock hour. On the Sunday the clocks go back, local
 * midnight to 04:00 really is five hours, because 1am happens twice, so a cap
 * of four reported five. On the Sunday they go forward the same sum reported
 * three. Neither is what a writer looking at their clock would say.
 *
 * ── What it deliberately does not check ──────────────────────────────────────
 *
 * That the deadline lands on a whole hour. In Lord Howe the shift is THIRTY
 * minutes, so an extension of one real hour from a midnight that then moves
 * lands at 02:30 — and that is right. The rule is "an hour at a time, up to
 * 4am": the hour is a duration and the cap is a wall-clock time, and in a
 * half-hour zone those simply do not line up. An invariant demanding they do
 * is an invariant that would force the code to be wrong.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), '..');

/**
 * Each zone with the local moments worth probing in it: either side of its
 * transition, and an ordinary day as a control.
 */
const ZONES = {
  'America/New_York': [
    ['ordinary evening', '2026-06-15T21:00:00', null],
    ['ordinary small hours, extended', '2026-06-15T00:30:00', '2026-06-15T00:25:00'],
    ['spring forward — 2am does not exist', '2026-03-08T03:10:00', '2026-03-08T03:05:00'],
    ['spring forward — the hour before it', '2026-03-08T01:30:00', '2026-03-08T01:25:00'],
    ['fall back — inside the hour that repeats', '2026-11-01T01:30:00', '2026-11-01T01:25:00'],
    ['fall back — after it', '2026-11-01T03:30:00', '2026-11-01T03:25:00'],
  ],
  // DST starts at 24:00, so 00:00 on the following day never happens — which
  // is the one thing midnightOf() is asked to produce.
  'America/Santiago': [
    ['the night midnight is skipped', '2026-09-05T23:55:00', '2026-09-05T23:50:00'],
    ['the first hour that exists that day', '2026-09-06T01:30:00', '2026-09-06T01:25:00'],
    ['later the same morning', '2026-09-06T03:30:00', '2026-09-06T03:25:00'],
  ],
  // A thirty-minute shift. See the note above about what is not asserted.
  'Australia/Lord_Howe': [
    ['the night before', '2026-10-03T23:55:00', '2026-10-03T23:50:00'],
    ['after the half-hour shift', '2026-10-04T03:00:00', '2026-10-04T02:55:00'],
  ],
  // A 45-minute offset from UTC, and no DST at all.
  'Asia/Kathmandu': [
    ['ordinary evening', '2026-06-15T21:00:00', null],
    ['ordinary small hours, extended', '2026-06-15T02:50:00', '2026-06-15T02:45:00'],
  ],
  // Southern hemisphere, so its transitions are the opposite way round.
  'Pacific/Chatham': [
    ['transition night', '2026-04-05T02:30:00', '2026-04-05T02:25:00'],
    ['ordinary evening', '2026-06-15T21:00:00', null],
  ],
  UTC: [
    ['ordinary evening', '2026-06-15T21:00:00', null],
    ['at the cap', '2026-06-15T03:50:00', '2026-06-15T03:45:00'],
  ],
};

// ── One zone, in this process ────────────────────────────────────────────────

if (process.env.AUTHNO_TZ_CHILD) {
  const src = readFileSync(path.join(ROOT, 'src', 'utils', 'streakWindow.js'), 'utf8');
  const dir = mkdtempSync(path.join(tmpdir(), 'authno-tz-'));
  const file = path.join(dir, 'streakWindow.mjs');
  writeFileSync(file, src);
  const SW = await import(file);

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  let bad = 0;
  const check = (label, ok, detail) => {
    if (!ok) { bad++; console.log(`    ✖ ${label} — ${detail}`); }
  };

  for (const [label, nowStr, writeStr] of ZONES[process.env.AUTHNO_TZ_CHILD]) {
    const now = new Date(nowStr);
    const lastWrite = writeStr ? new Date(writeStr).getTime() : null;
    const end = SW.windowEnd(now, lastWrite);
    const left = SW.msRemaining(now, lastWrite);
    const key = SW.writingDayKey(now, lastWrite);
    const ext = SW.extensionHours(now, lastWrite);
    const cd = SW.countdownState({ now, lastWriteAt: lastWrite });

    // The deadline is always ahead. Behind it, the countdown reads zero and
    // the day key flips somewhere nobody predicted.
    check(`${label}: deadline ahead of now`, end.getTime() > now.getTime(),
          `end ${fmt(end)} <= now ${fmt(now)}`);

    // The window is "the rest of today". Past ~28h means the walk overshot.
    check(`${label}: within a day`, left <= 28 * 3600000, `${(left / 3600000).toFixed(2)}h`);

    // Wall-clock, so it survives a day that is 23 or 25 hours long. This is
    // the assertion that failed before extensionHours stopped subtracting
    // timestamps.
    check(`${label}: extension within the cap`, ext >= 0 && ext <= SW.HARD_CAP_HOUR, String(ext));

    // The deadline never sits past the cap on the clock.
    check(`${label}: deadline at or before the cap`, end.getHours() <= SW.HARD_CAP_HOUR,
          `${fmt(end)}`);

    check(`${label}: key is a real date`,
          /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(key)), key);

    // What the widget is handed has to agree with the pieces it came from.
    check(`${label}: countdownState agrees`,
          cd.deadline === end.getTime() && cd.extended === ext && cd.dayKey === key,
          JSON.stringify({ cd: cd.deadline, end: end.getTime(), cdExt: cd.extended, ext }));

    console.log(`    ${label}`);
    console.log(`      now ${fmt(now)} → end ${fmt(end)}  (${(left / 3600000).toFixed(2)}h, day ${key}, ext ${ext})`);
  }
  process.exit(bad ? 1 : 0);
}

// ── The parent: one child per zone ───────────────────────────────────────────

let failed = 0;
for (const zone of Object.keys(ZONES)) {
  console.log(`\n${zone}`);
  const r = spawnSync(process.execPath, [HERE], {
    stdio: 'inherit',
    env: { ...process.env, TZ: zone, AUTHNO_TZ_CHILD: zone },
  });
  if (r.status !== 0) failed++;
}

console.log('');
if (failed) {
  console.error(`✖ the writing day misbehaves in ${failed} zone(s).`);
  process.exit(1);
}
console.log('✔ the writing day holds in every zone checked.');

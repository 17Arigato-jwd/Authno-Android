/**
 * sounds.js — interface sound effects.
 *
 * Mirrors haptics.js: one global switch, every call safe to make anywhere, and
 * silence is always an acceptable outcome. A missing file is NOT an error —
 * the sound assets are commissioned separately, so every helper degrades to a
 * no-op until public/sounds/<name>.<ext> exists. Nothing in the app should
 * ever wait on, or branch on, a sound playing.
 *
 * Assets live in public/sounds/. Preferred format is .ogg with an .mp3
 * fallback for platforms that refuse Vorbis. See SOUNDS.md for the brief.
 */

const BASE = `${process.env.PUBLIC_URL || ''}/sounds`;

/** name → [file stem, volume]. Volumes are pre-balanced by ear, not by peak. */
const CATALOG = {
  gateUnlock: ['gate_unlock', 0.7],
  keyInvalid: ['key_invalid', 0.55],
  keyType: ['key_type', 0.25],
  inviteMint: ['invite_mint', 0.6],
  trialWarn: ['trial_warn', 0.5],
  purchaseSuccess: ['purchase_success', 0.7],
};

let _enabled = true;
/** Stems known to be missing — probed once, then never re-requested. */
const _missing = new Set();
const _cache = new Map();

export function setSoundsEnabled(v) { _enabled = !!v; }
export function soundsEnabled() { return _enabled; }

function makeAudio(stem, volume) {
  const el = new Audio(`${BASE}/${stem}.ogg`);
  el.volume = volume;
  el.preload = 'auto';
  // canPlayType is advisory only; some engines report '' and still play. The
  // real fallback is the error handler below, which swaps to .mp3 once and
  // then gives up quietly.
  let triedMp3 = false;
  el.addEventListener('error', () => {
    if (!triedMp3) {
      triedMp3 = true;
      el.src = `${BASE}/${stem}.mp3`;
      el.load();
    } else {
      _missing.add(stem);
    }
  });
  return el;
}

/**
 * Play a catalogued sound. Never throws, never returns a rejected promise, and
 * resolves immediately — callers are not meant to await audio.
 */
export function playSound(name) {
  if (!_enabled) return;
  const entry = CATALOG[name];
  if (!entry) return;
  const [stem, volume] = entry;
  if (_missing.has(stem)) return;
  try {
    let el = _cache.get(stem);
    if (!el) { el = makeAudio(stem, volume); _cache.set(stem, el); }
    // Restart rather than overlap — these are UI cues, not a soundscape.
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay policy or missing file */ });
  } catch { /* no Audio in this environment (SSR, tests) */ }
}

/** Warm the cache so the first play isn't late. Safe to call on any screen. */
export function preloadSounds(names = Object.keys(CATALOG)) {
  if (!_enabled) return;
  for (const name of names) {
    const entry = CATALOG[name];
    if (!entry || _missing.has(entry[0]) || _cache.has(entry[0])) continue;
    try { _cache.set(entry[0], makeAudio(entry[0], entry[1])); } catch { /* ignore */ }
  }
}

export const SOUND_NAMES = Object.freeze(Object.keys(CATALOG));

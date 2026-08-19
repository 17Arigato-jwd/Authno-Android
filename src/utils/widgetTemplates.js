/**
 * widgetTemplates.js — the four widget classes, and the constraints they must
 * be written against.
 *
 * Spec: docs/extension-system-v2-spec.md §8a.3.
 *
 * The plan is 20–50 templates eventually and FOUR first, one per class, because
 * templates are the largest chunk of work in v2 and carry almost no
 * architectural risk — which is exactly why they should not go first. Writing
 * forty-six of them against an API the timer has not yet tested is how
 * forty-six of them get rewritten.
 *
 * What this file is for is the other half of that argument. Android's widget
 * surface has several sharp edges, and every one of them is invisible until an
 * author has shipped:
 *
 *   - `updatePeriodMillis` has a **30-minute floor**. A widget declaring a
 *     one-minute refresh does not refresh every minute; it refreshes every
 *     thirty, silently.
 *   - **`setChronometer` is the only view that ticks by itself.** Everything
 *     else is a push from the app, so a clock built out of a TextView is a
 *     clock that updates when something else happens to wake the process.
 *   - **RemoteViews has no typeface API.** A font file inside an extension
 *     package cannot reach a widget at all; only faces bundled in AuthNo's own
 *     APK can be named.
 *   - A RemoteViews update crosses **Binder**, which caps a transaction at
 *     about 1 MB. A large bitmap does not fail loudly, it fails as a widget
 *     that stops updating.
 *
 * So an author is told at build time instead of discovering on a device. None
 * of this is verifiable off-device — what is verified here is that a manifest
 * which would hit one of these is refused before it ships.
 */

/** The four classes the first templates cover, one sharp edge each. */
export const WIDGET_CLASSES = {
  static: {
    label: 'Static card',
    /** Redrawn only when the extension pushes. No timer at all. */
    selfUpdating: false,
    minPeriodMs: null,
  },
  periodic: {
    label: 'Periodic counter',
    selfUpdating: false,
    // The floor is the platform's, not ours. Declaring less does not get less.
    minPeriodMs: 30 * 60 * 1000,
  },
  timer: {
    label: 'Timer',
    // The one class that ticks without being pushed, because it is the one
    // class built on setChronometer.
    selfUpdating: true,
    minPeriodMs: null,
  },
  list: {
    label: 'Scrolling list',
    selfUpdating: false,
    minPeriodMs: 30 * 60 * 1000,
  },
};

/** The floor Android imposes on periodic widget updates. */
export const MIN_UPDATE_PERIOD_MS = 30 * 60 * 1000;

/**
 * Roughly what one RemoteViews update may carry.
 *
 * The Binder transaction limit is about 1 MB and is shared, so the practical
 * budget is well under it. Exceeding it does not throw where an author can see
 * it — the widget simply stops updating.
 */
export const MAX_UPDATE_BYTES = 512 * 1024;

/** Rows a list widget may carry in one update. */
export const MAX_LIST_ROWS = 100;

/**
 * Faces a widget may name.
 *
 * Bundled in AuthNo's APK, because RemoteViews cannot take a font from an
 * extension package (see the header). An author picks from this list or gets
 * the system default — there is no third option the platform allows.
 *
 * Marked `tabular` where digits are constant width, which is what stops a
 * timer jittering as it counts. See §8a.2.
 */
export const WIDGET_FONTS = [
  { name: 'Inter', tabular: true }, { name: 'Roboto', tabular: true },
  { name: 'Open Sans', tabular: false }, { name: 'Lato', tabular: false },
  { name: 'Source Sans 3', tabular: false }, { name: 'Nunito', tabular: false },
  { name: 'Work Sans', tabular: false }, { name: 'Roboto Condensed', tabular: false },
  { name: 'Barlow Condensed', tabular: false }, { name: 'Oswald', tabular: false },
  { name: 'Merriweather', tabular: false }, { name: 'Lora', tabular: false },
  { name: 'Source Serif 4', tabular: false }, { name: 'EB Garamond', tabular: false },
  { name: 'Libre Baskerville', tabular: false }, { name: 'Playfair Display', tabular: false },
  { name: 'Abril Fatface', tabular: false }, { name: 'Zilla Slab', tabular: false },
  { name: 'JetBrains Mono', tabular: true }, { name: 'IBM Plex Mono', tabular: true },
  { name: 'Caveat', tabular: false }, { name: 'Bebas Neue', tabular: false },
];

const FONT_NAMES = new Set(WIDGET_FONTS.map((f) => f.name));
const TABULAR = new Set(WIDGET_FONTS.filter((f) => f.tabular).map((f) => f.name));

/** Sizes a widget may declare, in the launcher's cell grid. */
export const WIDGET_SIZES = ['1x1', '2x1', '2x2', '4x1', '4x2', '4x4'];

export function fontIsTabular(name) { return TABULAR.has(name); }

/**
 * Check one widget contribution.
 *
 * Returns { ok, errors, warnings, normalised }. Errors are refusals; warnings
 * are things that will work but not as the author probably expects — and the
 * update period is the one that most deserves a warning rather than silence,
 * because the platform's answer to "every minute" is "every thirty" with no
 * complaint at all.
 */
export function validateWidget(widget) {
  const errors = [];
  const warnings = [];

  if (!widget || typeof widget !== 'object' || Array.isArray(widget)) {
    return { ok: false, errors: ['a widget must be an object'], warnings, normalised: null };
  }

  const { id, label, size, template, updatePeriodMs, font } = widget;

  if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) {
    errors.push('a widget needs an id of letters, digits, dot, dash or underscore');
  }
  if (typeof label !== 'string' || label.trim() === '') errors.push('a widget needs a label');

  if (!WIDGET_SIZES.includes(size)) {
    errors.push(`size ${JSON.stringify(size)} is not one of ${WIDGET_SIZES.join(', ')}`);
  }

  const cls = WIDGET_CLASSES[template];
  if (!cls) {
    errors.push(`template ${JSON.stringify(template)} is not one of ${Object.keys(WIDGET_CLASSES).join(', ')}`);
    return { ok: false, errors, warnings, normalised: null };
  }

  let period = updatePeriodMs;
  if (cls.minPeriodMs === null) {
    if (period !== undefined) {
      errors.push(`a ${template} widget does not take updatePeriodMs`
        + (cls.selfUpdating ? ' — it ticks on its own' : ' — it redraws when you push to it'));
    }
  } else if (period === undefined) {
    period = cls.minPeriodMs;
  } else if (!Number.isFinite(period) || period <= 0) {
    errors.push('updatePeriodMs must be a positive number of milliseconds');
  } else if (period < cls.minPeriodMs) {
    // A warning rather than an error: the widget works, it just does not
    // refresh as often as the manifest says. Silence here is how an author
    // ships a "live" widget that is half an hour stale.
    warnings.push(
      `updatePeriodMs ${period} is below Android's ${cls.minPeriodMs} ms floor; `
      + 'the system will refresh every 30 minutes regardless. '
      + 'Use the timer template, or push an update when something changes.',
    );
    period = cls.minPeriodMs;
  }

  if (font !== undefined) {
    if (!FONT_NAMES.has(font)) {
      // The list is closed because the platform closes it, not because we do.
      errors.push(`font ${JSON.stringify(font)} is not one AuthNo bundles; `
        + 'RemoteViews cannot use a font from an extension package');
    } else if (template === 'timer' && !TABULAR.has(font)) {
      warnings.push(`${font} does not have constant-width digits, so a timer set in it `
        + 'will jitter as it counts. Inter, Roboto, JetBrains Mono and IBM Plex Mono do not.');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalised: errors.length === 0
      ? {
        id, label, size, template,
        updatePeriodMs: cls.minPeriodMs === null ? null : period,
        font: font ?? null,
        selfUpdating: cls.selfUpdating,
      }
      : null,
  };
}

/** Every widget a manifest contributes, checked together. */
export function validateWidgets(manifest) {
  const list = manifest?.contributes?.widgets;
  const errors = [];
  const warnings = [];
  const normalised = [];

  if (list === undefined) return { ok: true, errors, warnings, normalised };
  if (!Array.isArray(list)) {
    return { ok: false, errors: ['contributes.widgets must be an array'], warnings, normalised };
  }

  const seen = new Set();
  list.forEach((w, i) => {
    const r = validateWidget(w);
    errors.push(...r.errors.map((e) => `widgets[${i}]: ${e}`));
    warnings.push(...r.warnings.map((e) => `widgets[${i}]: ${e}`));
    if (r.normalised) {
      if (seen.has(r.normalised.id)) errors.push(`widgets[${i}]: duplicate id "${r.normalised.id}"`);
      seen.add(r.normalised.id);
      normalised.push(r.normalised);
    }
  });

  return { ok: errors.length === 0, errors, warnings, normalised };
}

/**
 * Check a payload before it is handed to a RemoteViews update.
 *
 * The failure this prevents is the quiet one: too much data does not raise
 * anything an author can see, the widget just stops updating, and the reason
 * is a Binder limit nobody mentioned.
 */
export function checkUpdatePayload(template, payload) {
  const errors = [];
  const cls = WIDGET_CLASSES[template];
  if (!cls) return { ok: false, errors: [`unknown template ${template}`], bytes: 0 };

  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(payload ?? null)).length;
  } catch {
    return { ok: false, errors: ['payload is not serialisable'], bytes: 0 };
  }

  if (bytes > MAX_UPDATE_BYTES) {
    errors.push(`payload is ${bytes} bytes; the practical Binder budget is ${MAX_UPDATE_BYTES}. `
      + 'Too large does not fail loudly — the widget simply stops updating.');
  }

  if (template === 'list') {
    const rows = Array.isArray(payload?.rows) ? payload.rows.length : 0;
    if (rows > MAX_LIST_ROWS) {
      errors.push(`a list widget may carry ${MAX_LIST_ROWS} rows; this one has ${rows}`);
    }
  }

  return { ok: errors.length === 0, errors, bytes };
}

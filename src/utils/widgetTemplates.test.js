import {
  validateWidget, validateWidgets, checkUpdatePayload, fontIsTabular,
  WIDGET_CLASSES, WIDGET_FONTS, WIDGET_SIZES,
  MIN_UPDATE_PERIOD_MS, MAX_UPDATE_BYTES, MAX_LIST_ROWS,
} from './widgetTemplates.js';

const ok = (over = {}) => ({ id: 'w', label: 'Words today', size: '2x1', template: 'static', ...over });

describe('the four classes', () => {
  test('each is one sharp edge of the platform', () => {
    expect(Object.keys(WIDGET_CLASSES).sort()).toEqual(['list', 'periodic', 'static', 'timer']);
  });

  test('only the timer ticks by itself', () => {
    // setChronometer is the one view that self-updates. Everything else is a
    // push, so a clock built from a TextView updates when something else
    // happens to wake the process.
    const selfUpdating = Object.entries(WIDGET_CLASSES)
      .filter(([, c]) => c.selfUpdating).map(([k]) => k);
    expect(selfUpdating).toEqual(['timer']);
  });

  test('a minimal static widget validates', () => {
    const r = validateWidget(ok());
    expect({ ok: r.ok, errors: r.errors }).toEqual({ ok: true, errors: [] });
    expect(r.normalised.updatePeriodMs).toBeNull();
  });
});

describe("Android's 30-minute floor", () => {
  test('a periodic widget below the floor WARNS rather than failing silently', () => {
    // The platform's answer to "every minute" is "every thirty", with no
    // complaint at all. Silence here is how an author ships a "live" widget
    // that is half an hour stale.
    const r = validateWidget(ok({ template: 'periodic', updatePeriodMs: 60000 }));
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/30 minutes regardless/);
    expect(r.normalised.updatePeriodMs).toBe(MIN_UPDATE_PERIOD_MS);
  });

  test('the warning points at the two things that actually work', () => {
    const r = validateWidget(ok({ template: 'periodic', updatePeriodMs: 1000 }));
    expect(r.warnings[0]).toMatch(/timer template/);
    expect(r.warnings[0]).toMatch(/push an update/);
  });

  test('at or above the floor there is no warning', () => {
    const r = validateWidget(ok({ template: 'periodic', updatePeriodMs: MIN_UPDATE_PERIOD_MS }));
    expect(r.warnings).toEqual([]);
    expect(r.normalised.updatePeriodMs).toBe(MIN_UPDATE_PERIOD_MS);
  });

  test('a periodic widget with no period declared takes the floor', () => {
    expect(validateWidget(ok({ template: 'periodic' })).normalised.updatePeriodMs)
      .toBe(MIN_UPDATE_PERIOD_MS);
  });

  test('a timer declaring a period is refused — it ticks on its own', () => {
    const r = validateWidget(ok({ template: 'timer', updatePeriodMs: 1000 }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/ticks on its own/);
  });

  test('a static widget declaring a period is refused — it redraws on push', () => {
    const r = validateWidget(ok({ template: 'static', updatePeriodMs: 60000 }));
    expect(r.errors[0]).toMatch(/redraws when you push/);
  });

  test('a nonsense period is refused', () => {
    for (const bad of [0, -1, NaN, Infinity, 'soon']) {
      const r = validateWidget(ok({ template: 'periodic', updatePeriodMs: bad }));
      expect({ bad: String(bad), ok: r.ok }).toEqual({ bad: String(bad), ok: false });
    }
  });
});

describe('fonts, which the platform closes rather than us', () => {
  test('a bundled face is accepted', () => {
    expect(validateWidget(ok({ font: 'Inter' })).ok).toBe(true);
  });

  test('an unbundled face is refused, with the reason', () => {
    // RemoteViews has no typeface API, so a font inside an extension package
    // cannot reach a widget at all.
    const r = validateWidget(ok({ font: 'Comic Sans MS' }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/cannot use a font from an extension package/);
  });

  test('a timer in a non-tabular face warns about jitter', () => {
    const r = validateWidget(ok({ template: 'timer', font: 'Playfair Display' }));
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/jitter/);
    expect(r.warnings[0]).toMatch(/JetBrains Mono/);
  });

  test('a timer in a tabular face does not', () => {
    for (const font of ['Inter', 'Roboto', 'JetBrains Mono', 'IBM Plex Mono']) {
      const r = validateWidget(ok({ template: 'timer', font }));
      expect({ font, warnings: r.warnings }).toEqual({ font, warnings: [] });
    }
  });

  test('the tabular faces are the ones a counter needs', () => {
    expect(WIDGET_FONTS.filter((f) => f.tabular).map((f) => f.name).sort())
      .toEqual(['IBM Plex Mono', 'Inter', 'JetBrains Mono', 'Roboto']);
    expect(fontIsTabular('Inter')).toBe(true);
    expect(fontIsTabular('Caveat')).toBe(false);
  });

  test('the curated list is the 22 the spec names', () => {
    expect(WIDGET_FONTS).toHaveLength(22);
    expect(new Set(WIDGET_FONTS.map((f) => f.name)).size).toBe(22);
  });
});

describe('the ordinary shape checks', () => {
  test('id, label and size are required and constrained', () => {
    expect(validateWidget(ok({ id: 'a/b' })).ok).toBe(false);
    expect(validateWidget(ok({ label: '  ' })).ok).toBe(false);
    expect(validateWidget(ok({ size: '9x9' })).ok).toBe(false);
    expect(WIDGET_SIZES).toContain('2x2');
  });

  test('an unknown template is refused before anything else is guessed at', () => {
    const r = validateWidget(ok({ template: 'carousel' }));
    expect(r.ok).toBe(false);
    expect(r.normalised).toBeNull();
  });

  test('a widget that is not an object does not throw', () => {
    for (const bad of [null, undefined, 'widget', 42, []]) {
      expect(() => validateWidget(bad)).not.toThrow();
      expect(validateWidget(bad).ok).toBe(false);
    }
  });
});

describe('a manifest full of widgets', () => {
  const manifest = (widgets) => ({ contributes: { widgets } });

  test('no widgets is fine', () => {
    expect(validateWidgets({}).ok).toBe(true);
    expect(validateWidgets(manifest(undefined)).ok).toBe(true);
  });

  test('errors name which widget', () => {
    const r = validateWidgets(manifest([ok(), ok({ id: 'b', size: 'huge' })]));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^widgets\[1\]:/);
  });

  test('two widgets cannot share an id', () => {
    const r = validateWidgets(manifest([ok(), ok()]));
    expect(r.errors.join(' ')).toMatch(/duplicate id "w"/);
  });

  test('warnings survive to the caller', () => {
    const r = validateWidgets(manifest([ok({ template: 'periodic', updatePeriodMs: 1000 })]));
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/widgets\[0\]/);
  });

  test('widgets must be an array', () => {
    expect(validateWidgets(manifest({ a: 1 })).ok).toBe(false);
  });
});

describe('the Binder budget, which fails quietly', () => {
  test('an ordinary payload passes', () => {
    const r = checkUpdatePayload('static', { title: 'Words today', value: '1,204' });
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
  });

  test('an oversized payload is refused, with the reason it would fail', () => {
    // Too much data does not raise anything an author can see. The widget just
    // stops updating, and the cause is a limit nobody mentioned.
    const r = checkUpdatePayload('static', { blob: 'x'.repeat(MAX_UPDATE_BYTES) });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/stops updating/);
  });

  test('a list is bounded by rows as well as by bytes', () => {
    const rows = Array.from({ length: MAX_LIST_ROWS + 1 }, (_, i) => `Chapter ${i}`);
    const r = checkUpdatePayload('list', { rows });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/may carry 100 rows/);
  });

  test('a list at the limit passes', () => {
    const rows = Array.from({ length: MAX_LIST_ROWS }, (_, i) => `Chapter ${i}`);
    expect(checkUpdatePayload('list', { rows }).ok).toBe(true);
  });

  test('an unserialisable payload is refused rather than throwing', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const r = checkUpdatePayload('static', cyclic);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not serialisable/);
  });

  test('an unknown template is refused', () => {
    expect(checkUpdatePayload('carousel', {}).ok).toBe(false);
  });
});

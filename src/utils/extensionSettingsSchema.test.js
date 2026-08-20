import {
  validateSchema, coerceValue, defaultValues, reconcileValues,
  flattenControls, isValueType, CONTROL_TYPES,
} from './extensionSettingsSchema.js';

/** The example from the spec, §6. */
const CLOUD_BACKUP = [
  { key: 'provider', type: 'select', label: 'Cloud provider',
    options: ['Google Drive', 'Dropbox', 'WebDAV'], default: 'Google Drive' },
  { key: 'interval', type: 'number', label: 'Sync every', suffix: 'minutes',
    min: 5, max: 1440, default: 30 },
  { key: 'wifiOnly', type: 'toggle', label: 'Only on Wi-Fi', default: true },
  { key: 'folder', type: 'text', label: 'Folder', placeholder: '/AuthNo' },
  { key: 'account', type: 'action', label: 'Connect account', command: 'auth.connect' },
  { key: 'status', type: 'readout', label: 'Last sync', source: 'sync.status' },
  { type: 'section', label: 'Advanced', collapsed: true, children: [
    { key: 'retries', type: 'number', label: 'Retries', min: 0, max: 10, default: 3 },
  ] },
];

describe('the spec example', () => {
  test('validates', () => {
    const r = validateSchema(CLOUD_BACKUP);
    expect({ ok: r.ok, errors: r.errors }).toEqual({ ok: true, errors: [] });
  });

  test('its keys are collected, sections included', () => {
    expect(validateSchema(CLOUD_BACKUP).keys.sort())
      .toEqual(['folder', 'interval', 'provider', 'retries', 'wifiOnly']);
  });

  test('defaults come out ready to render', () => {
    expect(defaultValues(CLOUD_BACKUP)).toEqual({
      provider: 'Google Drive', interval: 30, wifiOnly: true, folder: '', retries: 3,
    });
  });

  test('a control with no default still gets a value, never undefined', () => {
    // A page must not render a control with nothing behind it.
    const values = defaultValues(CLOUD_BACKUP);
    const missing = flattenControls(CLOUD_BACKUP)
      .filter((c) => isValueType(c.type) && values[c.key] === undefined)
      .map((c) => c.key);
    expect(missing).toEqual([]);
  });

  test('no schema at all is valid — an extension may have no settings', () => {
    expect(validateSchema(undefined).ok).toBe(true);
    expect(validateSchema([]).ok).toBe(true);
    expect(defaultValues(undefined)).toEqual({});
  });
});

describe('schema validation', () => {
  test('an unknown control type is refused', () => {
    const r = validateSchema([{ key: 'a', type: 'slider', label: 'A' }]);
    expect(r.errors[0]).toMatch(/expected one of/);
  });

  test('every control needs a label', () => {
    expect(validateSchema([{ key: 'a', type: 'toggle' }]).errors[0]).toMatch(/needs a label/);
    expect(validateSchema([{ key: 'a', type: 'toggle', label: '  ' }]).errors[0]).toMatch(/needs a label/);
  });

  test('two controls cannot share a key', () => {
    // Not a layout choice: it is a value whose meaning depends on which
    // control was touched last.
    const r = validateSchema([
      { key: 'x', type: 'toggle', label: 'One' },
      { key: 'x', type: 'text', label: 'Two' },
    ]);
    expect(r.errors[0]).toMatch(/reuses the key/);
  });

  test('a key colliding across a section boundary is still a collision', () => {
    const r = validateSchema([
      { key: 'x', type: 'toggle', label: 'One' },
      { type: 'section', label: 'More', children: [{ key: 'x', type: 'text', label: 'Two' }] },
    ]);
    expect(r.ok).toBe(false);
  });

  test('a key that is not a safe identifier is refused', () => {
    for (const key of ['', '1abc', 'a b', 'a/b', '../x', 'a\\b']) {
      expect({ key, ok: validateSchema([{ key, type: 'toggle', label: 'A' }]).ok })
        .toEqual({ key, ok: false });
    }
  });

  test('select needs options, and they must be distinct strings', () => {
    expect(validateSchema([{ key: 'a', type: 'select', label: 'A' }]).errors[0]).toMatch(/options/);
    expect(validateSchema([{ key: 'a', type: 'select', label: 'A', options: [] }]).ok).toBe(false);
    expect(validateSchema([{ key: 'a', type: 'select', label: 'A', options: ['x', 'x'] }]).errors[0])
      .toMatch(/duplicate/);
    expect(validateSchema([{ key: 'a', type: 'select', label: 'A', options: ['x', 2] }]).errors[0])
      .toMatch(/strings/);
  });

  test('a number with min above max is refused', () => {
    const r = validateSchema([{ key: 'a', type: 'number', label: 'A', min: 10, max: 1 }]);
    expect(r.errors[0]).toMatch(/min above max/);
  });

  test('an action needs a command and a readout needs a source', () => {
    expect(validateSchema([{ type: 'action', label: 'Go' }]).errors[0]).toMatch(/needs a command/);
    expect(validateSchema([{ type: 'readout', label: 'Status' }]).errors[0]).toMatch(/needs a source/);
  });

  test('a default that its own control would reject is caught at build time', () => {
    // Otherwise the page opens showing a value the extension has already said
    // is invalid.
    const r = validateSchema([
      { key: 'a', type: 'number', label: 'A', min: 5, max: 10, default: 99 },
    ]);
    expect(r.errors[0]).toMatch(/default is above the maximum/);
  });

  test('a default outside a select option list is caught', () => {
    const r = validateSchema([
      { key: 'a', type: 'select', label: 'A', options: ['x', 'y'], default: 'z' },
    ]);
    expect(r.errors[0]).toMatch(/not one of the options/);
  });

  test('sections cannot nest without limit', () => {
    const deep = (n) => (n === 0
      ? [{ key: 'leaf', type: 'toggle', label: 'Leaf' }]
      : [{ type: 'section', label: `L${n}`, children: deep(n - 1) }]);
    expect(validateSchema(deep(2)).ok).toBe(true);
    expect(validateSchema(deep(8)).ok).toBe(false);
  });

  test('a schema that is not an array is refused', () => {
    for (const bad of ['x', 42, {}, true]) {
      expect({ bad, ok: validateSchema(bad).ok }).toEqual({ bad, ok: false });
    }
  });

  test('a very large page is refused rather than rendered', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      key: `k${i}`, type: 'toggle', label: `Toggle ${i}`,
    }));
    expect(validateSchema(many).ok).toBe(false);
  });

  test('every declared control type is either a value type or handled', () => {
    for (const type of CONTROL_TYPES) {
      expect({ type, known: typeof type === 'string' }).toEqual({ type, known: true });
    }
  });
});

describe('values are checked on the way in, not trusted', () => {
  const toggle = { key: 't', type: 'toggle', label: 'T' };
  const num = { key: 'n', type: 'number', label: 'N', min: 5, max: 10 };
  const sel = { key: 's', type: 'select', label: 'S', options: ['a', 'b'] };
  const multi = { key: 'm', type: 'multiselect', label: 'M', options: ['a', 'b', 'c'] };
  const text = { key: 'x', type: 'text', label: 'X' };

  test('a toggle is strictly boolean', () => {
    // Accepting "false" as truthy is the classic version of this bug, and here
    // it would silently switch a setting on.
    expect(coerceValue(toggle, true)).toEqual({ ok: true, value: true });
    for (const bad of ['false', 'true', 1, 0, null, undefined, [], {}]) {
      expect({ bad, ok: coerceValue(toggle, bad).ok }).toEqual({ bad, ok: false });
    }
  });

  test('a number is finite and inside its range', () => {
    expect(coerceValue(num, 7)).toEqual({ ok: true, value: 7 });
    expect(coerceValue(num, 4).ok).toBe(false);
    expect(coerceValue(num, 11).ok).toBe(false);
    for (const bad of [NaN, Infinity, -Infinity, '7', null]) {
      expect({ bad: String(bad), ok: coerceValue(num, bad).ok }).toEqual({ bad: String(bad), ok: false });
    }
  });

  test('a select value must be one of the options', () => {
    expect(coerceValue(sel, 'a')).toEqual({ ok: true, value: 'a' });
    expect(coerceValue(sel, 'c').ok).toBe(false);
    expect(coerceValue(sel, 0).ok).toBe(false);
  });

  test('a multiselect rejects strays and duplicates', () => {
    expect(coerceValue(multi, ['a', 'c'])).toEqual({ ok: true, value: ['a', 'c'] });
    expect(coerceValue(multi, [])).toEqual({ ok: true, value: [] });
    expect(coerceValue(multi, ['a', 'z']).ok).toBe(false);
    expect(coerceValue(multi, ['a', 'a']).ok).toBe(false);
    expect(coerceValue(multi, 'a').ok).toBe(false);
  });

  test('a multiselect result is a copy, so a caller cannot mutate the input later', () => {
    const input = ['a'];
    const { value } = coerceValue(multi, input);
    input.push('b');
    expect(value).toEqual(['a']);
  });

  test('text is bounded — a settings field is not a manuscript', () => {
    expect(coerceValue(text, 'hello')).toEqual({ ok: true, value: 'hello' });
    expect(coerceValue(text, 'x'.repeat(2001)).ok).toBe(false);
    expect(coerceValue(text, 42).ok).toBe(false);
  });

  test('a non-value control holds nothing', () => {
    expect(coerceValue({ type: 'action', label: 'Go' }, 'x').ok).toBe(false);
    expect(coerceValue({ type: 'section', label: 'S' }, 'x').ok).toBe(false);
    expect(coerceValue(undefined, 'x').ok).toBe(false);
  });
});

describe('reconciling after an update', () => {
  const before = [
    { key: 'provider', type: 'select', label: 'P', options: ['Drive', 'Dropbox'], default: 'Drive' },
    { key: 'interval', type: 'number', label: 'I', min: 5, max: 60, default: 30 },
    { key: 'legacy', type: 'toggle', label: 'L', default: false },
  ];

  test('a value whose control is gone is dropped', () => {
    const after = before.filter((c) => c.key !== 'legacy');
    const r = reconcileValues(after, { provider: 'Dropbox', interval: 10, legacy: true });
    expect(r.values).toEqual({ provider: 'Dropbox', interval: 10 });
    expect(r.dropped).toEqual(['legacy']);
  });

  test('a new control takes its default', () => {
    const after = [...before, { key: 'fresh', type: 'toggle', label: 'F', default: true }];
    const r = reconcileValues(after, { provider: 'Drive', interval: 30, legacy: false });
    expect(r.values.fresh).toBe(true);
  });

  test('a value the control no longer accepts falls back to the default', () => {
    // An option removed in an update, or a range narrowed. Keeping the old
    // value would leave the page showing something the extension has already
    // said is not valid.
    const after = [
      { key: 'provider', type: 'select', label: 'P', options: ['Drive'], default: 'Drive' },
      { key: 'interval', type: 'number', label: 'I', min: 15, max: 60, default: 30 },
      { key: 'legacy', type: 'toggle', label: 'L', default: false },
    ];
    const r = reconcileValues(after, { provider: 'Dropbox', interval: 5, legacy: false });
    expect(r.values).toEqual({ provider: 'Drive', interval: 30, legacy: false });
    expect(r.reset.sort()).toEqual(['interval', 'provider']);
  });

  test('untouched values survive an update', () => {
    const r = reconcileValues(before, { provider: 'Dropbox', interval: 45, legacy: true });
    expect(r.values).toEqual({ provider: 'Dropbox', interval: 45, legacy: true });
    expect(r.reset).toEqual([]);
    expect(r.dropped).toEqual([]);
  });

  test('nothing stored yet yields the defaults', () => {
    expect(reconcileValues(before, undefined).values).toEqual({
      provider: 'Drive', interval: 30, legacy: false,
    });
    expect(reconcileValues(before, null).values).toEqual({
      provider: 'Drive', interval: 30, legacy: false,
    });
  });

  test('a stored blob of junk cannot poison the page', () => {
    const r = reconcileValues(before, {
      provider: { evil: true }, interval: 'lots', legacy: 'yes', extra: 1,
    });
    expect(r.values).toEqual({ provider: 'Drive', interval: 30, legacy: false });
    expect(r.reset.sort()).toEqual(['interval', 'legacy', 'provider']);
    expect(r.dropped).toEqual(['extra']);
  });

  test('a prototype key in storage is treated as an ordinary stray', () => {
    const r = reconcileValues(before, JSON.parse('{"__proto__":{"polluted":1},"provider":"Drive"}'));
    expect(r.values.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });
});

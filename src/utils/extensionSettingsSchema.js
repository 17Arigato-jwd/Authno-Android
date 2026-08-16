/**
 * extensionSettingsSchema.js — the app-native settings page (§6).
 *
 * An extension declares controls; AuthNo renders them. That is the whole point
 * of the schema over a custom page: a declared control inherits the app's
 * theme, dark mode, Material You, type scale, focus rings and responsive
 * layout for free, and — more to the point — it cannot draw something that
 * looks like part of AuthNo while behaving like something else.
 *
 * Two jobs here, and they are separate on purpose:
 *
 *   validateSchema  — is this a schema an author can ship?  (build time)
 *   coerceValue     — is this a value the app can store?    (every write)
 *
 * The second is not a formality. Values arrive from inside the sandbox, so a
 * number field is a number because this file says so, not because the control
 * that produced it was a number input. A control is a suggestion about how to
 * ask; the schema is the rule about what may be stored.
 */

export const CONTROL_TYPES = [
  'toggle', 'text', 'number', 'select', 'multiselect', 'action', 'readout', 'section',
];

/** Controls that hold a value. The rest are buttons, labels and grouping. */
const VALUE_TYPES = new Set(['toggle', 'text', 'number', 'select', 'multiselect']);

const MAX_LABEL = 60;
const MAX_TEXT_VALUE = 2000;
const MAX_OPTIONS = 64;
const MAX_DEPTH = 3;
const MAX_CONTROLS = 200;

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function isValueType(type) { return VALUE_TYPES.has(type); }

/**
 * Validate a declared schema.
 *
 * Returns { ok, errors, warnings, keys }. Errors are the author's to fix and
 * are reported at build time; nothing here is a runtime surprise.
 */
export function validateSchema(schema, { _depth = 0, _seen = null } = {}) {
  const errors = [];
  const warnings = [];
  const seen = _seen ?? new Set();

  if (schema === undefined || schema === null) return { ok: true, errors, warnings, keys: [] };
  if (!Array.isArray(schema)) {
    return { ok: false, errors: ['settings.schema must be an array'], warnings, keys: [] };
  }
  if (_depth > MAX_DEPTH) {
    return { ok: false, errors: [`sections are nested more than ${MAX_DEPTH} deep`], warnings, keys: [] };
  }
  if (seen.size + schema.length > MAX_CONTROLS) {
    errors.push(`a settings page may hold at most ${MAX_CONTROLS} controls`);
  }

  schema.forEach((control, i) => {
    const where = `schema[${i}]`;
    if (!isPlain(control)) { errors.push(`${where} must be an object`); return; }

    const { type } = control;
    if (!CONTROL_TYPES.includes(type)) {
      errors.push(`${where} has type ${JSON.stringify(type)}; expected one of ${CONTROL_TYPES.join(', ')}`);
      return;
    }

    if (typeof control.label !== 'string' || control.label.trim() === '') {
      errors.push(`${where} needs a label`);
    } else if (control.label.length > MAX_LABEL) {
      errors.push(`${where} label is ${control.label.length} characters; the limit is ${MAX_LABEL}`);
    }

    if (type === 'section') {
      const inner = validateSchema(control.children, { _depth: _depth + 1, _seen: seen });
      errors.push(...inner.errors.map((e) => `${where} → ${e}`));
      warnings.push(...inner.warnings);
      return;
    }

    if (type === 'action') {
      if (typeof control.command !== 'string' || !control.command) {
        errors.push(`${where} is an action and needs a command`);
      }
      return;
    }

    if (type === 'readout') {
      if (typeof control.source !== 'string' || !control.source) {
        errors.push(`${where} is a readout and needs a source command`);
      }
      return;
    }

    // Everything below holds a value, so it needs a key.
    if (typeof control.key !== 'string' || !/^[A-Za-z_][\w.-]*$/.test(control.key)) {
      errors.push(`${where} needs a key of letters, digits, dot, dash or underscore`);
      return;
    }
    if (seen.has(control.key)) {
      // Two controls writing one key is not a layout choice; it is a value
      // whose meaning depends on which control was touched last.
      errors.push(`${where} reuses the key "${control.key}"`);
    }
    seen.add(control.key);

    if (type === 'number') {
      const { min, max } = control;
      if (min !== undefined && typeof min !== 'number') errors.push(`${where} min must be a number`);
      if (max !== undefined && typeof max !== 'number') errors.push(`${where} max must be a number`);
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        errors.push(`${where} has min above max`);
      }
    }

    if (type === 'select' || type === 'multiselect') {
      const opts = control.options;
      if (!Array.isArray(opts) || opts.length === 0) {
        errors.push(`${where} needs a non-empty options array`);
      } else if (opts.length > MAX_OPTIONS) {
        errors.push(`${where} has ${opts.length} options; the limit is ${MAX_OPTIONS}`);
      } else if (opts.some((o) => typeof o !== 'string')) {
        errors.push(`${where} options must all be strings`);
      } else if (new Set(opts).size !== opts.length) {
        errors.push(`${where} has duplicate options`);
      }
    }

    if (control.default !== undefined) {
      const { ok, reason } = coerceValue(control, control.default);
      if (!ok) errors.push(`${where} default ${reason}`);
    }
  });

  return { ok: errors.length === 0, errors, warnings, keys: [...seen] };
}

/**
 * Coerce and check one value against its control.
 *
 * Called on every write, not only at build time. The value comes from inside
 * the sandbox: an extension can post whatever it likes to `storage.set`, so a
 * `number` control's stored value is a number because this function says so —
 * not because the widget that produced it happened to be a number input.
 *
 * Returns { ok, value } or { ok:false, reason }.
 */
export function coerceValue(control, raw) {
  const type = control?.type;

  switch (type) {
    case 'toggle':
      // Strictly boolean. Accepting "false" as truthy is the classic version
      // of this bug, and here it would silently turn a setting on.
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      return { ok: false, reason: 'must be true or false' };

    case 'text': {
      if (typeof raw !== 'string') return { ok: false, reason: 'must be a string' };
      if (raw.length > MAX_TEXT_VALUE) return { ok: false, reason: `is longer than ${MAX_TEXT_VALUE} characters` };
      return { ok: true, value: raw };
    }

    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { ok: false, reason: 'must be a finite number' };
      }
      if (typeof control.min === 'number' && raw < control.min) {
        return { ok: false, reason: `is below the minimum of ${control.min}` };
      }
      if (typeof control.max === 'number' && raw > control.max) {
        return { ok: false, reason: `is above the maximum of ${control.max}` };
      }
      return { ok: true, value: raw };
    }

    case 'select': {
      if (typeof raw !== 'string') return { ok: false, reason: 'must be a string' };
      if (!(control.options ?? []).includes(raw)) return { ok: false, reason: 'is not one of the options' };
      return { ok: true, value: raw };
    }

    case 'multiselect': {
      if (!Array.isArray(raw)) return { ok: false, reason: 'must be an array' };
      const options = control.options ?? [];
      for (const v of raw) {
        if (typeof v !== 'string' || !options.includes(v)) {
          return { ok: false, reason: 'contains something that is not one of the options' };
        }
      }
      if (new Set(raw).size !== raw.length) return { ok: false, reason: 'contains duplicates' };
      return { ok: true, value: [...raw] };
    }

    default:
      return { ok: false, reason: 'is not a control that holds a value' };
  }
}

/** Every value-holding control, sections flattened. */
export function flattenControls(schema) {
  const out = [];
  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > MAX_DEPTH) return;
    for (const c of list) {
      if (!isPlain(c)) continue;
      if (c.type === 'section') { walk(c.children, depth + 1); continue; }
      out.push(c);
    }
  };
  walk(schema, 0);
  return out;
}

/**
 * The starting values for a freshly installed extension.
 *
 * A control with no declared default gets a type-appropriate empty rather than
 * being absent, so a page never renders a control with nothing behind it.
 */
export function defaultValues(schema) {
  const out = {};
  for (const c of flattenControls(schema)) {
    if (!isValueType(c.type)) continue;
    if (c.default !== undefined) {
      const { ok, value } = coerceValue(c, c.default);
      if (ok) { out[c.key] = value; continue; }
    }
    out[c.key] = ({
      toggle: false, text: '', number: typeof c.min === 'number' ? c.min : 0,
      select: (c.options ?? [])[0] ?? '', multiselect: [],
    })[c.type];
  }
  return out;
}

/**
 * Reconcile stored values against the schema, after an update.
 *
 * Three things happen and each is deliberate: a value whose control is gone is
 * dropped, a control with no stored value takes its default, and a stored value
 * the control no longer accepts — an option removed in an update, a range
 * narrowed — falls back to the default rather than being kept. Keeping it would
 * leave the page showing something the extension has said is not valid.
 */
export function reconcileValues(schema, stored) {
  const defaults = defaultValues(schema);
  const controls = new Map(flattenControls(schema).filter((c) => isValueType(c.type)).map((c) => [c.key, c]));

  const values = {};
  const dropped = [];
  const reset = [];

  for (const [key, control] of controls) {
    if (!isPlain(stored) || !Object.prototype.hasOwnProperty.call(stored, key)) {
      values[key] = defaults[key];
      continue;
    }
    const { ok, value } = coerceValue(control, stored[key]);
    if (ok) values[key] = value;
    else { values[key] = defaults[key]; reset.push(key); }
  }

  if (isPlain(stored)) {
    for (const key of Object.keys(stored)) if (!controls.has(key)) dropped.push(key);
  }

  return { values, dropped, reset };
}

/**
 * ExtensionSettingsPage.jsx — the controls an extension declared.
 *
 * `extensionSettingsSchema.js` opens by saying what this is for:
 *
 *   "An extension declares controls; AuthNo renders them. That is the whole
 *    point of the schema over a custom page."
 *
 * It validated them, coerced them, reconciled them across updates and defaulted
 * them for a fresh install — and nothing rendered them. A manifest could
 * declare a folder field and a sync toggle, pass validation, and land on a
 * screen that did not exist. `buildExtensionsTab` even computed
 * `canOpenSettingsPage` for a page there was no way to open.
 *
 * ── Why the app draws these ──────────────────────────────────────────────────
 *
 * A declared control inherits the app's theme, dark mode, type scale and focus
 * rings for free, and — the part that is not convenience — it cannot draw
 * something that looks like part of AuthNo while behaving like something else.
 * A text field here is a text field. It cannot be a password prompt wearing
 * AuthNo's clothes.
 *
 * ── What is enforced here rather than assumed ────────────────────────────────
 *
 * Every write goes through `coerceValue` before it is stored, including the
 * ones this page produced itself. A number input can yield `""`, a select can
 * be handed a stale option by a schema that changed under it, and neither is
 * something to write to disk. A control is a suggestion about how to ask; the
 * schema is the rule about what may be stored.
 *
 * Actions and readouts need a running extension, so they are disabled — with
 * the reason — rather than hidden when it is not. A button that vanishes when
 * an extension fails to start tells nobody anything.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COLORS, RADIUS, SPACING, TYPOGRAPHY,
  Toggle, TextInput, MinimalButton, toast,
} from '../DesignSystem';
import {
  validateSchema, reconcileValues, coerceValue,
} from '../utils/extensionSettingsSchema';
import { getExtensionConfig, setExtensionConfig } from '../utils/extensionLoader';
import { commandsV2 } from '../utils/extensionRuntime';

/** Copy this page writes itself. The labels are the author's. */
export const STRINGS = {
  notRunning: 'This extension is not running, so its buttons and readings are unavailable.',
  badSchema: 'These settings could not be read.',
  dropped: (n) => `${n} setting${n === 1 ? '' : 's'} from an older version ${n === 1 ? 'was' : 'were'} removed.`,
  reset: (n) => `${n} setting${n === 1 ? '' : 's'} went back to the default.`,
  empty: 'This extension has no settings.',
  waiting: '…',
};

export default function ExtensionSettingsPage({ manifest, accentHex = COLORS.violetDark, running = true }) {
  const extId = String(manifest?.id ?? '');
  const schema = manifest?.settings?.schema;

  const check = useMemo(() => validateSchema(schema), [schema]);

  // Reconciled once per mount. Re-reconciling on every keystroke would fight
  // the field being typed into: a half-typed value is not yet a value the
  // schema accepts, and reconciliation would replace it with the default.
  const [{ values, dropped, reset }, setState] = useState(
    () => (check.ok ? reconcileValues(schema, getExtensionConfig(extId)) : { values: {}, dropped: [], reset: [] }),
  );

  const write = useCallback((control, raw) => {
    const { ok, value, reason } = coerceValue(control, raw);
    if (!ok) {
      // The author's label, not the key: the key is an identifier and this
      // sentence is for whoever is looking at the screen.
      toast(`${control.label} ${reason}.`, { variant: 'danger' });
      return false;
    }
    setState((s) => ({ ...s, values: { ...s.values, [control.key]: value } }));
    setExtensionConfig(extId, { [control.key]: value });
    return true;
  }, [extId]);

  if (!check.ok) {
    return <Notice tone="danger" text={STRINGS.badSchema} detail={check.errors} />;
  }
  if (!(schema ?? []).length) {
    return <Notice tone="muted" text={STRINGS.empty} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      {!running && <Notice tone="muted" text={STRINGS.notRunning} />}
      {dropped.length > 0 && <Notice tone="muted" text={STRINGS.dropped(dropped.length)} />}
      {reset.length > 0 && <Notice tone="muted" text={STRINGS.reset(reset.length)} />}

      <Controls
        schema={schema}
        values={values}
        onChange={write}
        extId={extId}
        accentHex={accentHex}
        running={running}
        depth={0}
      />
    </div>
  );
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function Controls({ schema, values, onChange, extId, accentHex, running, depth }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md }}>
      {(schema ?? []).map((control, i) => (
        <Control
          key={control.key ?? control.command ?? control.source ?? `${control.type}-${i}`}
          control={control}
          values={values}
          onChange={onChange}
          extId={extId}
          accentHex={accentHex}
          running={running}
          depth={depth}
        />
      ))}
    </div>
  );
}

function Control({ control, values, onChange, extId, accentHex, running, depth }) {
  const { type, label } = control;

  if (type === 'section') {
    return (
      <Section control={control} depth={depth}>
        <Controls
          schema={control.children}
          values={values}
          onChange={onChange}
          extId={extId}
          accentHex={accentHex}
          running={running}
          depth={depth + 1}
        />
      </Section>
    );
  }

  if (type === 'action') {
    return <ActionRow control={control} extId={extId} accentHex={accentHex} running={running} />;
  }
  if (type === 'readout') {
    return <ReadoutRow control={control} extId={extId} running={running} />;
  }

  const value = values[control.key];

  if (type === 'toggle') {
    return (
      <Row label={label} hint={control.hint}>
        {/* ariaLabel, not label: Toggle's `label` prop draws visible text, and
            the row already has the author's label beside it. */}
        <Toggle
          on={!!value}
          onChange={(next) => onChange(control, !!next)}
          accentHex={accentHex}
          ariaLabel={label}
        />
      </Row>
    );
  }

  if (type === 'text') {
    return (
      <Stack label={label} hint={control.hint}>
        <TextInput
          value={String(value ?? '')}
          onChange={(next) => onChange(control, typeof next === 'string' ? next : next?.target?.value ?? '')}
          placeholder={control.placeholder ?? ''}
          accentHex={accentHex}
          aria-label={label}
        />
      </Stack>
    );
  }

  if (type === 'number') {
    return <NumberRow control={control} value={value} onChange={onChange} accentHex={accentHex} />;
  }

  if (type === 'select') {
    return (
      <Stack label={label} hint={control.hint}>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(control, e.target.value)}
          aria-label={label}
          style={fieldStyle}
        >
          {(control.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Stack>
    );
  }

  if (type === 'multiselect') {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <Stack label={label} hint={control.hint}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACING.sm }}>
          {(control.options ?? []).map((o) => {
            const on = chosen.includes(o);
            return (
              <button
                key={o}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onChange(control, on ? chosen.filter((c) => c !== o) : [...chosen, o])}
                style={{
                  padding: `6px ${SPACING.md}px`, borderRadius: RADIUS.full,
                  border: `1px solid ${on ? accentHex : COLORS.border}`,
                  background: on ? `${accentHex}22` : 'transparent',
                  color: on ? COLORS.textPrimary : COLORS.textMuted,
                  fontSize: TYPOGRAPHY.size.sm, cursor: 'pointer',
                }}
              >{o}</button>
            );
          })}
        </div>
      </Stack>
    );
  }

  return null;
}

/**
 * A number field that lets you empty it.
 *
 * Held as text while it is being edited, because the intermediate states of
 * typing a number are not numbers: "" on the way to 5, "-" on the way to -3,
 * "1." on the way to 1.5. Coercing on every keystroke would refuse each of
 * them and put the old value back under the cursor.
 */
function NumberRow({ control, value, onChange, accentHex }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);

  const commit = () => {
    if (draft.trim() === '') { setDraft(String(value ?? '')); return; }
    const n = Number(draft);
    if (!onChange(control, n)) setDraft(String(value ?? ''));
  };

  // `suffix` is the unit. Without it "Check every [30]" is a number with no
  // idea what it counts — the schema accepted the key and nothing drew it, so
  // every author who supplied one lost it silently.
  return (
    <Stack label={control.label} hint={control.hint}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACING.sm }}>
        <input
          type="number"
          value={draft}
          min={control.min}
          max={control.max}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          aria-label={control.suffix ? `${control.label} (${control.suffix})` : control.label}
          style={{ ...fieldStyle, accentColor: accentHex }}
        />
        {control.suffix && (
          <span style={{
            fontSize: TYPOGRAPHY.size.sm, color: COLORS.textMuted, whiteSpace: 'nowrap',
          }}>{control.suffix}</span>
        )}
      </div>
    </Stack>
  );
}

/** A button that runs one of the extension's declared commands. */
function ActionRow({ control, extId, accentHex, running }) {
  const [busy, setBusy] = useState(false);

  const press = async () => {
    const registry = commandsV2(extId);
    if (!registry) { toast(STRINGS.notRunning, { variant: 'danger' }); return; }
    setBusy(true);
    try {
      await registry.invoke(control.command, []);
    } catch (e) {
      // The command's own message. An extension that explains why it could not
      // do something should have that reach the person who pressed the button.
      toast(String(e?.message ?? e), { variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  // No Row: for an action the label IS the button, and captioning it produced
  // "Back up now" twice on one line with a gap between the copies.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs, alignItems: 'flex-start' }}>
      <MinimalButton
        onClick={press}
        disabled={!running || busy}
        color={accentHex}
        size="sm"
      >{control.label}</MinimalButton>
      {control.hint && <Hint text={control.hint} />}
    </div>
  );
}

/**
 * A line of text the extension keeps up to date.
 *
 * The registry starts polling on the first subscriber and stops with the last,
 * so a settings page nobody has open costs nothing — which only holds if this
 * actually unsubscribes on unmount.
 */
function ReadoutRow({ control, extId, running }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!running) return undefined;
    const registry = commandsV2(extId);
    if (!registry) return undefined;
    return registry.subscribeReadout(control.source, setState, {
      intervalMs: control.intervalMs ?? 5000,
    });
  }, [extId, control.source, control.intervalMs, running]);

  const text = state?.error
    ? String(state.error)
    : state?.value === null || state?.value === undefined
      ? STRINGS.waiting
      : String(state.value);

  return (
    <Row label={control.label} hint={control.hint}>
      <span style={{
        fontSize: TYPOGRAPHY.size.sm,
        color: state?.error ? COLORS.danger : COLORS.textMuted,
        fontVariantNumeric: 'tabular-nums',
      }}>{running ? text : STRINGS.waiting}</span>
    </Row>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

/**
 * The fill and padding `TextInput` uses, for the two controls it has no
 * variant of.
 *
 * Copied deliberately rather than approximated: a hand-rolled
 * `rgba(0,0,0,0.25)` sat next to a real TextInput on the same page and the two
 * fields visibly did not match, which reads as one of them being broken.
 */
const fieldStyle = {
  width: '100%', padding: '10px 14px',
  borderRadius: RADIUS.md, border: `1px solid ${COLORS.border}`,
  background: COLORS.surface3, color: COLORS.textPrimary,
  fontFamily: TYPOGRAPHY.sans, fontSize: TYPOGRAPHY.size.base,
  outline: 'none', boxSizing: 'border-box',
};

/**
 * A titled group, open or closed.
 *
 * `collapsed: true` is a key the schema accepts and this drew anyway — an
 * "Advanced" section that says it starts closed and is always open is a small
 * lie, and the author put it there to keep the first screen short.
 *
 * The heading is the separation. A Divider here carried its own 24px margins
 * on top of the flex gap, which left the label marooned above a rule above a
 * gap above the thing it named.
 */
function Section({ control, depth, children }) {
  const [open, setOpen] = useState(!control.collapsed);
  const headingStyle = {
    fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold,
    letterSpacing: TYPOGRAPHY.tracking.wide, textTransform: 'uppercase',
    color: COLORS.textSubtle, marginTop: SPACING.sm,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.sm }}>
      {control.collapsed ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            ...headingStyle,
            display: 'flex', alignItems: 'center', gap: SPACING.xs,
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 9 }}>{open ? '\u25be' : '\u25b8'}</span>
          {control.label}
        </button>
      ) : (
        <div style={headingStyle}>{control.label}</div>
      )}
      {open && (
        <div style={{ paddingLeft: depth === 0 ? 0 : SPACING.md }}>{children}</div>
      )}
    </div>
  );
}

/** Label on the left, control on the right. */
function Row({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SPACING.md }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: TYPOGRAPHY.size.base, color: COLORS.textPrimary }}>{label}</div>
        {hint && <Hint text={hint} />}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/** Label above, control below — for anything that wants the full width. */
function Stack({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs }}>
      <div style={{ fontSize: TYPOGRAPHY.size.base, color: COLORS.textPrimary }}>{label}</div>
      {hint && <Hint text={hint} />}
      {children}
    </div>
  );
}

function Hint({ text }) {
  return (
    <div style={{
      fontSize: TYPOGRAPHY.size.xs, color: COLORS.textSubtle,
      lineHeight: 1.5, marginTop: 2,
    }}>{text}</div>
  );
}

function Notice({ tone, text, detail }) {
  const colour = tone === 'danger' ? COLORS.danger : COLORS.textSubtle;
  return (
    <div style={{
      padding: `10px ${SPACING.md}px`, borderRadius: RADIUS.md,
      border: `1px solid ${colour}44`, background: `${colour}11`,
      fontSize: TYPOGRAPHY.size.sm, color: colour, lineHeight: 1.5,
    }}>
      {text}
      {detail?.length > 0 && (
        <ul style={{ margin: `${SPACING.xs}px 0 0`, paddingLeft: SPACING.lg }}>
          {detail.map((d) => <li key={d} style={{ fontSize: TYPOGRAPHY.size.xs }}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}

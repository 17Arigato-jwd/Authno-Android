/**
 * ExtensionsPanel.jsx — the Extensions tab, as designed.
 *
 * Two screens, and the split is the point.
 *
 *   The list      one row per extension: what it is, what it may do, whether
 *                 it is running. Nothing else. It answers "what have I
 *                 installed" in one glance and gets out of the way.
 *
 *   The detail    everything about one extension, in the order somebody asks
 *                 about it: what it contributes, what it is set to, what it is
 *                 allowed to do, where it can reach, and how to remove it.
 *
 * What this replaces was a single scroll with an extension's contributions
 * flattened into unlabelled chips — two of them reading "Cloud Backup" because
 * two different slots happened to share a label — above a permissions block
 * for every extension at once. There was no way to tell a page from a command,
 * and no way to look at one extension.
 *
 * The lower half of the detail screen is AuthNo's, not the extension's. It
 * appears whether or not the author thought about it, which is the whole
 * reason it is worth anything: an extension cannot choose not to be explained.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DSIcons, Toggle, COLORS, RADIUS, SPACING, TYPOGRAPHY, toast,
} from '../DesignSystem';
import { useExtensions } from '../utils/ExtensionContext';
import { buildExtensionsTab } from '../utils/extensionSettingsModel';
import { readGrants } from '../utils/extensionGrants';
import { setGrants, hostV2 } from '../utils/extensionRuntime';
import { permissionRequests } from '../utils/permissionRequests';
import { promptPlan } from '../utils/extensionPermissionsV2';
import { isAndroid } from '../utils/platform';
import { hapticDelete } from '../utils/haptics';
import { ContributionIcon, contributionIconName } from './contributionIcon';
import ExtensionSettingsPage from './ExtensionSettingsPage';

// ── shared bits ──────────────────────────────────────────────────────────────

const card = {
  background: 'var(--surface)',
  border: '1px solid var(--border-sm)',
  borderRadius: RADIUS.md,
  overflow: 'hidden',
};

const hd = {
  fontFamily: TYPOGRAPHY.mono,
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-4)',
  padding: '11px 14px 9px',
  borderBottom: '1px solid var(--border-sm)',
};

// `boxSizing` is load-bearing, not tidiness: this project sets no global
// border-box rule, so `width:100%` plus 28px of horizontal padding is 28px
// wider than the card. Every toggle and every value on the right hand side
// was clipped off the screen.
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '13px 14px', borderBottom: '1px solid var(--border-sm)',
  background: 'none', border: 'none', width: '100%', textAlign: 'left',
  boxSizing: 'border-box',
};

const l1 = { fontSize: 14, color: 'var(--text-1)', lineHeight: 1.35 };
const l2 = { fontSize: 12, color: 'var(--text-4)', marginTop: 3, lineHeight: 1.4 };
// Not `nowrap`: an identifier or a long date is what pushed the card past the
// screen edge, and a value that wraps is better than one that is cut off.
const val = {
  fontFamily: TYPOGRAPHY.mono, fontSize: 13, color: 'var(--text-3)',
  textAlign: 'right', minWidth: 0, wordBreak: 'break-word',
};

/** Rows are separated by hairlines, and the last one must not draw one. */
function Rows({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{'.xrows > *:last-child{border-bottom:0 !important}'}</style>
      <div className="xrows" style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

/** The gradient square an extension is known by. */
function IconTile({ item, size = 30, accentHex, dim = false }) {
  const radius = size >= 44 ? 14 : 9;
  return (
    <span style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      display: 'grid', placeItems: 'center',
      background: `linear-gradient(135deg, ${accentHex}, ${accentHex}88)`,
      boxShadow: `0 0 ${size / 2}px ${accentHex}38`,
      opacity: dim ? 0.45 : 1,
    }}>
      <ContributionIcon item={item} size={Math.round(size * 0.52)} color="var(--on-accent, #fff)" />
    </span>
  );
}

function Pill({ tone, children }) {
  const map = {
    ok: [COLORS.success, COLORS.successSoft],
    warn: [COLORS.warning, COLORS.warningSoft],
    off: ['var(--text-4)', 'var(--surface-md)'],
  };
  const [fg, bg] = map[tone] ?? map.off;
  return (
    <span style={{
      fontFamily: TYPOGRAPHY.mono, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: RADIUS.full,
      color: fg, background: bg, whiteSpace: 'nowrap', flexShrink: 0,
    }}>{children}</span>
  );
}

/** The small mono tag that says what kind of thing a contribution is. */
function Kind({ children }) {
  return (
    <span style={{
      marginLeft: 'auto', fontFamily: TYPOGRAPHY.mono, fontSize: 9,
      letterSpacing: '0.07em', textTransform: 'uppercase',
      color: 'var(--text-5)', border: '1px solid var(--border-sm)',
      borderRadius: 4, padding: '1px 5px', flexShrink: 0,
    }}>{children}</span>
  );
}

// ── what the list row says about an extension ────────────────────────────────

/**
 * "2.0.1 · 5 permissions · running".
 *
 * The mock's third part was the extension's own状態 — "syncing", "watching your
 * typing" — which the app cannot know and must not invent. What it does know
 * is whether the thing is running, and that is the fact somebody is checking
 * for when an extension appears to do nothing.
 */
function summarise(row) {
  const bits = [];
  if (row.version) bits.push(row.version);
  const n = row.permissions.length;
  if (n) bits.push(n === 1 ? '1 permission' : `${n} permissions`);
  else bits.push('no permissions');
  if (row.blocked === 'too-old') bits.push('needs a newer AuthNo');
  else if (row.blocked === 'locked') bits.push('not included in your plan');
  else if (row.blocked === 'disabled') bits.push('turned off');
  else if (row.blocked === 'failed') bits.push('failed to start');
  else bits.push(row.running ? 'running' : 'stopped');
  return bits.join(' · ');
}

function toneFor(row) {
  if (row.warnings.length) return 'warn';
  return row.running ? 'ok' : 'off';
}

function pillFor(row) {
  if (row.warnings.length) return '!';
  return row.running ? 'On' : 'Off';
}

/**
 * How a granted permission has been used, in a sentence.
 *
 * Only what this run of the extension has seen — the ledger lives on the
 * running host and dies with it. A stopped extension has none, so the row
 * falls back to the author's own reason, which is the more useful of the two
 * things that could go there when there is nothing to count.
 */
function usageLine(perm, uses) {
  if (perm.permission === 'network') {
    const hosts = [...(perm.hosts ?? []), ...(perm.userHosts ?? [])];
    if (hosts.length) return hosts.map(shortHost).join(', ');
  }
  if (!uses) return perm.reason ? `“${perm.reason}”` : null;
  const u = uses.get(perm.permission);
  if (!u || u.count === 0) return 'Never used';
  if (u.today > 0) {
    return u.today === 1 ? 'Used once today' : `Used ${u.today} times today`;
  }
  if (u.count === 1) return 'Used once';
  if (u.count === 2) return 'Used twice';
  return `Used ${u.count} times`;
}

const shortHost = (h) => String(h).replace(/^https?:\/\//, '').replace(/\/$/, '');

// ── the list ─────────────────────────────────────────────────────────────────

function ExtensionRow({ row, manifest, accentHex, onOpen }) {
  return (
    <button onClick={() => onOpen(row.id)} style={{ ...rowStyle, cursor: 'pointer' }}>
      <IconTile item={manifest ?? {}} accentHex={accentHex} dim={row.dimIcon} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...l1, display: 'block', fontWeight: 600, opacity: row.dimmed ? 0.6 : 1 }}>
          {row.name}
        </span>
        <span style={{ ...l2, display: 'block' }}>{summarise(row)}</span>
      </span>
      <Pill tone={toneFor(row)}>{pillFor(row)}</Pill>
      <DSIcons.ChevronRight size={14} color="var(--text-5)" />
    </button>
  );
}

/**
 * The system speaking, not the extension complaining.
 *
 * An extension that keeps being refused something looks broken from outside,
 * and the app knows exactly why. The two buttons are the whole point: the
 * sentence is only worth writing if it comes with the thing that fixes it.
 */
function Banner({ row, warning, accentHex, onFix, onDismiss }) {
  const tone = warning.kind === 'failed' || warning.kind === 'bad-settings-schema'
    ? COLORS.danger : COLORS.warning;
  return (
    <div style={{
      display: 'flex', gap: 11, padding: '13px 14px', borderRadius: RADIUS.md,
      background: `${tone}14`, border: `1px solid ${tone}4d`,
    }}>
      <DSIcons.Warning size={15} color={tone} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.35 }}>
          {row.name}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.45 }}>
          {warning.text}
        </div>
        {warning.canFixHere && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={onFix} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: RADIUS.sm,
              border: 'none', background: accentHex, color: 'var(--on-accent, #fff)', cursor: 'pointer',
            }}>Allow</button>
            <button onClick={onDismiss} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: RADIUS.sm,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-3)', cursor: 'pointer',
            }}>Not now</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── the detail ───────────────────────────────────────────────────────────────

/** Every contribution the manifest declares, with the kind of thing it is. */
function contributionsOf(manifest) {
  const c = manifest?.contributes ?? {};
  const out = [];
  const push = (item, slot) => out.push({
    ...item,
    _slot: slot,
    _kind: item.command ? 'command' : item.page ? 'page' : 'panel',
  });
  for (const slot of ['settings', 'homescreen', 'bookActions', 'chapterActions', 'editorToolbar']) {
    const items = Array.isArray(c[slot]) ? c[slot] : [];
    items.forEach((i) => push(i, slot));
  }
  // v1 shape, still installed on somebody's phone.
  const bd = c.bookDashboard;
  if (bd) {
    (bd.tabs ?? []).forEach((i) => push(i, 'bookActions'));
    (bd.actions ?? []).forEach((i) => push(i, 'bookActions'));
  }
  return out;
}

const WHERE_SLOT = {
  settings: 'Settings', homescreen: 'Home',
  bookActions: 'Book', chapterActions: 'Chapter', editorToolbar: 'Editor',
};

function Detail({
  row, manifest, accentHex, uses,
  onBack, onRun, onToggle, onRevokeHost, onReview, onUninstall,
}) {
  const contribs = useMemo(() => contributionsOf(manifest), [manifest]);
  const hasSchema = (manifest?.settings?.schema?.length ?? 0) > 0;
  const network = row.permissions.find((p) => p.permission === 'network');
  const hosts = network
    ? [...(network.hosts ?? []), ...(network.userHosts ?? [])]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
        background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
        color: 'var(--text-3)', fontSize: 13,
      }}>
        <DSIcons.ChevronLeft size={14} /> Extensions
      </button>

      {/* Identity */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <IconTile item={manifest ?? {}} size={52} accentHex={accentHex} dim={row.dimIcon} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text-1)', lineHeight: 1.3 }}>
            {row.name}
          </div>
          <div style={{ fontFamily: TYPOGRAPHY.mono, fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>
            {[row.version, row.author].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {row.warnings.map((w, i) => (
        <Banner key={`${w.kind}-${i}`} row={row} warning={w} accentHex={accentHex}
          onFix={() => onReview(row)} onDismiss={onBack} />
      ))}

      {/* What it adds, and where. The kind tag is the fix for a screen that
          could not tell a page from a command — "Back up now" opened the
          settings page, because `page` was the only target a chip had. */}
      {contribs.length > 0 && (
        <div style={card}>
          <div style={hd}>What it adds</div>
          <Rows>
            {contribs.map((c, i) => (
              <button key={`${c._slot}-${c.id ?? c.label}-${i}`}
                onClick={() => onRun(c)}
                style={{ ...rowStyle, cursor: 'pointer' }}>
                <ContributionIcon item={c} size={15} color="var(--text-3)" slot={c._slot} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...l1, display: 'block' }}>{c.label}</span>
                  <span style={{ ...l2, display: 'block' }}>{WHERE_SLOT[c._slot] ?? c._slot}</span>
                </span>
                <Kind>{c._kind}</Kind>
              </button>
            ))}
          </Rows>
        </div>
      )}

      {/* The extension's own settings — a schema block it wrote, drawn by us.
          Inside the same card as everything else, because the point of a
          schema page is that an extension's settings look like settings
          rather than like whatever its author would have built. */}
      {hasSchema && (
        <div style={{ ...card, padding: '0 0 14px' }}>
          <div style={hd}>Settings</div>
          <div style={{ padding: '2px 14px 0' }}>
            <ExtensionSettingsPage manifest={manifest} accentHex={accentHex} running={row.running} />
          </div>
        </div>
      )}

      {/* ── Everything below is AuthNo's, not the extension's ─────────────── */}

      {row.permissions.length > 0 && (
        <div style={card}>
          <div style={hd}>Permissions</div>
          <Rows>
            {row.permissions.map((p) => (
              <div key={p.permission} style={rowStyle}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...l1, display: 'block' }}>{p.prompt}</span>
                  {usageLine(p, uses) && (
                    <span style={{ ...l2, display: 'block', wordBreak: 'break-word' }}>
                      {usageLine(p, uses)}
                    </span>
                  )}
                  {p.inert && (
                    <span style={{ ...l2, display: 'block' }}>Not built yet — this does nothing.</span>
                  )}
                </span>
                <span style={{ flexShrink: 0, display: 'flex' }}><Toggle
                  checked={p.granted}
                  onChange={(on) => onToggle(row, p.permission, on)}
                  disabled={p.inert}
                  accentHex={accentHex}
                  ariaLabel={p.prompt}
                /></span>
              </div>
            ))}
          </Rows>
        </div>
      )}

      {network && (
        <div style={card}>
          <div style={hd}>Where it can connect</div>
          <Rows>
            {hosts.map((h) => (
              <div key={h} style={rowStyle}>
                <span style={{ ...l1, flex: 1, minWidth: 0, fontFamily: TYPOGRAPHY.mono, fontSize: 12.5, wordBreak: 'break-all' }}>
                  {shortHost(h)}
                </span>
                {(network.userHosts ?? []).includes(h) && (
                  <button onClick={() => onRevokeHost(row, h)} style={{
                    flexShrink: 0, padding: '3px 8px', borderRadius: RADIUS.sm,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text-4)', fontSize: 11, cursor: 'pointer',
                  }}>Remove</button>
                )}
              </div>
            ))}
            {/* The sentence that makes the card worth having. It is not a log
                of what happened to be contacted — the frame's policy is built
                from this list, so it is the complete set of what CAN be. */}
            <div style={{ ...rowStyle, paddingTop: 11, paddingBottom: 13 }}>
              <span style={{ ...l2, marginTop: 0 }}>
                {network.granted
                  ? 'No other host can be reached.'
                  : 'Nothing can be reached — you have not allowed this.'}
              </span>
            </div>
          </Rows>
        </div>
      )}

      <div style={card}>
        <Rows>
          <div style={rowStyle}>
            <span style={{ ...l1, flex: 1 }}>Version</span>
            <span style={val}>{row.version || '—'}</span>
          </div>
          {row.installedAt && (
            <div style={rowStyle}>
              <span style={{ ...l1, flex: 1 }}>Installed</span>
              <span style={val}>{formatDay(row.installedAt)}</span>
            </div>
          )}
          <div style={rowStyle}>
            <span style={{ ...l1, flex: 1 }}>Identifier</span>
            <span style={{ ...val, fontSize: 11.5, wordBreak: 'break-all' }}>{row.id}</span>
          </div>
          <button onClick={onUninstall} style={{ ...rowStyle, cursor: 'pointer' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ ...l1, display: 'block', color: COLORS.danger }}>Uninstall</span>
              <span style={{ ...l2, display: 'block' }}>Removes its settings and permissions too</span>
            </span>
          </button>
        </Rows>
      </div>
    </div>
  );
}

function formatDay(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── the panel ────────────────────────────────────────────────────────────────

export default function ExtensionsPanel({ accentHex = COLORS.violetDark, session = null, onClose }) {
  const { extensions, loading, refresh, installExtbk, uninstall, clearConfig, runContribution } = useExtensions();
  const [openId, setOpenId] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [busy, setBusy] = useState(null);
  const [, forceRender] = useState(0);

  // The ledger lives on the running host and changes as the extension works,
  // so what is on screen is only current while somebody is looking. A slow
  // tick rather than a subscription: there is no change event, and a count
  // moving from 40 to 41 is not urgent enough to invent one.
  useEffect(() => {
    const t = setInterval(() => forceRender((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const tab = useMemo(
    () => buildExtensionsTab({
      extensions,
      grantsFor: (id) => readGrants(id).granted,
      userHostsFor: (id) => readGrants(id).userHosts,
      askedFor: (id) => readGrants(id).asked,
      hostFor: (id) => hostV2(id),
    }),
    [extensions, busy], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const change = useCallback(async (extId, next, hosts) => {
    setBusy(extId);
    try {
      await setGrants(extId, next, hosts);
    } catch (e) {
      toast(`Could not change permissions: ${e.message}`, { variant: 'danger' });
    } finally {
      setBusy(null);
      forceRender((n) => n + 1);
    }
  }, []);

  const toggle = useCallback((row, permission, on) => {
    const held = new Set(readGrants(row.id).granted);
    if (on) held.add(permission); else held.delete(permission);
    return change(row.id, [...held], null);
  }, [change]);

  const revokeHost = useCallback((row, host) => {
    const { granted, userHosts } = readGrants(row.id);
    return change(row.id, granted, userHosts.filter((h) => h !== host));
  }, [change]);

  /**
   * Put the questions that were never asked — the same queue and the same
   * sheet the install would have used, rather than a second screen with subtly
   * different words for the same decision.
   */
  const review = useCallback((row) => {
    const manifest = extensions.find((e) => e.id === row.id);
    if (!manifest) return;
    const plan = promptPlan(manifest.permissions, readGrants(row.id).granted);
    permissionRequests()
      .ask(row.id, plan, { name: row.name, version: row.version, icon: row.icon })
      .then((answered) => change(row.id, answered, null))
      .catch(() => { /* the queue was full; the banner stays and can be retried */ });
  }, [extensions, change]);

  const installFromFile = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    try {
      if (isAndroid()) {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin = registerPlugin('AuthnoFilePicker');
        const res = await plugin.pickFile?.({ mimeTypes: ['*/*'], extension: 'extbk' });
        if (res?.base64) await installExtbk(res.base64);
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.extbk,application/octet-stream';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const buf = new Uint8Array(await file.arrayBuffer());
          let bin = ''; const CH = 0x8000;
          for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
          await installExtbk(btoa(bin));
        };
        input.click();
      }
    } catch (e) {
      // installExtbkBytes already emitted an error event for the InstallSheet.
      console.error('[ExtensionsPanel] install from file failed', e);
    } finally {
      setInstalling(false);
    }
  }, [installing, installExtbk]);

  const remove = useCallback(async (row) => {
    try {
      hapticDelete();
      await uninstall?.(row.id);
      clearConfig?.(row.id);
      setConfirmRemove(null);
      setOpenId(null);
      toast(`${row.name} removed`, { variant: 'success' });
    } catch (e) {
      toast(`Could not remove ${row.name}: ${e.message}`, { variant: 'danger' });
    }
  }, [uninstall, clearConfig]);

  const open = tab.rows.find((r) => r.id === openId) ?? null;
  const openManifest = open ? extensions.find((e) => e.id === open.id) : null;

  /** The live ledger for one extension, as a map the rows can read. */
  const uses = useMemo(() => {
    if (!open) return null;
    const host = hostV2(open.id);
    const list = host?.usedPermissions?.();
    if (!list) return null;
    return new Map(list.map((u) => [u.permission, u]));
    // forceRender's tick is what re-reads this; `busy` covers a grant change.
  }, [open, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-4)', fontSize: 12.5 }}>
        Loading extensions…
      </div>
    );
  }

  if (open && openManifest) {
    return (
      <>
        <Detail
          row={open} manifest={openManifest} accentHex={accentHex} uses={uses}
          onBack={() => setOpenId(null)}
          onRun={(c) => {
            runContribution(openManifest, c, session).then((r) => {
              if (r?.did === 'page') onClose?.();
            });
          }}
          onToggle={toggle}
          onRevokeHost={revokeHost}
          onReview={review}
          onUninstall={() => setConfirmRemove(open)}
        />
        {confirmRemove && <ConfirmRemove row={confirmRemove} onCancel={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)} />}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tab.exists ? (
        <>
          <div style={card}>
            <Rows>
              {tab.rows.map((row) => (
                <ExtensionRow key={row.id} row={row} accentHex={accentHex}
                  manifest={extensions.find((e) => e.id === row.id)}
                  onOpen={setOpenId} />
              ))}
            </Rows>
          </div>

          {/* One banner per extension with something wrong, under the list
              rather than inside a row: a row is an identity, and a sentence
              about a problem is not part of what a thing is. */}
          {tab.rows.flatMap((row) => row.warnings.map((w, i) => (
            <Banner key={`${row.id}-${i}`} row={row} warning={w} accentHex={accentHex}
              onFix={() => review(row)} onDismiss={() => setOpenId(row.id)} />
          )))}
        </>
      ) : (
        <div style={{ ...card, padding: 22, textAlign: 'center' }}>
          <DSIcons.Extension size={26} color="var(--text-5)" />
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', fontWeight: 600, marginTop: 10 }}>
            No extensions yet
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginTop: 5, lineHeight: 1.5 }}>
            Extensions add pages, actions and integrations to AuthNo.
            Install one below, or open a .extbk from your files.
          </div>
        </div>
      )}

      <button onClick={installFromFile} disabled={installing} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: '11px 0', borderRadius: RADIUS.md,
        background: 'var(--surface)', border: '1px dashed var(--border)',
        color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600,
        cursor: installing ? 'default' : 'pointer', opacity: installing ? 0.6 : 1,
      }}>
        <DSIcons.Download size={14} />
        {installing ? 'Choosing file…' : 'Install from file (.extbk)'}
      </button>

      <button onClick={refresh} style={{
        alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-4)', fontSize: 12, padding: '2px 8px',
      }}>
        <DSIcons.Refresh size={12} /> Refresh
      </button>

      {confirmRemove && <ConfirmRemove row={confirmRemove} onCancel={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)} />}
    </div>
  );
}

function ConfirmRemove({ row, onCancel, onConfirm }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'var(--modal-overlay-bg, rgba(0,0,0,0.7))', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 320, padding: 20, borderRadius: RADIUS.lg,
        background: 'var(--modal-bg)', border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-1)' }}>
          Remove {row.name}?
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.5 }}>
          Its settings and permissions go with it. Your books are not touched.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '9px 0', borderRadius: RADIUS.sm,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Keep it</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: '9px 0', borderRadius: RADIUS.sm, border: 'none',
            background: COLORS.danger, color: COLORS.onDanger,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Remove</button>
        </div>
      </div>
    </div>
  );
}

export { contributionsOf, summarise, usageLine };

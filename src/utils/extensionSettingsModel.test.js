import { buildExtensionsTab, BLOCKED, STRINGS } from './extensionSettingsModel.js';
import { permissionSetFor } from './extensionPermissionsV2.js';

const CLOUD_BACKUP = {
  apiVersion: 2,
  id: 'cloud-backup',
  name: 'Cloud Backup',
  version: '2.0.0',
  author: 'Aurora Studios',
  icon: 'Cloud',
  installedAt: 1700000000000,
  permissions: {
    'library:read:all': { reason: 'To upload every book, not just the open one.' },
    network: { reason: 'To talk to Dropbox.', hosts: ['https://api.dropbox.com'] },
    background: { reason: 'To sync while AuthNo is closed.' },
  },
  settings: {
    schema: [
      { key: 'wifiOnly', type: 'toggle', label: 'Only on Wi-Fi', default: true },
      { key: 'interval', type: 'number', label: 'Sync every', min: 5, max: 60, default: 30 },
    ],
  },
};

const WORDCOUNT = {
  apiVersion: 2, id: 'wordcount', name: 'A Word Counter', version: '1.0.0',
  permissions: { activity: { reason: 'To count as you type.' } },
};

/** A host whose ledger already has some refusals in it. */
function hostWith(missing) {
  return { missingPermissions: () => missing };
}

describe('the tab exists only when there is something in it', () => {
  test('no extensions, no tab', () => {
    // An empty settings section is a promise the app has not kept.
    expect(buildExtensionsTab({ extensions: [] })).toEqual({ exists: false, rows: [] });
    expect(buildExtensionsTab({}).exists).toBe(false);
    expect(buildExtensionsTab().exists).toBe(false);
  });

  test('one extension is enough', () => {
    const tab = buildExtensionsTab({ extensions: [WORDCOUNT] });
    expect(tab.exists).toBe(true);
    expect(tab.rows).toHaveLength(1);
  });

  test('rows are sorted by name, not install order', () => {
    const tab = buildExtensionsTab({ extensions: [WORDCOUNT, CLOUD_BACKUP] });
    expect(tab.rows.map((r) => r.name)).toEqual(['A Word Counter', 'Cloud Backup']);
  });

  test('nulls in the list do not become rows', () => {
    const tab = buildExtensionsTab({ extensions: [null, WORDCOUNT, undefined] });
    expect(tab.rows).toHaveLength(1);
  });
});

describe('identity and state', () => {
  test('a row carries what §6.1 says the app owns', () => {
    const [row] = buildExtensionsTab({ extensions: [CLOUD_BACKUP] }).rows;
    expect(row).toMatchObject({
      id: 'cloud-backup', name: 'Cloud Backup', version: '2.0.0',
      author: 'Aurora Studios', icon: 'Cloud', installedAt: 1700000000000,
    });
  });

  test('running is decided by whether a host exists, not by a flag', () => {
    const tab = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      hostFor: (id) => (id === 'cloud-backup' ? hostWith([]) : null),
    });
    expect(tab.rows[0].running).toBe(true);
  });

  test('a disabled extension is greyed — icon included', () => {
    // One you cannot find is one you cannot re-enable, and an icon left bright
    // on a dimmed row looks like a rendering bug rather than a state.
    const [row] = buildExtensionsTab({
      extensions: [{ ...CLOUD_BACKUP, enabled: false }],
    }).rows;
    expect(row.blocked).toBe(BLOCKED.DISABLED);
    expect(row.dimmed).toBe(true);
    expect(row.dimIcon).toBe(true);
    expect(row.icon).toBe('Cloud');       // still present, just dimmed
    expect(row.name).toBe('Cloud Backup');
  });

  test('the blocked reasons have a fixed precedence', () => {
    const both = { ...CLOUD_BACKUP, _tooOld: true, _locked: true, enabled: false };
    expect(buildExtensionsTab({ extensions: [both] }).rows[0].blocked).toBe(BLOCKED.TOO_OLD);

    const locked = { ...CLOUD_BACKUP, _locked: true, enabled: false };
    expect(buildExtensionsTab({ extensions: [locked] }).rows[0].blocked).toBe(BLOCKED.LOCKED);
  });

  test('an unblocked extension is not dimmed', () => {
    const [row] = buildExtensionsTab({ extensions: [CLOUD_BACKUP] }).rows;
    expect(row.blocked).toBeNull();
    expect(row.dimmed).toBe(false);
  });

  test('enable cannot be toggled for something the app itself is blocking', () => {
    const tooOld = buildExtensionsTab({ extensions: [{ ...CLOUD_BACKUP, _tooOld: true }] }).rows[0];
    const locked = buildExtensionsTab({ extensions: [{ ...CLOUD_BACKUP, _locked: true }] }).rows[0];
    const normal = buildExtensionsTab({ extensions: [CLOUD_BACKUP] }).rows[0];
    expect(tooOld.actions.canToggleEnabled).toBe(false);
    expect(locked.actions.canToggleEnabled).toBe(false);
    expect(normal.actions.canToggleEnabled).toBe(true);
  });
});

describe('permission rows', () => {
  test('every declared permission gets a row, granted or not', () => {
    // Showing only what was said yes to makes the screen a list of grants
    // rather than the list of questions with their answers.
    const [row] = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      grantsFor: () => ['library:read:all'],
    }).rows;

    expect(row.permissions.map((p) => p.permission))
      .toEqual(['background', 'library:read:all', 'network']);
    expect(row.permissions.find((p) => p.permission === 'library:read:all').granted).toBe(true);
    expect(row.permissions.find((p) => p.permission === 'network').granted).toBe(false);
  });

  test('the author reason sits with the toggle that acts on it', () => {
    const [row] = buildExtensionsTab({ extensions: [CLOUD_BACKUP] }).rows;
    const net = row.permissions.find((p) => p.permission === 'network');
    expect(net.reason).toBe('To talk to Dropbox.');
    expect(net.prompt).toBe('Connect to the internet');
    expect(net.hosts).toEqual(['https://api.dropbox.com']);
  });

  test('a not-yet-honoured permission is marked inert', () => {
    // A toggle that changes nothing is worse than one that is not offered.
    const [row] = buildExtensionsTab({ extensions: [CLOUD_BACKUP] }).rows;
    expect(row.permissions.find((p) => p.permission === 'background').inert).toBe(true);
    expect(row.permissions.find((p) => p.permission === 'network').inert).toBe(false);
  });

  test('an unknown permission in a manifest does not become a row', () => {
    const [row] = buildExtensionsTab({
      extensions: [{ ...CLOUD_BACKUP, permissions: { 'library:read:nonsense': { reason: 'r' } } }],
    }).rows;
    expect(row.permissions).toEqual([]);
  });

  test('hosts appear only for network', () => {
    const [row] = buildExtensionsTab({ extensions: [CLOUD_BACKUP] }).rows;
    expect(row.permissions.find((p) => p.permission === 'library:read:all').hosts).toBeUndefined();
  });
});

describe('warnings', () => {
  test('a permission an extension keeps reaching for is surfaced', () => {
    // The alternative is an extension that silently looks broken while the app
    // knows exactly why.
    const [row] = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      grantsFor: () => [],
      hostFor: () => hostWith([
        { permission: 'library:read:all', count: 12, wasRequested: true, prompt: 'Read all your books' },
      ]),
    }).rows;

    const warn = row.warnings.find((w) => w.kind === 'missing-permission');
    expect(warn.count).toBe(12);
    expect(warn.text).toBe(STRINGS.permissionRefused);
    expect(warn.canFixHere).toBe(true);
  });

  test('"the user refused" and "the author never asked" read differently', () => {
    const [row] = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      hostFor: () => hostWith([
        { permission: 'library:read:all', count: 3, wasRequested: true, prompt: 'p' },
        { permission: 'browser', count: 1, wasRequested: false, prompt: 'p' },
      ]),
    }).rows;

    const byPerm = Object.fromEntries(
      row.warnings.filter((w) => w.kind === 'missing-permission').map((w) => [w.permission, w]),
    );
    expect(byPerm['library:read:all'].text).toBe(STRINGS.permissionRefused);
    expect(byPerm.browser.text).toBe(STRINGS.permissionUndeclared);
    // An undeclared permission has no row to toggle, so the warning must not
    // offer a fix that is not there.
    expect(byPerm.browser.canFixHere).toBe(false);
  });

  test('warnings are worst first', () => {
    const [row] = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      hostFor: () => hostWith([
        { permission: 'network', count: 2, wasRequested: true, prompt: 'p' },
        { permission: 'library:read:all', count: 40, wasRequested: true, prompt: 'p' },
      ]),
    }).rows;
    expect(row.warnings.map((w) => w.count)).toEqual([40, 2]);
  });

  test('granting the permission removes the warning', () => {
    const perms = permissionSetFor(CLOUD_BACKUP, []);
    try { perms.require('library.list'); } catch { /* counted */ }
    const host = { missingPermissions: () => perms.missing() };

    const before = buildExtensionsTab({ extensions: [CLOUD_BACKUP], hostFor: () => host }).rows[0];
    expect(before.warnings).toHaveLength(1);

    perms.grant('library:read:all');
    const after = buildExtensionsTab({ extensions: [CLOUD_BACKUP], hostFor: () => host }).rows[0];
    expect(after.warnings).toHaveLength(0);
  });

  test('an extension too old for this app says so', () => {
    const [row] = buildExtensionsTab({
      extensions: [{ ...CLOUD_BACKUP, _tooOld: true, minAppVersion: '9.0.0' }],
    }).rows;
    expect(row.warnings[0]).toMatchObject({ kind: 'too-old', minAppVersion: '9.0.0' });
  });

  test('an extension that failed to start says so', () => {
    const [row] = buildExtensionsTab({ extensions: [{ ...CLOUD_BACKUP, _failed: true }] }).rows;
    expect(row.warnings[0].kind).toBe('failed');
  });

  test('a broken settings schema is a warning, not a crash', () => {
    const [row] = buildExtensionsTab({
      extensions: [{ ...CLOUD_BACKUP, settings: { schema: [{ type: 'nonsense' }] } }],
    }).rows;
    const warn = row.warnings.find((w) => w.kind === 'bad-settings-schema');
    expect(warn.errors.length).toBeGreaterThan(0);
    expect(row.settings.schema).toEqual([]);
    expect(row.actions.canOpenSettingsPage).toBe(false);
  });

  test('the tab counts how many extensions want attention', () => {
    const tab = buildExtensionsTab({
      extensions: [CLOUD_BACKUP, WORDCOUNT],
      hostFor: (id) => (id === 'cloud-backup'
        ? hostWith([{ permission: 'network', count: 1, wasRequested: true, prompt: 'p' }])
        : hostWith([])),
    });
    expect(tab.needsAttention).toBe(1);
  });

  test('a host with no ledger at all does not throw', () => {
    const tab = buildExtensionsTab({ extensions: [CLOUD_BACKUP], hostFor: () => ({}) });
    expect(tab.rows[0].warnings).toEqual([]);
  });
});

describe('settings on the row', () => {
  test('values are reconciled against the schema', () => {
    const [row] = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      valuesFor: () => ({ wifiOnly: false, interval: 45, gone: 'x' }),
    }).rows;
    expect(row.settings.values).toEqual({ wifiOnly: false, interval: 45 });
    expect(row.settings.dropped).toEqual(['gone']);
  });

  test('an out-of-range stored value falls back and is reported', () => {
    const [row] = buildExtensionsTab({
      extensions: [CLOUD_BACKUP],
      valuesFor: () => ({ wifiOnly: true, interval: 9999 }),
    }).rows;
    expect(row.settings.values.interval).toBe(30);
    expect(row.settings.reset).toEqual(['interval']);
  });

  test('an extension with no settings cannot open a settings page', () => {
    const [row] = buildExtensionsTab({ extensions: [WORDCOUNT] }).rows;
    expect(row.actions.canOpenSettingsPage).toBe(false);
    expect(row.settings.values).toEqual({});
  });

  test('update-from-file and uninstall are always available', () => {
    // Including for something blocked: an extension too old to run is exactly
    // one somebody wants to update or remove.
    const [row] = buildExtensionsTab({ extensions: [{ ...CLOUD_BACKUP, _tooOld: true }] }).rows;
    expect(row.actions.canUpdateFromFile).toBe(true);
    expect(row.actions.canUninstall).toBe(true);
  });
});

describe('the copy is reviewable in one place', () => {
  test('every warning string comes from STRINGS', () => {
    const known = new Set(Object.values(STRINGS));
    const tab = buildExtensionsTab({
      extensions: [{ ...CLOUD_BACKUP, _tooOld: true, settings: { schema: [{ type: 'bad' }] } }],
      hostFor: () => hostWith([
        { permission: 'network', count: 1, wasRequested: true, prompt: 'p' },
        { permission: 'browser', count: 1, wasRequested: false, prompt: 'p' },
      ]),
    });
    for (const w of tab.rows[0].warnings) {
      expect({ kind: w.kind, fromStrings: known.has(w.text) })
        .toEqual({ kind: w.kind, fromStrings: true });
    }
  });

  test('no string describes how the system works internally', () => {
    // House rule: copy says what happened and what can be done, never what the
    // app does under the hood.
    for (const s of Object.values(STRINGS)) {
      expect(s).not.toMatch(/sandbox|iframe|dispatch|CSP|token|encrypt|key file|bridge/i);
    }
  });
});

import {
  PERMISSIONS, FREE_METHODS, permissionForMethod,
  validatePermissions, hostProblem, declaredHosts,
  buildCsp, PermissionSet, PermissionDenied, UnknownMethod,
  promptPlan, permissionSetFor, MAX_REASON,
} from './extensionPermissionsV2.js';

const CLOUD_BACKUP = {
  apiVersion: 2,
  id: 'cloud-backup',
  permissions: {
    'library:read:all': { reason: 'To upload every book, not just the open one.' },
    'library:write': { reason: 'To restore a book you pick from the cloud.' },
    network: {
      reason: 'To talk to Dropbox.',
      hosts: ['https://api.dropbox.com', 'https://content.dropboxapi.com'],
    },
  },
};

describe('manifest validation', () => {
  test('the Cloud Backup manifest validates', () => {
    const r = validatePermissions(CLOUD_BACKUP.permissions);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.requested.sort()).toEqual(['library:read:all', 'library:write', 'network']);
  });

  test('no permissions block is valid — an extension may want nothing', () => {
    expect(validatePermissions(undefined).ok).toBe(true);
    expect(validatePermissions({}).ok).toBe(true);
  });

  test('an unknown permission is an ERROR, not a warning', () => {
    // A typo that is merely ignored means "not requested", and the extension
    // then fails at runtime somewhere nobody is looking.
    const r = validatePermissions({ 'library:read:al': { reason: 'typo' } });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/unknown permission/);
  });

  test('a missing reason fails the build', () => {
    expect(validatePermissions({ 'library:write': {} }).ok).toBe(false);
    expect(validatePermissions({ 'library:write': { reason: '' } }).ok).toBe(false);
    expect(validatePermissions({ 'library:write': { reason: '   ' } }).ok).toBe(false);
  });

  test('an over-long reason fails', () => {
    const r = validatePermissions({ 'library:write': { reason: 'x'.repeat(MAX_REASON + 1) } });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/limit is 120/);
  });

  test('a reason at exactly the limit passes', () => {
    expect(validatePermissions({ 'library:write': { reason: 'x'.repeat(MAX_REASON) } }).ok).toBe(true);
  });

  test('network without hosts is refused — an unbounded grant is not a grant', () => {
    expect(validatePermissions({ network: { reason: 'why' } }).ok).toBe(false);
    expect(validatePermissions({ network: { reason: 'why', hosts: [] } }).ok).toBe(false);
  });

  test('hosts on a permission that does not take them is an error', () => {
    const r = validatePermissions({ 'library:write': { reason: 'r', hosts: ['https://x.com'] } });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/does not take hosts/);
  });

  test('a deferred permission warns rather than failing', () => {
    const r = validatePermissions({ background: { reason: 'To sync while closed.' } });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/not honoured yet/);
  });

  test('every permission in the set has a prompt line', () => {
    for (const [name, def] of Object.entries(PERMISSIONS)) {
      expect({ name, hasPrompt: typeof def.prompt === 'string' && def.prompt.length > 0 })
        .toEqual({ name, hasPrompt: true });
    }
  });
});

describe('network hosts', () => {
  test('plain https origins are accepted', () => {
    expect(hostProblem('https://api.dropbox.com')).toBeNull();
    expect(hostProblem('https://content.dropboxapi.com')).toBeNull();
  });

  test('http is refused', () => {
    expect(hostProblem('http://api.dropbox.com')).toMatch(/https/);
  });

  test('a path makes it not an origin', () => {
    expect(hostProblem('https://api.dropbox.com/v2/files')).toMatch(/origin/);
    expect(hostProblem('https://api.dropbox.com/?a=1')).toMatch(/origin/);
  });

  test('a bare wildcard is not a grant', () => {
    expect(hostProblem('*')).toMatch(/not a grant/);
    expect(hostProblem('https://*')).toMatch(/not a grant/);
  });

  test('a one-label wildcard is allowed, a whole-domain one is not', () => {
    // Same rule as the site's CORS allowlist: https://*.pages.dev would grant
    // every project anybody has ever deployed there.
    expect(hostProblem('https://*.dropboxapi.com')).toBeNull();
    expect(hostProblem('https://*.com')).toMatch(/whole domain/);
    expect(hostProblem('https://api.*.com')).toMatch(/first label/);
  });

  test('declaredHosts drops the unacceptable ones', () => {
    expect(declaredHosts({
      network: { hosts: ['https://ok.com', 'http://bad.com', '*'] },
    })).toEqual(['https://ok.com']);
  });
});

describe('the content security policy', () => {
  test('with no network there is no channel out of the frame', () => {
    const csp = buildCsp([]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toMatch(/https:\/\//);
  });

  test('default-src none comes FIRST', () => {
    // connect-src does not cover <img>: measured, a beacon still reached the
    // server with connect-src 'none'. Building the policy by naming connect-src
    // and letting the rest default is the bug this ordering prevents.
    const csp = buildCsp(['https://api.dropbox.com']);
    expect(csp.indexOf("default-src 'none'")).toBe(0);
  });

  test('granted hosts appear in connect-src, img-src and media-src', () => {
    const csp = buildCsp(['https://api.dropbox.com']);
    expect(csp).toMatch(/connect-src https:\/\/api\.dropbox\.com/);
    expect(csp).toMatch(/img-src data: blob: https:\/\/api\.dropbox\.com/);
    expect(csp).toMatch(/media-src data: blob: https:\/\/api\.dropbox\.com/);
  });

  test('the escape hatches are all closed', () => {
    const csp = buildCsp(['https://api.dropbox.com']);
    for (const shut of [
      "form-action 'none'", "base-uri 'none'", "frame-src 'none'",
      "frame-ancestors 'none'", "object-src 'none'",
    ]) {
      expect(csp).toContain(shut);
    }
  });

  test('a bad host never reaches the policy', () => {
    // eslint-disable-next-line no-script-url
    const scriptUrl = 'javascript:alert(1)';
    const csp = buildCsp(['https://ok.com', 'http://bad.com', scriptUrl]);
    expect(csp).toContain('https://ok.com');
    expect(csp).not.toContain('bad.com');
    expect(csp).not.toContain('javascript:');
  });

  test('a refused network permission means no hosts, whatever was declared', () => {
    const set = permissionSetFor(CLOUD_BACKUP, ['library:read:all']);   // network denied
    expect(set.effectiveHosts()).toEqual([]);
    expect(set.csp()).toContain("connect-src 'none'");
    expect(set.csp()).not.toContain('dropbox');
  });
});

describe('the enforcement door', () => {
  const set = () => permissionSetFor(CLOUD_BACKUP, ['library:read:all', 'network']);

  test('a granted method passes', () => {
    expect(set().require('library.list')).toBe(true);
  });

  test('an ungranted method throws permission-denied', () => {
    const s = set();
    expect(() => s.require('library.export')).toThrow(PermissionDenied);
    const err = (() => { try { s.require('library.export'); return null; } catch (e) { return e; } })();
    expect(err.code).toBe('permission-denied');
    expect(err.permission).toBe('library:export');
    expect(err.method).toBe('library.export');
  });

  test('free methods need nothing', () => {
    const s = new PermissionSet([]);
    for (const method of FREE_METHODS) expect({ method, ok: s.require(method) }).toEqual({ method, ok: true });
  });

  test('ui.prompt and ui.confirm are free — a prompt reads and sends nothing', () => {
    const s = new PermissionSet([]);
    expect(s.require('ui.prompt')).toBe(true);
    expect(s.require('ui.confirm')).toBe(true);
  });

  test('an undeclared method is UnknownMethod, not a denial', () => {
    // Telling an author "permission denied" for a method that does not exist
    // sends them looking in the wrong place entirely.
    const s = set();
    expect(() => s.require('library.deleteEverything')).toThrow(UnknownMethod);
    expect(() => s.require('nonsense')).toThrow(UnknownMethod);
  });

  test('reading every book implies reading the open one', () => {
    // The alternative — listing library.get under both permissions — leaves the
    // reverse index with no single answer, and it silently keeps whichever was
    // declared last. That denied library.get to an extension holding exactly
    // the permission meant to allow it.
    const all = new PermissionSet(['library:read:all']);
    expect(all.has('library:read:current')).toBe(true);
    expect(all.require('library.get')).toBe(true);
    expect(all.require('library.list')).toBe(true);

    const current = new PermissionSet(['library:read:current']);
    expect(current.require('library.get')).toBe(true);
    expect(() => current.require('library.list')).toThrow(PermissionDenied);
    expect(() => current.require('library.getAny')).toThrow(PermissionDenied);
    expect(current.has('library:read:all')).toBe(false);
  });

  test('effective() expands implications for the settings screen', () => {
    expect(new PermissionSet(['library:read:all']).effective())
      .toEqual(['library:read:all', 'library:read:current']);
  });

  test('every gated method maps back to exactly one permission', () => {
    for (const [name, def] of Object.entries(PERMISSIONS)) {
      for (const method of def.methods) {
        expect({ method, perm: permissionForMethod(method) }).toEqual({ method, perm: name });
      }
    }
  });

  test('no method is both free and gated', () => {
    for (const method of FREE_METHODS) {
      expect({ method, gatedBy: permissionForMethod(method) }).toEqual({ method, gatedBy: null });
    }
  });

  test('activity is gated', () => {
    const s = new PermissionSet([]);
    expect(() => s.require('activity.getRate')).toThrow(PermissionDenied);
    s.grant('activity');
    expect(s.require('activity.getRate')).toBe(true);
  });
});

describe('grant lifecycle', () => {
  test('grant and revoke take effect immediately — no restart (§2.4)', () => {
    const s = permissionSetFor(CLOUD_BACKUP, []);
    expect(() => s.require('library.list')).toThrow(PermissionDenied);
    s.grant('library:read:all');
    expect(s.require('library.list')).toBe(true);
    s.revoke('library:read:all');
    expect(() => s.require('library.list')).toThrow(PermissionDenied);
  });

  test('granting an unknown permission is refused', () => {
    const s = new PermissionSet([]);
    expect(s.grant('library:read:everything')).toBe(false);
    expect(s.has('library:read:everything')).toBe(false);
  });

  test('a grant is only honoured while the manifest still declares it', () => {
    // Otherwise an update could keep a grant by deleting the declaration that
    // explained it to the user in the first place.
    const stripped = { ...CLOUD_BACKUP, permissions: { 'library:write': { reason: 'r' } } };
    const s = permissionSetFor(stripped, ['library:read:all', 'library:write']);
    expect(s.has('library:write')).toBe(true);
    expect(s.has('library:read:all')).toBe(false);
  });

  test('deny is never fatal — the extension runs inert', () => {
    const s = permissionSetFor(CLOUD_BACKUP, []);
    expect(s.require('ui.toast')).toBe(true);
    expect(s.require('storage.set')).toBe(true);
    expect(() => s.require('library.list')).toThrow(PermissionDenied);
  });
});

describe('the missing-permission ledger', () => {
  test('denials are counted so the app can warn instead of looking broken', () => {
    const s = permissionSetFor(CLOUD_BACKUP, []);
    for (let i = 0; i < 12; i++) { try { s.require('library.list'); } catch { /* counted */ } }
    try { s.require('library.get'); } catch { /* counted */ }

    const [worst] = s.missing();
    expect(worst.permission).toBe('library:read:all');
    expect(worst.count).toBe(13);
    expect(worst.methods).toEqual(['library.get', 'library.list']);
    expect(worst.prompt).toBe('Read all your books');
    expect(worst.wasRequested).toBe(true);
  });

  test('a denial is reported against the permission the author asked for', () => {
    // library.get is gated by library:read:current, but Cloud Backup declared
    // library:read:all — which implies it. The warning has to name the thing on
    // the consent screen, or the user is told to grant something they were
    // never offered.
    const s = permissionSetFor(CLOUD_BACKUP, []);
    let thrown;
    try { s.require('library.get'); } catch (e) { thrown = e; }

    expect(s.missing()[0].permission).toBe('library:read:all');
    expect(s.missing()[0].prompt).toBe('Read all your books');
    // The error itself still names the real gate, which is what an author
    // debugging their extension needs.
    expect(thrown.permission).toBe('library:read:current');
  });

  test('it separates "the user refused" from "the author never asked"', () => {
    const s = permissionSetFor(CLOUD_BACKUP, []);
    try { s.require('library.list'); } catch { /* declared, refused */ }
    try { s.require('browser.open'); } catch { /* never declared */ }

    const byName = Object.fromEntries(s.missing().map((m) => [m.permission, m]));
    expect(byName['library:read:all'].wasRequested).toBe(true);
    expect(byName.browser.wasRequested).toBe(false);
  });

  test('granting clears the record — the warning should stop', () => {
    const s = permissionSetFor(CLOUD_BACKUP, []);
    try { s.require('library.list'); } catch { /* counted */ }
    expect(s.missing()).toHaveLength(1);
    s.grant('library:read:all');
    expect(s.missing()).toHaveLength(0);
  });

  test('nothing is reported when nothing was refused', () => {
    const s = permissionSetFor(CLOUD_BACKUP, ['library:read:all', 'library:write', 'network']);
    s.require('library.list');
    expect(s.missing()).toEqual([]);
  });
});

describe('install and update prompts', () => {
  test('a fresh install prompts for everything declared', () => {
    const plan = promptPlan(CLOUD_BACKUP.permissions, []);
    expect(plan.ok).toBe(true);
    expect(plan.prompt.map((p) => p.permission).sort())
      .toEqual(['library:read:all', 'library:write', 'network']);
    expect(plan.carried).toEqual([]);
  });

  test('each prompt carries the author reason verbatim', () => {
    const plan = promptPlan(CLOUD_BACKUP.permissions, []);
    const net = plan.prompt.find((p) => p.permission === 'network');
    expect(net.reason).toBe('To talk to Dropbox.');
    expect(net.prompt).toBe('Connect to the internet');
    expect(net.hosts).toEqual(['https://api.dropbox.com', 'https://content.dropboxapi.com']);
  });

  test('an update prompts for the delta only (§9)', () => {
    const plan = promptPlan(CLOUD_BACKUP.permissions, ['library:read:all', 'network']);
    expect(plan.prompt.map((p) => p.permission)).toEqual(['library:write']);
    expect(plan.carried.sort()).toEqual(['library:read:all', 'network']);
  });

  test('an update that stops asking drops the grant', () => {
    const shrunk = { 'library:write': { reason: 'still needed' } };
    const plan = promptPlan(shrunk, ['library:read:all', 'library:write', 'network']);
    expect(plan.prompt).toEqual([]);
    expect(plan.dropped.sort()).toEqual(['library:read:all', 'network']);
  });

  test('an update with no changes prompts for nothing', () => {
    const plan = promptPlan(CLOUD_BACKUP.permissions, ['library:read:all', 'library:write', 'network']);
    expect(plan.prompt).toEqual([]);
    expect(plan.dropped).toEqual([]);
  });

  test('a manifest that does not validate reports why and prompts for nothing useful', () => {
    const plan = promptPlan({ 'library:write': {} }, []);
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]).toMatch(/needs a reason/);
  });
});

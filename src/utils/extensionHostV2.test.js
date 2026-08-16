import {
  validateManifestV2, createExtensionHost, frameDocumentV2, assertPolicySafe,
  browserCapabilities, ManifestError, API_VERSION,
} from './extensionHostV2.js';
import { createActivityMeter } from './activityMeter.js';

const VALID = {
  apiVersion: 2,
  id: 'cloud-backup',
  name: 'Cloud Backup',
  version: '2.0.0',
  permissions: {
    'library:read:all': { reason: 'To upload every book.' },
    network: { reason: 'To talk to Dropbox.', hosts: ['https://api.dropbox.com'] },
  },
  pages: {
    settings: { title: 'Cloud Backup', type: 'ui-file', file: 'Settings.js' },
    conflict: { title: 'Sync Conflict', type: 'ui-file', file: 'Conflict.js' },
  },
  contributes: {
    settings: [{ id: 'cb-settings', label: 'Cloud Backup', page: 'settings' }],
    bookActions: [{ id: 'backup-now', label: 'Back up now', command: 'sync.now' }],
  },
};

const clone = (over = {}) => JSON.parse(JSON.stringify({ ...VALID, ...over }));

function handlers() {
  const store = new Map();
  return {
    storage: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => { store.set(k, v); return true; },
      remove: async (k) => store.delete(k),
      keys: async () => [...store.keys()],
    },
    ui: {
      toast: async () => true, navigate: async () => true,
      prompt: async () => 'x', confirm: async () => true,
      overlaySet: async () => true, overlayClear: async () => true,
    },
    app: { version: () => '1.1.20', platform: () => 'web', locale: () => 'en' },
    library: {
      list: async () => [{ id: 'b1', title: 'Book', chapters: [] }],
      get: async (id) => (id === 'b1' ? { id: 'b1', title: 'Book', chapters: [] } : null),
      currentId: () => 'b1',
    },
  };
}

describe('manifest validation', () => {
  test('the Cloud Backup shape validates', () => {
    const r = validateManifestV2(VALID);
    expect({ ok: r.ok, errors: r.errors }).toEqual({ ok: true, errors: [] });
  });

  test('a v1 manifest is refused, not adapted', () => {
    // Guessing a v1 extension's permissions means guessing "all of them".
    const r = validateManifestV2({ id: 'old', name: 'Old', version: '1.0.0', entry: 'index.js' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/apiVersion is missing/);
  });

  test('a future apiVersion is refused with a readable reason', () => {
    const r = validateManifestV2(clone({ apiVersion: 3 }));
    expect(r.errors[0]).toMatch(/not supported — rebuild against v2/);
  });

  test('id, name and version are required', () => {
    const r = validateManifestV2({ apiVersion: API_VERSION });
    expect(r.errors).toEqual(expect.arrayContaining([
      'id is required', 'name is required', 'version is required',
    ]));
  });

  test('a path separator in the id is refused', () => {
    // The id keys the install directory, the storage namespace and the grants.
    for (const bad of ['../escape', 'a/b', 'a\\b', 'a b', 'a:b']) {
      const r = validateManifestV2(clone({ id: bad }));
      expect({ bad, ok: r.ok }).toEqual({ bad, ok: false });
    }
  });

  test('an unknown top-level key warns, so a v3 build still loads', () => {
    const r = validateManifestV2({ ...VALID, somethingFromV3: { a: 1 } });
    expect(r.ok).toBe(true);
  });

  test('an unknown permission key fails, because a typo means "not requested"', () => {
    const r = validateManifestV2(clone({
      permissions: { 'library:read:al': { reason: 'typo' } },
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown permission/);
  });
});

describe('contributions have exactly one target', () => {
  test('naming none is an error', () => {
    const r = validateManifestV2(clone({
      contributes: { settings: [{ id: 'x', label: 'X' }] },
    }));
    expect(r.errors.join(' ')).toMatch(/needs one of page, command, panel/);
  });

  test('naming two is an error', () => {
    // v1's bug read from the other side: a contribution with one possible
    // target made every button open the same page.
    const r = validateManifestV2(clone({
      contributes: { settings: [{ id: 'x', label: 'X', page: 'settings', command: 'go' }] },
    }));
    expect(r.errors.join(' ')).toMatch(/names page and command/);
  });

  test('panel is a valid target in 1.1.20', () => {
    const r = validateManifestV2(clone({
      contributes: { editorToolbar: [{ id: 'stats', label: 'Live stats', panel: 'stats' }] },
    }));
    expect(r.ok).toBe(true);
  });

  test('pointing at a page that does not exist is caught at build time', () => {
    const r = validateManifestV2(clone({
      contributes: { settings: [{ id: 'x', label: 'X', page: 'nowhere' }] },
    }));
    expect(r.errors.join(' ')).toMatch(/points at page "nowhere", which does not exist/);
  });

  test('a malformed when clause is caught at build time, not at render', () => {
    const r = validateManifestV2(clone({
      contributes: { settings: [{ id: 'x', label: 'X', page: 'settings', when: 'app[0]' }] },
    }));
    expect(r.errors.join(' ')).toMatch(/when:/);
  });

  test('a valid when clause passes', () => {
    const r = validateManifestV2(clone({
      contributes: {
        settings: [{
          id: 'x', label: 'X', page: 'settings',
          when: "book.isSaved && ext.hasPermission('network')",
        }],
      },
    }));
    expect(r.ok).toBe(true);
  });

  test('an unknown slot warns rather than failing', () => {
    const r = validateManifestV2(clone({
      contributes: { ...VALID.contributes, somewhereNew: [{ id: 'x', label: 'X', page: 'settings' }] },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/unknown contribution slot/);
  });
});

describe('pages', () => {
  test('a ui-file page needs a file', () => {
    const r = validateManifestV2(clone({ pages: { p: { title: 'P', type: 'ui-file' } } }));
    expect(r.errors.join(' ')).toMatch(/needs a file/);
  });

  test('a url page must be https', () => {
    const r = validateManifestV2(clone({
      pages: { p: { title: 'P', type: 'url', url: 'http://example.com' } },
    }));
    expect(r.errors.join(' ')).toMatch(/needs an https url/);
  });

  test('a url page without the network permission is incoherent and refused', () => {
    const r = validateManifestV2({
      ...clone(),
      permissions: { 'library:read:all': { reason: 'r' } },
      pages: { p: { title: 'P', type: 'url', url: 'https://example.com' } },
      contributes: {},
    });
    expect(r.errors.join(' ')).toMatch(/needs the network permission/);
  });

  test('an unknown page type is refused', () => {
    const r = validateManifestV2(clone({ pages: { p: { title: 'P', type: 'iframe' } } }));
    expect(r.errors.join(' ')).toMatch(/needs a type of/);
  });
});

describe('the assembled host', () => {
  test('an invalid manifest throws rather than half-loading', () => {
    expect(() => createExtensionHost({
      manifest: { id: 'x' }, granted: [], handlers: handlers(),
    })).toThrow(ManifestError);
  });

  test('granted capabilities work and ungranted ones are refused', async () => {
    const host = createExtensionHost({
      manifest: VALID, granted: ['library:read:all'], handlers: handlers(),
    });
    await expect(host.dispatch('library.list', [])).resolves.toHaveLength(1);
    await expect(host.dispatch('library.export', ['b1', 'txt']))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(host.dispatch('ui.toast', ['hi'])).resolves.toBe(true);
  });

  test('the CSP and dispatch are built from the SAME permission set', async () => {
    // If the policy were generated from the manifest while dispatch checked the
    // grants, a refused `network` permission would still reach the network —
    // and the CSP is the thing that actually stops that one.
    const host = createExtensionHost({
      manifest: VALID, granted: ['library:read:all'], handlers: handlers(),   // network refused
    });
    expect(host.csp()).toContain("connect-src 'none'");
    expect(host.csp()).not.toContain('dropbox');

    host.permissions.grant('network');
    expect(host.csp()).toContain('https://api.dropbox.com');
  });

  test('a granted network permission puts the declared hosts in the policy', () => {
    const host = createExtensionHost({
      manifest: VALID, granted: ['network'], handlers: handlers(),
    });
    expect(host.csp()).toMatch(/connect-src https:\/\/api\.dropbox\.com/);
  });

  test('missing permissions are reported for the warning UI', async () => {
    const host = createExtensionHost({ manifest: VALID, granted: [], handlers: handlers() });
    await host.dispatch('library.list', []).catch(() => {});
    await host.dispatch('library.list', []).catch(() => {});
    const [warn] = host.missingPermissions();
    expect(warn.permission).toBe('library:read:all');
    expect(warn.count).toBe(2);
    expect(warn.wasRequested).toBe(true);
  });

  test('onDenied is told which extension, permission and method', async () => {
    const seen = [];
    const host = createExtensionHost({
      manifest: VALID, granted: [], handlers: handlers(),
      onDenied: (...a) => seen.push(a),
    });
    await host.dispatch('library.list', []).catch(() => {});
    expect(seen[0]).toEqual(['cloud-backup', 'library:read:all', 'library.list']);
  });

  test('dispose stops the dispatcher', async () => {
    const host = createExtensionHost({
      manifest: VALID, granted: ['library:read:all'], handlers: handlers(),
    });
    host.dispose();
    await expect(host.dispatch('library.list', []))
      .rejects.toMatchObject({ code: 'extension-stopped' });
  });

  test('dispose releases an activity subscription the extension never dropped', async () => {
    let tick = null;
    const meter = createActivityMeter({
      now: () => 0,
      setIntervalFn: (fn) => { tick = fn; return 1; },
      clearIntervalFn: () => { tick = null; },
    });
    const withActivity = clone({
      permissions: { ...VALID.permissions, activity: { reason: 'To time writing.' } },
    });
    const host = createExtensionHost({
      manifest: withActivity, granted: ['activity'], handlers: handlers(), meter,
    });
    await host.dispatch('activity.onWriting', [true]);
    expect(tick).not.toBeNull();
    host.dispose();
    expect(tick).toBeNull();
  });

  test('the internal unsubscribe hook is not reachable as a method', async () => {
    const meter = createActivityMeter({ setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const withActivity = clone({
      permissions: { ...VALID.permissions, activity: { reason: 'To time writing.' } },
    });
    const host = createExtensionHost({
      manifest: withActivity, granted: ['activity'], handlers: handlers(), meter,
    });
    await expect(host.dispatch('__unsubscribe', []))
      .rejects.toMatchObject({ code: 'unknown-method' });
  });
});

describe('the frame document', () => {
  test('it carries the policy in a meta tag', () => {
    const doc = frameDocumentV2({ csp: "default-src 'none';", bootstrap: 'var x=1;' });
    expect(doc).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src &#x27;none&#x27;;".replace(/&#x27;/g, "'"));
  });

  test('a policy containing markup is REFUSED, not neutralised', () => {
    // Escaping the quote keeps it inside the attribute, but a policy with
    // markup in it means something upstream is already wrong. Refusing beats
    // making the document's safety depend on one substitution staying correct.
    const markup = ['a"><script>evil()<', '/script><meta b="'].join('');
    expect(() => frameDocumentV2({ csp: markup, bootstrap: '' })).toThrow(/contains/);
  });

  test('every character a real policy needs is allowed', () => {
    const host = createExtensionHost({
      manifest: VALID, granted: ['network'], handlers: handlers(),
    });
    expect(() => assertPolicySafe(host.csp())).not.toThrow();
    expect(() => frameDocumentV2({ csp: host.csp(), bootstrap: '' })).not.toThrow();
  });

  test('the characters that could escape the attribute are all rejected', () => {
    for (const ch of ['<', '>', '"', '`', '\\', '\n', '\u0000']) {
      expect(() => assertPolicySafe(`default-src 'none'${ch}`)).toThrow();
    }
  });

  test('the policy comes before the bootstrap script', () => {
    // A meta CSP applies to what follows it. Placed after the script, the
    // bootstrap would have run unpoliced.
    const doc = frameDocumentV2({ csp: "default-src 'none';", bootstrap: 'BOOT' });
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('BOOT'));
  });

  test('the host builds the document with the live policy', () => {
    const host = createExtensionHost({
      manifest: VALID, granted: ['network'], handlers: handlers(),
    });
    expect(host.document('BOOT')).toContain('https://api.dropbox.com');
  });
});

describe('browser capabilities', () => {
  const caps = () => {
    const seen = [];
    const c = browserCapabilities({
      open: async (u) => { seen.push(u); return true; },
      close: async () => true,
      oauth: async (o) => ({ ok: true, ...o }),
      googleSignIn: async () => ({ token: 't' }),
      requestDriveToken: async () => ({ token: 'd' }),
    });
    return { c, seen };
  };

  test('https is opened', async () => {
    const { c, seen } = caps();
    await expect(c['browser.open'](['https://example.com'])).resolves.toBe(true);
    expect(seen).toEqual(['https://example.com']);
  });

  test('anything else is refused before the host sees it', async () => {
    // An extension that could pass javascript: or file: would be choosing what
    // the host opens rather than asking it to open something.
    const { c, seen } = caps();
    for (const bad of [
      'http://example.com', 'file:///etc/passwd', 'data:text/html,x',
      // eslint-disable-next-line no-script-url
      'javascript:alert(1)', '', null, 'HTTPS://evil.com@example.com'.replace('HTTPS', 'ftp'),
    ]) {
      await expect(c['browser.open']([bad])).rejects.toThrow(/https URL/);
    }
    expect(seen).toEqual([]);
  });

  test('the auth round trips are passed through', async () => {
    const { c } = caps();
    await expect(c['auth.oauth']([{ authUrl: 'https://a' }])).resolves.toMatchObject({ ok: true });
    await expect(c['auth.googleSignIn']([{}])).resolves.toEqual({ token: 't' });
    await expect(c['auth.requestDriveToken']([{}])).resolves.toEqual({ token: 'd' });
  });
});

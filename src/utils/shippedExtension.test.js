/**
 * shippedExtension.test.js — the released Cloud Backup 2.0.0, end to end.
 *
 * Every other extension test in this repo uses a fixture manifest built for
 * the assertion. This one uses the .extbk that was actually released — the
 * same bytes somebody downloads — because the interesting failures are the
 * ones a purpose-built fixture is too tidy to have:
 *
 *   - contributions that validate and render nothing
 *   - a `when` clause that reads a permission nobody granted
 *   - state computed at install and gone before anything can draw it
 *
 * The fixture is checksummed against the release. If it is ever replaced,
 * the hash below has to be updated deliberately, so the subject of this file
 * cannot drift into being something nobody shipped.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import React from 'react';
import { render, waitFor } from '@testing-library/react';

jest.mock('./platform', () => ({
  isAndroid: () => false, isElectron: () => true, getPlatform: () => 'desktop',
}));

// The runner is stubbed: what is under test is the install, the grants and
// what the app decides to draw, not the sandbox. check:cloud-backup runs the
// real code in a real frame.
jest.mock('./extensionRunnerV2', () => ({
  runExtensionV2: async () => ({ ok: true }),
  hostV2: () => null,
  commandsV2: () => ({ invoke: async () => ({}) }),
  stopExtensionV2: async (id) => { mockOrder.push(`stop:${id}`); return true; },
  stopAllV2: async () => {},
  runningV2: () => [],
  hostFor: () => null,
}));

const mockOrder = [];
const mockFiles = new Map();
jest.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    mkdir: async () => {},
    writeFile: async ({ path: p, data, encoding }) => {
      mockOrder.push(`write:${p}`);
      mockFiles.set(p, Buffer.from(data, encoding ? 'utf8' : 'base64'));
    },
    readFile: async ({ path: p, encoding }) => {
      if (!mockFiles.has(p)) throw new Error(`no such file: ${p}`);
      const b = mockFiles.get(p);
      return { data: encoding ? b.toString('utf8') : b.toString('base64') };
    },
    stat: async ({ path: p }) => {
      if (!mockFiles.has(p)) throw new Error(`no such file: ${p}`);
      return { type: 'file' };
    },
    readdir: async ({ path: p }) => {
      const seen = new Map();
      for (const k of mockFiles.keys()) {
        if (!k.startsWith(`${p}/`)) continue;
        const rest = k.slice(p.length + 1);
        seen.set(rest.split('/')[0], rest.includes('/') ? 'directory' : 'file');
      }
      if (seen.size === 0) throw new Error(`no such directory: ${p}`);
      return { files: [...seen].map(([name, type]) => ({ name, type })) };
    },
    rmdir: async ({ path: p }) => {
      const doomed = [...mockFiles.keys()].filter((k) => k === p || k.startsWith(`${p}/`));
      if (!doomed.length) throw new Error(`no such directory: ${p}`);
      for (const k of doomed) mockFiles.delete(k);
    },
  },
}), { virtual: true });

const FIXTURE = path.join(__dirname, '__fixtures__', 'cloud-backup-2.0.0.extbk');
const RAW = fs.readFileSync(FIXTURE);
const B64 = RAW.toString('base64');
const RELEASED_SHA256 = 'beb5aea60fc338cb677d009f9fe640afd8f3816963e64980cecb93a5e3fa8912';

const ALL = ['library:read:all', 'library:write', 'library:export', 'browser', 'network'];
const OPEN_SAVED = {
  id: 'b1', title: 'The Salt Road', filePath: '/books/salt.authbook',
  chapters: [{ id: 'c1', title: 'One', content: 'words' }],
};

beforeEach(() => { mockFiles.clear(); localStorage.clear(); mockOrder.length = 0; });

/** Install, then set the grants a scenario needs. */
async function install(grants, { asked = true } = {}) {
  const { installExtbkBytes } = require('./extbkInstaller');
  const manifest = await installExtbkBytes(B64, {
    silent: true,
    askPermissions: asked ? async () => grants : null,
  });
  return manifest;
}

/**
 * What `type` renders, for a session and a settings object.
 *
 * Starts from nothing every time. Installing twice in one test is an *update*,
 * and an update deliberately does not re-ask about a permission already
 * decided — so a second scenario in the same test would inherit the first
 * one's grants and quietly assert nothing.
 */
async function contributions(type, { grants = ALL, session = null, config = null } = {}) {
  mockFiles.clear();
  localStorage.clear();
  await install(grants);
  if (config) require('./extensionLoader').setExtensionConfig('cloud-backup', config);
  const { ExtensionProvider, useExtensionContributions, useExtensions } = require('./ExtensionContext');
  let items = null;
  let list = null;
  function Probe() {
    list = useExtensions().extensions;
    items = useExtensionContributions(type, session);
    return null;
  }
  render(React.createElement(ExtensionProvider, null, React.createElement(Probe)));
  // The provider discovers and activates asynchronously on mount; the list
  // arriving is the signal that it has.
  await waitFor(() => expect(list.length).toBeGreaterThan(0));
  return (items ?? []).map((i) => i.id);
}

describe('the fixture', () => {
  it('is the bytes that were released', () => {
    expect(crypto.createHash('sha256').update(RAW).digest('hex')).toBe(RELEASED_SHA256);
  });
});

describe('installing it', () => {
  it('writes every module and asset under its own id', async () => {
    await install(ALL);
    const written = [...mockFiles.keys()].sort();
    expect(written).toContain('AuthNo/extensions/cloud-backup/manifest.json');
    expect(written).toContain('AuthNo/extensions/cloud-backup/index.js');
    expect(written).toContain('AuthNo/extensions/cloud-backup/Settings.js');
    expect(written.every((p) => p.startsWith('AuthNo/extensions/cloud-backup/'))).toBe(true);
  });

  it('grants exactly what was answered, and records that it asked', async () => {
    await install(['network']);
    const { readGrants } = require('./extensionGrants');
    expect(readGrants('cloud-backup')).toEqual({
      granted: ['network'], userHosts: [], asked: true,
    });
  });

  it('is found by discovery, with its pages and contributions intact', async () => {
    await install(ALL);
    const { discoverExtensions } = require('./extensionLoader');
    const [found] = await discoverExtensions();
    expect(found.id).toBe('cloud-backup');
    expect(found.apiVersion).toBe(2);
    expect(Object.keys(found.pages)).toEqual(['settings', 'conflict', 'cloud-files']);
  });
});

describe('what the app draws for it', () => {
  it('puts its tab in Settings whatever was granted', async () => {
    expect(await contributions('settings', { grants: ALL })).toEqual(['cloud-backup-settings']);
    // Nothing granted still shows the tab: that screen is where somebody goes
    // to grant them, so hiding it would close the only door.
    expect(await contributions('settings', { grants: [] })).toEqual(['cloud-backup-settings']);
  });

  it('puts its tile on the home screen', async () => {
    expect(await contributions('homescreen')).toEqual(['sync-status-tile']);
  });

  it('shows the book actions whose conditions hold, and no others', async () => {
    // "Back up now" needs a saved book AND the network permission.
    expect(await contributions('bookActions', { grants: ALL, session: OPEN_SAVED }))
      .toEqual(['backup-now', 'browse-cloud']);
    // Without network, neither of the two that need it.
    expect(await contributions('bookActions', { grants: [], session: OPEN_SAVED }))
      .toEqual([]);
    // With no book open, nothing that acts on one.
    expect(await contributions('bookActions', { grants: ALL, session: null }))
      .toEqual(['browse-cloud']);
    // "Resolve conflict" appears only when the extension says there is one.
    expect(await contributions('bookActions', {
      grants: ALL, session: OPEN_SAVED, config: { hasConflict: true },
    })).toEqual(['backup-now', 'browse-cloud', 'resolve-conflict']);
  });
});

describe('installed without anybody being asked', () => {
  // The cold-start intent and share-sheet paths install without an asker.
  // The extension then runs, can do nothing, and used to explain nothing:
  // the installer's `_permissionsPending` was returned to its caller and
  // written nowhere, so the next discovery — which reads manifest.json off
  // disk — lost it, and the warning built for this state could not appear.
  it('records that the question was never put', async () => {
    await install([], { asked: false });
    expect(require('./extensionGrants').readGrants('cloud-backup').asked).toBe(false);
  });

  it('says so in the Extensions tab, after a restart', async () => {
    await install([], { asked: false });

    // A restart: nothing but the filesystem and localStorage survives.
    jest.resetModules();
    const { discoverExtensions } = require('./extensionLoader');
    const { readGrants } = require('./extensionGrants');
    const { buildExtensionsTab } = require('./extensionSettingsModel');

    const tab = buildExtensionsTab({
      extensions: await discoverExtensions(),
      grantsFor: (id) => readGrants(id).granted,
      askedFor: (id) => readGrants(id).asked,
      userHostsFor: (id) => readGrants(id).userHosts,
    });

    const [row] = tab.rows;
    expect(row.warnings.map((w) => w.kind)).toContain('permissions-unanswered');
    expect(tab.needsAttention).toBe(1);
  });

  it('stops saying so once the question has been answered', async () => {
    await install([], { asked: false });
    const { writeGrants, readGrants } = require('./extensionGrants');
    writeGrants('cloud-backup', ['network'], [], { asked: true });

    const { discoverExtensions } = require('./extensionLoader');
    const { buildExtensionsTab } = require('./extensionSettingsModel');
    const tab = buildExtensionsTab({
      extensions: await discoverExtensions(),
      grantsFor: (id) => readGrants(id).granted,
      askedFor: (id) => readGrants(id).asked,
    });
    expect(tab.rows[0].warnings).toEqual([]);
  });

  it('leaves a grant record written before the flag existed alone', () => {
    // No `asked` key: written by a build that predates it. Those installs did
    // put the question, and nagging somebody about a decision they already
    // made is worse than the warning is worth.
    localStorage.setItem('__authno_ext_grants_cloud-backup',
      JSON.stringify({ granted: ['network'], userHosts: [] }));
    expect(require('./extensionGrants').readGrants('cloud-backup').asked).toBe(true);
  });
});

describe('replacing and removing it', () => {
  it('stops the running copy before overwriting a single file', async () => {
    await install(ALL);
    mockOrder.length = 0;
    await install(ALL);
    const stop = mockOrder.indexOf('stop:cloud-backup');
    const firstWrite = mockOrder.findIndex((o) => o.startsWith('write:'));
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(stop).toBeLessThan(firstWrite);
  });

  it('keeps the permissions and the typed-in servers across an update', async () => {
    await install(ALL);
    const { writeGrants, readGrants } = require('./extensionGrants');
    writeGrants('cloud-backup', ALL, ['https://dav.example.com']);

    const again = await install(ALL);
    expect(again._fromVersion).toBe('2.0.0');
    expect(readGrants('cloud-backup').userHosts).toEqual(['https://dav.example.com']);
  });

  it('takes the files, the grants and the settings with it on uninstall', async () => {
    const { uninstallExtension } = require('./extbkInstaller');
    const { readGrants } = require('./extensionGrants');
    const { setExtensionConfig, getExtensionConfig } = require('./extensionLoader');

    await install(ALL);
    setExtensionConfig('cloud-backup', { provider: 'WebDAV' });
    expect(mockFiles.size).toBeGreaterThan(0);

    await uninstallExtension('cloud-backup');

    expect(mockFiles.size).toBe(0);
    expect(readGrants('cloud-backup')).toEqual({ granted: [], userHosts: [], asked: false });
    expect(getExtensionConfig('cloud-backup')).toEqual({});
    expect(Object.keys(localStorage).filter((k) => k.includes('cloud-backup'))).toEqual([]);
  });
});

describe('a package that arrived damaged', () => {
  const installRaw = async (bytes) => {
    const { installExtbkBytes } = require('./extbkInstaller');
    return installExtbkBytes(Buffer.from(bytes).toString('base64'), { silent: true });
  };

  it('refuses a truncated one, and says it is truncated', async () => {
    await expect(installRaw(RAW.subarray(0, 1024))).rejects.toThrow(/incomplete/i);
  });

  it('refuses one whose magic is wrong', async () => {
    const b = Buffer.from(RAW); b[2] ^= 0xff;
    await expect(installRaw(b)).rejects.toThrow(/magic/i);
  });

  it('refuses one whose directory no longer matches the package', async () => {
    const b = Buffer.from(RAW); b[0x20] ^= 0xff;
    await expect(installRaw(b)).rejects.toThrow(/does not match/i);
  });

  it('repairs a single flipped bit in the body rather than refusing it', async () => {
    const b = Buffer.from(RAW); b[200] ^= 0xff;
    const m = await installRaw(b);
    expect(m.id).toBe('cloud-backup');
    expect(m._repairs.length).toBeGreaterThan(0);
    expect(m._droppedAssets).toEqual([]);
  });
});

describe('the version it says it needs', () => {
  const { satisfiesMinAppVersion } = require('./extensionLoader');
  const m = { minAppVersion: '1.1.20-beta.0' };

  it('is not satisfied by an older app', () => {
    expect(satisfiesMinAppVersion(m, '1.1.19')).toBe(false);
    expect(satisfiesMinAppVersion(m, '1.1.9')).toBe(false);
  });

  it('is satisfied by the beta it names, and by the release that follows it', () => {
    expect(satisfiesMinAppVersion(m, '1.1.20-beta.0')).toBe(true);
    expect(satisfiesMinAppVersion(m, '1.1.20')).toBe(true);
    expect(satisfiesMinAppVersion(m, '1.1.21')).toBe(true);
    // Numeric, not lexical: 10 is after 1.
    expect(satisfiesMinAppVersion(m, '1.10.0')).toBe(true);
  });
});

describe('the WebDAV address somebody types in', () => {
  const { permissionSetFor, hostProblem } = require('./extensionPermissionsV2');
  let manifest;
  beforeAll(async () => {
    const { readEpk } = require('../../extensions/extbk-cli/src/epkFormat.js');
    manifest = (await readEpk(RAW)).manifest;
  });

  it('is held to the count the manifest asked for, not the module ceiling', () => {
    const set = permissionSetFor(manifest, ['network'], []);
    expect(set.maxUserHosts).toBe(2);              // the manifest says 2
    expect(set.grantHost('https://a.example.com').ok).toBe(true);
    expect(set.grantHost('https://b.example.com').ok).toBe(true);
    expect(set.grantHost('https://c.example.com')).toMatchObject({ ok: false, reason: 'too-many-hosts' });
  });

  it('refuses anything that is not plainly one https origin', () => {
    for (const bad of [
      'http://dav.example.com',                 // not https
      'https://dav.example.com/remote.php',     // a path is not an origin
      'https://user:pass@dav.example.com',      // credentials
      'https://dav.example.com; default-src *', // a second CSP directive
      'https://dav.example.com\nX',             // a newline the URL parser eats
      'https://ⅾav.example.com',           // a homoglyph for "dav"
      'https://*',                              // a wildcard is not a grant
      'javascript:alert(1)',
      'dav.example.com',
    ]) {
      expect(hostProblem(bad)).toBeTruthy();
    }
  });
});

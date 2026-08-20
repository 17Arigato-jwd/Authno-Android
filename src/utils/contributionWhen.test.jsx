/**
 * contributionWhen.test.jsx — `when` clauses, evaluated at last.
 *
 * The language itself is covered in whenClause.test.js. What is covered here
 * is the join that was missing: `extensionHostV2` parsed every clause at
 * install to check its syntax, and then nothing ever asked one whether the
 * contribution should be drawn. An author could write
 *
 *   "when": "ext.hasPermission('network')"
 *
 * and watch the button appear for somebody who had said no — the one case the
 * clause was written to prevent.
 *
 * Two things this file learned the hard way.
 *
 * It goes through the REAL provider rather than a stubbed `useExtensions`.
 * The hooks read the context object directly, so replacing the exported hook
 * leaves the one inside them untouched, and every case comes back empty —
 * including the ones with no clause at all, which is how you find out.
 *
 * And the module mocks are plain functions, not `jest.fn(impl)`. CRA sets
 * `resetMocks: true`, which strips the implementation off every `jest.fn`
 * before each test: a mocked `discoverExtensions` then returns `undefined`,
 * the provider's scan throws on it, and the list is empty for a reason that
 * has nothing to do with `when`.
 */

import { renderHook, waitFor } from '@testing-library/react';
import {
  ExtensionProvider,
  useExtensions,
  useExtensionContributions,
  useBookDashboardExtensions,
  useEditorToolbarExtensions,
} from './ExtensionContext';
import { writeGrants, clearGrants } from './extensionGrants';
import { setExtensionConfig, clearExtensionConfig } from './extensionLoader';

let mockInstalled = [];
let mockInvoked = [];
let mockRegistry = { invoke: async (name, args) => { mockInvoked.push([name, args]); } };

jest.mock('./extensionLoader', () => {
  const actual = jest.requireActual('./extensionLoader');
  return { ...actual, discoverExtensions: async () => mockInstalled };
});
jest.mock('./extensionRuntime', () => ({
  activateExtension: async () => {},
  deactivateExtension: async () => {},
  deactivateAll: async () => {},
  commandsV2: () => mockRegistry,
}));
jest.mock('./extbkInstaller', () => ({
  installExtbkBytes: async () => {},
  uninstallExtension: async () => {},
  seedPreinstalledExtensions: async () => {},
}));
jest.mock('./themeLoader', () => ({
  installThmbkBytes: async () => {},
  refreshInstalledThemes: async () => {},
}));

const EXT = 'com.example.demo';
const wrapper = ({ children }) => <ExtensionProvider>{children}</ExtensionProvider>;

/** Render a hook and wait for the provider's scan to land. */
async function shown(hook, read = (r) => r) {
  const { result } = renderHook(hook, { wrapper });
  await waitFor(() => expect(result.current).toBeDefined());
  return () => read(result.current);
}

const homescreen = (when) => ([{
  id: EXT,
  name: 'Demo',
  contributes: { homescreen: [{ id: 'tile', label: 'Tile', page: 'main', when }] },
}]);

beforeEach(() => {
  mockInstalled = [];
  mockInvoked = [];
  mockRegistry = { invoke: async (name, args) => { mockInvoked.push([name, args]); } };
  clearGrants(EXT);
  clearExtensionConfig(EXT);
});

describe('a contribution with no clause', () => {
  it('is always drawn', async () => {
    mockInstalled = homescreen(undefined);
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    await waitFor(() => expect(tiles()).toHaveLength(1));
  });
});

describe('a clause about a permission', () => {
  it('hides the contribution when the permission was refused', async () => {
    mockInstalled = homescreen("ext.hasPermission('network')");
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    // The whole point. Before this, the tile was drawn and pressing it did the
    // only thing it could: fail.
    await waitFor(() => expect(tiles()).toHaveLength(0));
  });

  it('draws it once the permission is granted', async () => {
    writeGrants(EXT, ['network']);
    mockInstalled = homescreen("ext.hasPermission('network')");
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    await waitFor(() => expect(tiles()).toHaveLength(1));
  });
});

describe('a clause about the book', () => {
  const dashboard = (when) => ([{
    id: EXT,
    name: 'Demo',
    contributes: { bookDashboard: { actions: [{ id: 'a', label: 'Back up', when }] } },
  }]);
  const actions = (r) => r.actions;

  it('is answered with "there is no book" outside one', async () => {
    mockInstalled = homescreen('book.isOpen');
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    await waitFor(() => expect(tiles()).toHaveLength(0));
  });

  it('hides an action on a book that has never been written to disk', async () => {
    mockInstalled = dashboard('book.isSaved');
    const rows = await shown(
      () => useBookDashboardExtensions({ id: '1', chapters: [] }), actions,
    );
    await waitFor(() => expect(rows()).toHaveLength(0));
  });

  it('draws it on one that has', async () => {
    mockInstalled = dashboard('book.isSaved');
    const rows = await shown(
      () => useBookDashboardExtensions({ id: '1', chapters: [], filePath: '/b/one.authbook' }),
      actions,
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  const toolbar = (when) => ([{
    id: EXT,
    name: 'Demo',
    contributes: { editorToolbar: [{ id: 'b', label: 'B', when }] },
  }]);

  it('counts chapters', async () => {
    mockInstalled = toolbar('book.chapterCount == 3');
    const buttons = await shown(() => useEditorToolbarExtensions({ chapters: [1, 2, 3] }));
    await waitFor(() => expect(buttons()).toHaveLength(1));
  });

  it('answers a path it does not know with undefined rather than a throw', async () => {
    // A clause written against a newer app hides its button instead of
    // breaking the toolbar it sits in.
    mockInstalled = toolbar('chapters == 3');
    const buttons = await shown(() => useEditorToolbarExtensions({ chapters: [1, 2, 3] }));
    await waitFor(() => expect(buttons()).toHaveLength(0));
  });
});

describe("a clause about the extension's own settings", () => {
  it('is false while the setting is off', async () => {
    mockInstalled = homescreen('ext.settings.showTile');
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    await waitFor(() => expect(tiles()).toHaveLength(0));
  });

  it('follows the stored value once it is on', async () => {
    setExtensionConfig(EXT, { showTile: true });
    mockInstalled = homescreen('ext.settings.showTile');
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    await waitFor(() => expect(tiles()).toHaveLength(1));
  });
});

describe('a clause that does not parse', () => {
  it('hides the contribution instead of throwing into the render', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockInstalled = homescreen('book.isSaved &&');
    const tiles = await shown(() => useExtensionContributions('homescreen'));
    await waitFor(() => expect(tiles()).toHaveLength(0));
    warn.mockRestore();
  });
});

describe('both halves of the book dashboard', () => {
  it('are filtered, not just the tabs', async () => {
    mockInstalled = ([{
      id: EXT,
      name: 'Demo',
      contributes: {
        bookDashboard: {
          tabs: [{ id: 't', label: 'T', when: "ext.hasPermission('network')" }],
          actions: [{ id: 'a', label: 'A', when: "ext.hasPermission('network')" }],
        },
      },
    }]);
    const both = await shown(() => useBookDashboardExtensions({ id: '1' }));
    await waitFor(() => {
      expect(both().tabs).toHaveLength(0);
      expect(both().actions).toHaveLength(0);
    });
  });

  it('leaves a v1 contribution alone — v1 manifests have no `when`', async () => {
    mockInstalled = ([{
      id: EXT,
      name: 'Demo',
      contributes: { bookDashboard: { tabs: [{ id: 't', label: 'T' }], actions: [{ id: 'a', label: 'A' }] } },
    }]);
    const both = await shown(() => useBookDashboardExtensions({ id: '1' }));
    await waitFor(() => {
      expect(both().tabs).toHaveLength(1);
      expect(both().actions).toHaveLength(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('what a contribution does when you press it', () => {
  const contributes = (item) => ([{
    id: EXT,
    name: 'Demo',
    contributes: { homescreen: [{ id: 'tile', label: 'Tile', ...item }] },
  }]);

  it('runs a command rather than navigating to undefined', async () => {
    mockInstalled = contributes({ command: 'sync.now' });
    const run = await shown(() => useExtensions().runContribution);
    await waitFor(() => expect(typeof run()).toBe('function'));

    // The whole bug: every activation site called navigate(ext, item.page),
    // and a command contribution has no page.
    const r = await run()(mockInstalled[0], { id: 'tile', command: 'sync.now' });
    expect(r.did).toBe('command');
    expect(mockInvoked).toEqual([['sync.now', []]]);
  });

  it('navigates for a page', async () => {
    mockInstalled = contributes({ page: 'main' });
    const run = await shown(() => useExtensions().runContribution);
    const r = await run()(mockInstalled[0], { id: 'tile', page: 'main' });
    expect(r.did).toBe('page');
    expect(mockInvoked).toEqual([]);
  });

  it('opens a panel for a panel', async () => {
    mockInstalled = contributes({ panel: 'stats' });
    const run = await shown(() => useExtensions().runContribution);
    const r = await run()(mockInstalled[0], { id: 'tile', panel: 'stats' });
    expect(r.did).toBe('panel');
  });

  it('says so when the extension is not running rather than doing nothing', async () => {
    mockRegistry = null;
    mockInstalled = contributes({ command: 'sync.now' });
    const run = await shown(() => useExtensions().runContribution);
    const r = await run()(mockInstalled[0], { id: 'tile', command: 'sync.now' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-running');
  });

  it('reports a contribution that names no target at all', async () => {
    mockInstalled = contributes({});
    const run = await shown(() => useExtensions().runContribution);
    const r = await run()(mockInstalled[0], { id: 'tile' });
    expect(r).toEqual({ ok: false, reason: 'no-target' });
  });
});

describe('the book screen reads the slot the spec documents', () => {
  const actionsOf = (r) => r.actions;

  it('renders contributes.bookActions', async () => {
    // Cloud Backup declares this one. It validated, and nothing drew it.
    mockInstalled = ([{
      id: EXT, name: 'Demo',
      contributes: { bookActions: [{ id: 'backup-now', label: 'Back up now', command: 'sync.now' }] },
    }]);
    const rows = await shown(() => useBookDashboardExtensions({ id: '1' }), actionsOf);
    await waitFor(() => expect(rows().map((a) => a.id)).toEqual(['backup-now']));
  });

  it('renders contributes.chapterActions too', async () => {
    mockInstalled = ([{
      id: EXT, name: 'Demo',
      contributes: { chapterActions: [{ id: 'ch', label: 'Do', command: 'c' }] },
    }]);
    const rows = await shown(() => useBookDashboardExtensions({ id: '1' }), actionsOf);
    await waitFor(() => expect(rows().map((a) => a.id)).toEqual(['ch']));
  });

  it('still renders the v1 bookDashboard shape', async () => {
    // v1 extensions are installed and use this. Breaking them to tidy a name
    // is not a trade worth making.
    mockInstalled = ([{
      id: EXT, name: 'Demo',
      contributes: { bookDashboard: { actions: [{ id: 'old', label: 'Old' }], tabs: [{ id: 't', label: 'T' }] } },
    }]);
    const both = await shown(() => useBookDashboardExtensions({ id: '1' }));
    await waitFor(() => {
      expect(both().actions.map((a) => a.id)).toEqual(['old']);
      expect(both().tabs.map((t) => t.id)).toEqual(['t']);
    });
  });

  it('applies `when` to the new slots as well', async () => {
    mockInstalled = ([{
      id: EXT, name: 'Demo',
      contributes: { bookActions: [
        { id: 'needs-net', label: 'Back up now', command: 'sync.now', when: "ext.hasPermission('network')" },
      ] },
    }]);
    const rows = await shown(() => useBookDashboardExtensions({ id: '1' }), actionsOf);
    await waitFor(() => expect(rows()).toHaveLength(0));
  });
});

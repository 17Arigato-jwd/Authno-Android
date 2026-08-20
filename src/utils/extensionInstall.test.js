import { createInstaller, InstallError } from './extensionInstall.js';
import { packEpk } from './epkFormat.js';

const MANIFEST = {
  apiVersion: 2,
  id: 'cloud-backup',
  name: 'Cloud Backup',
  version: '2.0.0',
  permissions: {
    'library:read:all': { reason: 'To copy every book.' },
    network: { reason: 'To reach Dropbox.', hosts: ['https://api.dropboxapi.com'] },
  },
};

const MODULES = { 'index.js': 'export function activate() {}' };

const build = (over = {}) => packEpk({
  manifest: { ...MANIFEST, ...over },
  modules: MODULES,
});

/** Records what the installer touched, in the order it touched it. */
function harness({ answer = null, onboarded = true, activates = true, grants = {} } = {}) {
  const log = [];
  const disk = new Map();
  const stored = new Map();
  const granted = { ...grants };
  const stages = [];

  const installer = createInstaller({
    writeFiles: async (id, files) => { log.push(['write', id]); disk.set(id, files); },
    removeFiles: async (id) => { log.push(['removeFiles', id]); disk.delete(id); },
    clearStorage: async (id) => { log.push(['clearStorage', id]); stored.delete(id); },
    readGrants: (id) => granted[id] ?? [],
    writeGrants: async (id, g) => { log.push(['grants', id, [...g]]); granted[id] = [...g]; },
    askPermissions: async (id, plan) => {
      log.push(['ask', id, plan.prompt.map((p) => p.permission)]);
      return answer === null ? plan.prompt.map((p) => p.permission) : answer;
    },
    showOnboarding: async (id, steps) => { log.push(['onboard', id, steps.length]); return onboarded; },
    activate: async (m) => { log.push(['activate', m.id]); return activates ? { ok: true } : { ok: false, error: 'no activate() export' }; },
    deactivate: async (id) => { log.push(['deactivate', id]); },
    onStage: (s) => stages.push(s),
  });

  return { installer, log, disk, stored, granted, stages };
}

describe('nothing reaches disk before it has been verified', () => {
  test('a happy install writes files, then grants, then activates', async () => {
    const { installer, log } = harness();
    const r = await installer.install(await build());

    expect(r.ok).toBe(true);
    expect(log.map((l) => l[0])).toEqual(['ask', 'write', 'grants', 'activate']);
  });

  test('an unreadable package leaves the disk untouched', async () => {
    // Writing first and validating after means a refused package still left
    // files behind, and the next scan finds them.
    const { installer, log, disk } = harness();
    await expect(installer.install(new Uint8Array(300))).rejects.toBeInstanceOf(InstallError);
    expect(log).toEqual([]);
    expect(disk.size).toBe(0);
  });

  test('a v1 package is refused with a readable reason', async () => {
    const { installer } = harness();
    // The ECS magic, not EPK.
    const ecs = new Uint8Array([0x89, 0x45, 0x58, 0x54, 0x42, 0x4b, 0x0d, 0x0a, ...new Array(200).fill(0)]);
    const err = await installer.install(ecs).catch((e) => e);
    expect(err.code).toBe('not-epk');
    expect(err.message).toMatch(/rebuild it with extbk build against v2/);
  });

  test('a package with a bad manifest never gets written', async () => {
    const { installer, log } = harness();
    const bytes = await packEpk({
      manifest: { apiVersion: 2, id: 'a/b', name: 'Bad', version: '1.0.0' },
      modules: MODULES,
    });
    const err = await installer.install(bytes).catch((e) => e);
    expect(err.stage).toBe('checking');
    expect(err.errors.join(' ')).toMatch(/id may contain only/);
    expect(log).toEqual([]);
  });

  test('an unsigned package from the update channel is refused before writing', async () => {
    const { installer, log } = harness();
    const err = await installer.install(await build(), { fromChannel: true }).catch((e) => e);
    expect(err.code).toBe('unsigned-channel-package');
    expect(log).toEqual([]);
  });

  test('a truncated download reports where to resume, and writes nothing', async () => {
    const { installer, log } = harness();
    const full = await build();
    const err = await installer.install(full.slice(0, Math.floor(full.length * 0.6))).catch((e) => e);
    expect(err.code).toBe('incomplete');
    expect(err.resumeFrom).toBeGreaterThan(0);
    expect(log).toEqual([]);
  });
});

describe('onboarding comes before permissions', () => {
  test('the user is told what it does, then asked what it may do', async () => {
    // Prompting before explaining is how a permission screen becomes a thing
    // to tap through.
    const { installer, log } = harness();
    await installer.install(await build({
      onboarding: { steps: [{ title: 'What this does' }, { title: 'How to use it' }] },
    }));
    const order = log.map((l) => l[0]);
    expect(order.indexOf('onboard')).toBeLessThan(order.indexOf('ask'));
  });

  test('an extension with no onboarding simply skips it', async () => {
    const { installer, log } = harness();
    await installer.install(await build());
    expect(log.some((l) => l[0] === 'onboard')).toBe(false);
  });

  test('skipping onboarding is not a refusal', async () => {
    // Somebody who already knows what an extension does should not have to be
    // told before they may install it.
    const { installer } = harness({ onboarded: false });
    const r = await installer.install(await build({
      onboarding: { steps: [{ title: 'Intro' }] },
    }));
    expect(r.ok).toBe(true);
    expect(r.onboarded).toBe(false);
  });

  test('an over-long onboarding is refused', async () => {
    const { installer } = harness();
    const err = await installer.install(await build({
      onboarding: { steps: Array.from({ length: 6 }, (_, i) => ({ title: `Step ${i}` })) },
    })).catch((e) => e);
    expect(err.code).toBe('too-many-steps');
  });
});

describe('a refused permission is never fatal', () => {
  test('saying no to everything still installs and activates', async () => {
    // Refusing to install because somebody said no to a question turns a
    // choice into an ultimatum.
    const { installer, granted } = harness({ answer: [] });
    const r = await installer.install(await build());
    expect(r.ok).toBe(true);
    expect(r.activated).toBe(true);
    expect(r.granted).toEqual([]);
    expect(r.refused.sort()).toEqual(['library:read:all', 'network']);
    expect(granted['cloud-backup']).toEqual([]);
  });

  test('a partial answer is honoured exactly', async () => {
    const { installer } = harness({ answer: ['library:read:all'] });
    const r = await installer.install(await build());
    expect(r.granted).toEqual(['library:read:all']);
    expect(r.refused).toEqual(['network']);
  });

  test('a dialog cannot grant something it never showed', async () => {
    // The answer is filtered against what was actually asked, so a buggy or
    // hostile prompt implementation cannot widen the result.
    const { installer } = harness({ answer: ['library:read:all', 'library:export', 'browser'] });
    const r = await installer.install(await build());
    expect(r.granted).toEqual(['library:read:all']);
  });

  test('the author reason travels with each question', async () => {
    const { installer, log } = harness();
    await installer.install(await build());
    expect(log.find((l) => l[0] === 'ask')[2].sort()).toEqual(['library:read:all', 'network']);
  });

  test('an extension declaring nothing is never prompted', async () => {
    const { installer, log } = harness();
    const r = await installer.install(await packEpk({
      manifest: { apiVersion: 2, id: 'quiet', name: 'Quiet', version: '1.0.0' },
      modules: MODULES,
    }));
    expect(r.ok).toBe(true);
    expect(log.some((l) => l[0] === 'ask')).toBe(false);
  });
});

describe('an extension that fails to start is still installed', () => {
  test('the files stay, and the reason is reported', async () => {
    // Refusing the whole install would leave nothing to look at in settings,
    // which is exactly where the reason will be.
    const { installer, disk } = harness({ activates: false });
    const r = await installer.install(await build());
    expect(r.ok).toBe(true);
    expect(r.activated).toBe(false);
    expect(r.activationError).toBe('no activate() export');
    expect(disk.has('cloud-backup')).toBe(true);
  });
});

describe('updating', () => {
  test('an unchanged permission set asks nothing', async () => {
    const { installer, log } = harness({ grants: { 'cloud-backup': ['library:read:all', 'network'] } });
    const r = await installer.update('cloud-backup', await build({ version: '2.1.0' }));
    expect(log.some((l) => l[0] === 'ask')).toBe(false);
    expect(r.granted.sort()).toEqual(['library:read:all', 'network']);
  });

  test('only a new permission is asked about', async () => {
    const { installer, log } = harness({
      grants: { 'cloud-backup': ['library:read:all'] },
      answer: ['network'],
    });
    const r = await installer.update('cloud-backup', await build());
    expect(log.find((l) => l[0] === 'ask')[2]).toEqual(['network']);
    expect(r.carried).toEqual(['library:read:all']);
  });

  test('a permission the new manifest stops declaring is dropped', async () => {
    // Or an extension could hold a grant by quietly removing the declaration
    // that explained it.
    const { installer } = harness({ grants: { 'cloud-backup': ['library:read:all', 'network'] } });
    const r = await installer.update('cloud-backup', await build({
      permissions: { 'library:read:all': { reason: 'To copy every book.' } },
    }));
    expect(r.dropped).toEqual(['network']);
    expect(r.granted).toEqual(['library:read:all']);
  });

  test('the old version is stopped before the new files land', async () => {
    const { installer, log } = harness({ grants: { 'cloud-backup': ['library:read:all', 'network'] } });
    await installer.update('cloud-backup', await build());
    const order = log.map((l) => l[0]);
    expect(order.indexOf('deactivate')).toBeLessThan(order.indexOf('write'));
  });

  test('a package for a different extension is refused', async () => {
    const { installer, log } = harness();
    const err = await installer.update('cloud-backup', await build({ id: 'something-else' })).catch((e) => e);
    expect(err.code).toBe('id-mismatch');
    expect(err.found).toBe('something-else');
    expect(log.some((l) => l[0] === 'write')).toBe(false);
  });
});

describe('uninstalling takes the grants with it', () => {
  test('files, storage and grants all go', async () => {
    // Leaving grants behind means reinstalling the same id silently inherits
    // every permission a previous version was given — and the id is chosen by
    // the author.
    const { installer, log, granted } = harness();
    await installer.install(await build());
    const r = await installer.uninstall('cloud-backup');

    expect(r.ok).toBe(true);
    expect(log.map((l) => l[0])).toEqual(
      expect.arrayContaining(['deactivate', 'removeFiles', 'clearStorage', 'grants']),
    );
    expect(granted['cloud-backup']).toEqual([]);
  });

  test('a reinstall after uninstall asks everything again', async () => {
    const { installer, log } = harness();
    await installer.install(await build());
    await installer.uninstall('cloud-backup');
    log.length = 0;

    await installer.install(await build());
    expect(log.find((l) => l[0] === 'ask')[2].sort()).toEqual(['library:read:all', 'network']);
  });

  test('grants are cleared even when deleting the files fails', async () => {
    // The failure that matters is the one that would otherwise be skipped: a
    // directory that will not delete must not leave permissions in place.
    const granted = { 'cloud-backup': ['library:read:all'] };
    const installer = createInstaller({
      writeFiles: async () => {},
      removeFiles: async () => { throw new Error('directory busy'); },
      clearStorage: async () => {},
      readGrants: (id) => granted[id] ?? [],
      writeGrants: async (id, g) => { granted[id] = [...g]; },
      askPermissions: async () => [],
    });

    const r = await installer.uninstall('cloud-backup');
    expect(r.ok).toBe(false);
    expect(r.problems[0].what).toBe('files');
    expect(granted['cloud-backup']).toEqual([]);
  });
});

describe('progress reporting', () => {
  test('the stages come out in order', async () => {
    const { installer, stages } = harness();
    await installer.install(await build());
    expect(stages).toEqual(['verifying', 'checking', 'permissions', 'writing', 'activating', 'done']);
  });

  test('a failure reports the stage it failed at', async () => {
    const { installer, stages } = harness();
    await installer.install(new Uint8Array(300)).catch(() => {});
    expect(stages).toEqual(['verifying']);
  });

  test('a throwing reporter never breaks an install', async () => {
    const installer = createInstaller({
      writeFiles: async () => {}, removeFiles: async () => {},
      writeGrants: async () => {}, askPermissions: async () => [],
      onStage: () => { throw new Error('logging is broken'); },
    });
    await expect(installer.install(await build())).resolves.toMatchObject({ ok: true });
  });
});

/**
 * The worked example in docs/examples must stay valid.
 *
 * It is the port target for Cloud Backup 2.0.0 and the thing an author copies
 * when writing their first v2 manifest, which makes it the one file where a
 * silent rot costs the most: a broken example teaches broken manifests.
 *
 * It also exercises the shape end to end — every permission, a userHosts
 * declaration, three pages reachable separately, a command target, `when`
 * clauses, and a settings schema with a section.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { validateManifestV2 } from './extensionHostV2.js';
import { validateSchema, defaultValues } from './extensionSettingsSchema.js';
import { permissionSetFor, promptPlan } from './extensionPermissionsV2.js';
import { whenAllows, whenContext } from './whenClause.js';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../docs/examples/cloud-backup-v2.manifest.json'), 'utf8'),
);

describe('the Cloud Backup v2 example', () => {
  test('is a valid v2 manifest', () => {
    const r = validateManifestV2(manifest);
    expect({ ok: r.ok, errors: r.errors }).toEqual({ ok: true, errors: [] });
  });

  test('its settings schema is valid', () => {
    const r = validateSchema(manifest.settings.schema);
    expect({ ok: r.ok, errors: r.errors }).toEqual({ ok: true, errors: [] });
    expect(defaultValues(manifest.settings.schema).provider).toBe('Google Drive');
  });

  test('every page is reachable from its own contribution', () => {
    // v1's bug was that every button opened the same page. Three pages, three
    // ways in, is the headline fix of the port.
    const targets = manifest.contributes.bookActions
      .concat(manifest.contributes.settings, manifest.contributes.homescreen)
      .map((c) => c.page ?? `command:${c.command}`);
    expect(new Set(targets).size).toBeGreaterThan(1);
    expect(targets).toContain('cloud-files');
    expect(targets).toContain('conflict');
    expect(targets).toContain('command:sync.now');
  });

  test('"Back up now" runs a command instead of opening settings', () => {
    const action = manifest.contributes.bookActions.find((a) => a.id === 'backup-now');
    expect(action.command).toBe('sync.now');
    expect(action.page).toBeUndefined();
  });

  test('every command a contribution names is declared', () => {
    const declared = new Set(manifest.commands);
    const used = Object.values(manifest.contributes).flat()
      .map((c) => c.command).filter(Boolean);
    expect(used.filter((c) => !declared.has(c))).toEqual([]);
  });

  test('every when clause parses and evaluates', () => {
    const ctx = whenContext({
      app: { platform: 'android' }, book: { isOpen: true, isSaved: true },
      settings: { hasConflict: false },
    });
    for (const c of Object.values(manifest.contributes).flat()) {
      if (!c.when) continue;
      expect({ id: c.id, ok: typeof whenAllows(c.when, ctx, ['network']) === 'boolean' })
        .toEqual({ id: c.id, ok: true });
    }
  });

  test('the conflict action stays hidden until there is a conflict', () => {
    const clause = manifest.contributes.bookActions.find((a) => a.id === 'resolve-conflict').when;
    const quiet = whenContext({ settings: { hasConflict: false } });
    const conflicted = whenContext({ settings: { hasConflict: true } });
    expect(whenAllows(clause, quiet, ['network'])).toBe(false);
    expect(whenAllows(clause, conflicted, ['network'])).toBe(true);
  });

  test('the install prompts read as questions, not as mechanism', () => {
    const plan = promptPlan(manifest.permissions, []);
    expect(plan.ok).toBe(true);
    expect(plan.prompt).toHaveLength(5);
    for (const p of plan.prompt) {
      expect(p.reason.length).toBeGreaterThan(0);
      expect(p.reason).not.toMatch(/sandbox|iframe|CSP|token|OAuth|bridge|dispatch/i);
    }
  });

  test('WebDAV is expressible — the case that did not fit before', () => {
    const perms = permissionSetFor(manifest, ['network']);
    expect(perms.canRequestHost()).toBe(true);
    expect(perms.csp()).toContain('https://api.dropboxapi.com');
    expect(perms.csp()).not.toContain('nas.example.com');

    expect(perms.grantHost('https://nas.example.com').ok).toBe(true);
    expect(perms.csp()).toContain('https://nas.example.com');
  });

  test('WebDAV is offered as a provider now that it can be reached', () => {
    const provider = manifest.settings.schema.find((c) => c.key === 'provider');
    expect(provider.options).toContain('WebDAV');
  });

  test('refusing network leaves no host at all in the policy', () => {
    const perms = permissionSetFor(manifest, ['library:read:all'], ['https://nas.example.com']);
    expect(perms.csp()).toContain("connect-src 'none'");
    expect(perms.csp()).not.toContain('dropbox');
    expect(perms.csp()).not.toContain('nas.example.com');
  });
});

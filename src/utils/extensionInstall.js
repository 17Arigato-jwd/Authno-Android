/**
 * extensionInstall.js — install, update, uninstall.
 *
 * Spec: docs/extension-system-v2-spec.md §9.
 *
 *   install → verify → manifest check → onboarding → permissions → activate
 *
 * Every piece of this already existed and none of it was joined up. What the
 * joining adds is **order**, and the order is not a style choice — three of the
 * steps are only correct where they are:
 *
 * 1. **Verify before writing.** A package is read, repaired and checked
 *    entirely in memory; nothing reaches disk until it has passed. Writing
 *    first and validating after means a refused package still left files
 *    behind, and the next scan finds them.
 *
 * 2. **Onboarding before permissions.** Somebody deciding whether an extension
 *    may read every book should have been told what it does first. Prompting
 *    before explaining is how a permission screen becomes a thing to tap
 *    through.
 *
 * 3. **Grants are destroyed on uninstall.** Otherwise reinstalling the same id
 *    silently inherits every permission the user granted a previous version —
 *    which is a way to acquire access without ever asking for it.
 *
 * And one rule that runs through all of it: **a refused permission is never
 * fatal.** The extension installs, activates and runs inert. Refusing to
 * install something because the user said no to one of its questions turns a
 * choice into an ultimatum.
 */

import { readEpk, isEpk } from './epkFormat.js';
import { validateManifestV2 } from './extensionHostV2.js';
import { promptPlan } from './extensionPermissionsV2.js';

/** The stages, in order. Reported on both success and failure. */
export const STAGES = [
  'verifying', 'checking', 'onboarding', 'permissions', 'writing', 'activating', 'done',
];

export class InstallError extends Error {
  constructor(stage, code, message, extra = {}) {
    super(message);
    this.name = 'InstallError';
    this.stage = stage;
    this.code = code;
    Object.assign(this, extra);
  }
}

const MAX_ONBOARDING_STEPS = 5;

/**
 * @param {object}   o
 * @param {Function} o.writeFiles     (extId, files) => Promise      only after verification
 * @param {Function} o.removeFiles    (extId) => Promise
 * @param {Function} o.readGrants     (extId) => string[]
 * @param {Function} o.writeGrants    (extId, granted, userHosts) => Promise
 * @param {Function} o.clearStorage   (extId) => Promise
 * @param {Function} o.askPermissions (extId, plan, meta) => Promise<string[]>   what was granted
 * @param {Function} [o.showOnboarding] (extId, steps) => Promise<boolean>
 * @param {Function} [o.activate]     (manifest, files, granted) => Promise<{ok, error}>
 * @param {Function} [o.deactivate]   (extId) => Promise
 * @param {Function} [o.onStage]      (stage, detail) => void
 */
export function createInstaller({
  writeFiles,
  removeFiles,
  readGrants = () => [],
  writeGrants = async () => {},
  clearStorage = async () => {},
  askPermissions,
  showOnboarding = null,
  activate = async () => ({ ok: true }),
  deactivate = async () => {},
  onStage = null,
}) {
  const say = (stage, detail = {}) => {
    if (onStage) { try { onStage(stage, detail); } catch { /* reporting is best-effort */ } }
  };

  /**
   * Read and check a package without touching disk.
   *
   * Returns the manifest and files, or throws. `fromChannel` is passed through
   * to the reader, which refuses an unsigned package that arrived over the
   * network (§7.2) — a check that has to happen here rather than later,
   * because "later" is after the bytes are already installed.
   */
  async function verify(bytes, { fromChannel = false, publicKey = null } = {}) {
    say('verifying');

    if (!isEpk(bytes)) {
      throw new InstallError('verifying', 'not-epk',
        'this file was built for the old API — rebuild it with extbk build against v2');
    }

    let pkg;
    try {
      pkg = await readEpk(bytes, { fromChannel, publicKey });
    } catch (e) {
      throw new InstallError('verifying', e.reason ?? 'unreadable', e.message, {
        resumeFrom: e.resumeFrom,
      });
    }

    say('checking', { repairs: pkg.repairs.length });
    const check = validateManifestV2(pkg.manifest);
    if (!check.ok) {
      throw new InstallError('checking', 'bad-manifest',
        `this extension's manifest is not valid: ${check.errors[0]}`, { errors: check.errors });
    }

    return { pkg, warnings: check.warnings };
  }

  /** Onboarding, if the author wrote any. Optional by design (§7). */
  async function onboard(manifest) {
    const steps = manifest.onboarding?.steps;
    if (!showOnboarding || !Array.isArray(steps) || steps.length === 0) return true;
    if (steps.length > MAX_ONBOARDING_STEPS) {
      throw new InstallError('onboarding', 'too-many-steps',
        `onboarding may have at most ${MAX_ONBOARDING_STEPS} steps; this has ${steps.length}`);
    }
    say('onboarding', { steps: steps.length });
    // Skipping is allowed and is not a refusal — somebody who already knows
    // what an extension does should not have to be told.
    return !!(await showOnboarding(manifest.id, steps));
  }

  /**
   * Ask for what the manifest declares, and honour the answer.
   *
   * A refusal is never fatal. The plan carries the author's own reason for
   * each, which is the only thing on that screen written by somebody who knows
   * why the permission is wanted.
   */
  async function requestPermissions(manifest, previouslyGranted) {
    const plan = promptPlan(manifest.permissions, previouslyGranted);
    if (!plan.ok) {
      throw new InstallError('permissions', 'bad-permissions', plan.errors[0], { errors: plan.errors });
    }
    if (plan.prompt.length === 0) return { granted: plan.carried, plan };

    say('permissions', { asking: plan.prompt.length, carried: plan.carried.length });
    const answered = (await askPermissions(manifest.id, plan, {
      name: manifest.name,
      version: manifest.version,
      icon: manifest.icon ?? null,
    })) ?? [];

    // Only what was actually asked about can be added by the answer, and only
    // what the manifest still declares survives from before. A dialog cannot
    // grant something it never showed.
    const askable = new Set(plan.prompt.map((p) => p.permission));
    const granted = [
      ...plan.carried,
      ...answered.filter((p) => askable.has(p)),
    ];
    return { granted: [...new Set(granted)], plan };
  }

  return {
    /**
     * Install a package.
     *
     * Nothing is written until the package has been verified and its manifest
     * checked, so a refusal leaves the disk exactly as it was.
     */
    async install(bytes, { fromChannel = false, publicKey = null } = {}) {
      const { pkg, warnings } = await verify(bytes, { fromChannel, publicKey });
      const manifest = pkg.manifest;

      const onboarded = await onboard(manifest);
      const { granted, plan } = await requestPermissions(manifest, []);

      say('writing');
      await writeFiles(manifest.id, pkg.modules);
      await writeGrants(manifest.id, granted, []);

      say('activating');
      const started = await activate(manifest, pkg.modules, granted);

      say('done', { id: manifest.id });
      return {
        ok: true,
        id: manifest.id,
        manifest,
        granted,
        refused: plan.prompt.map((p) => p.permission).filter((p) => !granted.includes(p)),
        onboarded,
        repairs: pkg.repairs,
        warnings,
        // An extension that failed to start is still installed: the files are
        // on disk and the user can look at it in settings, which is where the
        // reason will be. Refusing the whole install would leave nothing to
        // look at.
        activated: !!started.ok,
        activationError: started.ok ? null : started.error,
      };
    },

    /**
     * Update an installed extension.
     *
     * Storage survives, because it is the extension's own data and an update is
     * not a fresh start. Grants for unchanged permissions survive too, so
     * somebody is not re-asked about a decision they already made — but a
     * permission the new manifest stops declaring is dropped rather than kept,
     * or an extension could hold a grant by quietly removing the declaration
     * that explained it.
     */
    async update(extId, bytes, { fromChannel = false, publicKey = null } = {}) {
      const { pkg, warnings } = await verify(bytes, { fromChannel, publicKey });
      const manifest = pkg.manifest;

      if (manifest.id !== extId) {
        throw new InstallError('checking', 'id-mismatch',
          `this package is ${manifest.id}, not ${extId}`, { expected: extId, found: manifest.id });
      }

      const previous = readGrants(extId) ?? [];
      const { granted, plan } = await requestPermissions(manifest, previous);

      await deactivate(extId);

      say('writing');
      await writeFiles(extId, pkg.modules);
      await writeGrants(extId, granted, []);

      say('activating');
      const started = await activate(manifest, pkg.modules, granted);

      say('done', { id: extId });
      return {
        ok: true,
        id: extId,
        manifest,
        granted,
        carried: plan.carried,
        dropped: plan.dropped,
        askedAgain: plan.prompt.map((p) => p.permission),
        repairs: pkg.repairs,
        warnings,
        activated: !!started.ok,
        activationError: started.ok ? null : started.error,
      };
    },

    /**
     * Remove an extension completely.
     *
     * Grants go with the files. Leaving them behind means reinstalling the same
     * id silently inherits every permission a previous version was given, which
     * is a way to acquire access without ever asking for it — and the id is
     * chosen by the author.
     */
    async uninstall(extId) {
      await deactivate(extId);

      const problems = [];
      // Each step is attempted even if an earlier one failed. A directory that
      // will not delete must not leave the grants in place — that is the
      // failure that matters, and it is the one that would be skipped.
      for (const [what, fn] of [
        ['files', () => removeFiles(extId)],
        ['storage', () => clearStorage(extId)],
        ['grants', () => writeGrants(extId, [], [])],
      ]) {
        try { await fn(); } catch (e) { problems.push({ what, error: String(e?.message ?? e) }); }
      }

      return { ok: problems.length === 0, id: extId, problems };
    },
  };
}

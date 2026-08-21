/**
 * installEvents.js — lifecycle bus for .extbk / .thmbk installs (C1/C2).
 *
 * The install pipeline (native intent → installer → activation) previously ran
 * with zero UI: no progress, no success state, no error surface — a tapped
 * .extbk either silently appeared after a refresh or silently failed to the
 * console. Installers now emit staged events on this bus and InstallSheet
 * renders them as an animated bottom sheet.
 *
 * Event shape:
 *   {
 *     id:      string          // one install session
 *     kind:    'extension' | 'theme'
 *     stage:   'validating' | 'decoding' | 'writing' | 'permissions'
 *                       | 'activating' | 'done' | 'error'
 *     name?:   string          // manifest.name once known
 *     version?: string
 *     fromVersion?: string     // present when this is an UPDATE
 *     progress?: number        // 0..1 within the writing stage
 *     fileCount?: number
 *     filesWritten?: number
 *     asking?: number          // permissions stage: how many are being asked
 *     error?:  string
 *   }
 *
 * `permissions` is the one stage that is not the installer working. The
 * install has stopped and is waiting for a person to answer, which is why
 * InstallSheet steps aside for it rather than drawing progress: the sheet is
 * bottom-anchored, so is the question, and the sheet was on top of it.
 */

const listeners = new Set();

export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitInstall(evt) {
  for (const fn of listeners) {
    try { fn(evt); } catch (e) { console.error('[installEvents]', e); }
  }
}

export function newInstallId() {
  return `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

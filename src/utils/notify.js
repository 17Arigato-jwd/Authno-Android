/**
 * notify.js — showing a notification right now, on whatever this is running on.
 *
 * Distinct from reminders.js, which *schedules*. This posts one immediately,
 * and it is what the "Send a test notification" button calls: the whole point
 * of that button is to prove the path end to end on the machine in front of
 * you, so it must use the same delivery each platform really uses rather than
 * a convenient stand-in.
 *
 * Three platforms, three mechanisms, one answer:
 *
 *   Android  — the Reminders plugin's showNow, so it goes through the same
 *              NotificationChannel and the same POST_NOTIFICATIONS permission
 *              a scheduled reminder does. A test that used a different channel
 *              could pass while the real one was blocked.
 *   Electron — the main process's Notification, which is the only one that
 *              reaches the Windows Action Center and a Linux notification
 *              daemon. A renderer-side `new Notification()` looks like it
 *              works and silently does nothing when the window is hidden,
 *              which is exactly when a reminder matters.
 *   Web      — the standard Notification API, permission and all. This is the
 *              weakest of the three and says so: a browser tab that is closed
 *              cannot be reminded of anything.
 *
 * Every path returns a reason rather than throwing. A notification that does
 * not arrive is a missing convenience, and the settings screen needs to be
 * able to say *why* — "denied" and "unsupported" call for different advice.
 */

import { isAndroid } from './platform';

/** @typedef {'shown'|'denied'|'unsupported'|'failed'} NotifyResult */

let _plugin = null;

/**
 * The plugin, in a box — the same wrapper widgetBridge and reminders.js use,
 * for the same reason. Capacitor's plugin object is a Proxy answering every
 * property with a callable, `then` included, so returning it bare from an
 * async function hands it to promise resolution and the await never settles.
 */
async function getPlugin() {
  if (!isAndroid()) return null;
  if (_plugin) return { plugin: _plugin };
  try {
    const { registerPlugin } = await import('@capacitor/core');
    _plugin = registerPlugin('Reminders');
    return { plugin: _plugin };
  } catch {
    return null;
  }
}

/** True when this build is running inside Electron. */
function electronBridge() {
  return (typeof window !== 'undefined' && window.electron) || null;
}

/**
 * Post a notification now.
 *
 * @param {{ title: string, body: string }} msg
 * @returns {Promise<NotifyResult>}
 */
export async function notifyNow({ title, body } = {}) {
  const t = String(title ?? '').trim() || 'AuthNo';
  const b = String(body ?? '').trim();

  // ── Android ────────────────────────────────────────────────────────────────
  const box = await getPlugin();
  if (box) {
    try {
      const res = await box.plugin.showNow({ title: t, body: b });
      // The plugin reports the permission state rather than throwing on a
      // refusal, because "you said no" is an answer and not a fault.
      if (res?.status === 'denied') return 'denied';
      return res?.status === 'shown' ? 'shown' : 'failed';
    } catch {
      return 'failed';
    }
  }

  // ── Windows and Linux, through Electron's main process ────────────────────
  const el = electronBridge();
  if (el?.notify) {
    try {
      const res = await el.notify({ title: t, body: b });
      if (res && res.ok === false) return res.reason === 'denied' ? 'denied' : 'unsupported';
      return 'shown';
    } catch {
      return 'failed';
    }
  }

  // ── Web ────────────────────────────────────────────────────────────────────
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      let perm = window.Notification.permission;
      if (perm === 'default') perm = await window.Notification.requestPermission();
      if (perm !== 'granted') return 'denied';
      // eslint-disable-next-line no-new
      new window.Notification(t, { body: b });
      return 'shown';
    } catch {
      return 'failed';
    }
  }

  return 'unsupported';
}

/**
 * What to tell the writer about a result.
 *
 * Here rather than in the settings component because the same four outcomes
 * are reachable from more than one screen, and four ways of saying "denied"
 * is how a product ends up contradicting itself.
 */
export function notifyResultText(result) {
  switch (result) {
    case 'shown':
      return 'Sent — check your notifications.';
    case 'denied':
      return 'Your device is blocking notifications for AuthNo. Turn them on in system settings.';
    case 'unsupported':
      return 'This device cannot show notifications.';
    default:
      return 'That did not get through. Nothing else is affected.';
  }
}

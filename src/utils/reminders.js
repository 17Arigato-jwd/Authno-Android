/**
 * reminders.js — the JS side of the streak reminder.
 *
 * A daily nudge, scheduled natively so it fires whether or not the app is
 * running. Everything here is best-effort: off Android there is no plugin,
 * and on Android the writer can refuse the notification permission. Neither
 * is an error worth surfacing — a reminder that does not arrive is a missing
 * convenience, not a broken app, and the streak itself is unaffected.
 *
 * The scheduling decision does NOT live here. `streakSettings.js` answers
 * "should there be a reminder", because the widget and the settings screen
 * need the same answer and neither should have to reach through this module
 * to get it.
 */

import { reminderConfig, shouldScheduleReminder } from './streakSettings';
import { isAndroid } from './platform';

let _cache = null;

/**
 * The plugin, in a box — the same wrapper widgetBridge uses, for the same
 * reason. Capacitor's plugin object is a Proxy answering every property with
 * a callable, `then` included, so returning it from an async function hands
 * it to promise resolution, which calls `proxy.then(resolve, reject)` and
 * never gets either back. The await then hangs forever instead of throwing.
 * Do not "simplify" this to returning the plugin directly.
 *
 * @returns {Promise<null | { plugin: object }>}
 */
async function getPlugin() {
  if (!isAndroid()) return null;
  if (_cache) return { plugin: _cache };
  try {
    const { registerPlugin } = await import('@capacitor/core');
    _cache = registerPlugin('Reminders');
    return { plugin: _cache };
  } catch {
    return null;
  }
}

/**
 * Ask for permission to post notifications.
 *
 * Called when the writer switches the reminder ON, never before. Android 13+
 * shows a system prompt; below that it is granted at install time and this
 * resolves immediately.
 *
 * @returns {Promise<'granted'|'denied'|'unavailable'>}
 */
export async function requestNotificationPermission() {
  const box = await getPlugin();
  if (!box) return 'unavailable';
  try {
    const res = await box.plugin.requestPermission();
    return res?.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** What the system currently thinks, without prompting. */
export async function checkNotificationPermission() {
  const box = await getPlugin();
  if (!box) return 'unavailable';
  try {
    const res = await box.plugin.checkPermission();
    return res?.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Bring the native alarm in line with the settings — schedule it, move it, or
 * cancel it. Safe and cheap to call after any settings or session change;
 * the native side replaces the existing alarm rather than stacking a second.
 *
 * @returns {Promise<'scheduled'|'cancelled'|'unavailable'>}
 */
export async function syncReminder(sessions, settings) {
  const box = await getPlugin();
  if (!box) return 'unavailable';

  const wanted = shouldScheduleReminder(sessions, settings);
  try {
    if (!wanted) {
      await box.plugin.cancel();
      return 'cancelled';
    }
    const cfg = reminderConfig(settings);
    await box.plugin.schedule({
      hour: cfg.hour,
      minute: cfg.minute,
      skipWhenMet: cfg.skipWhenMet,
    });
    return 'scheduled';
  } catch {
    return 'unavailable';
  }
}

/**
 * Tell the native side today's progress, so a reminder can hold its tongue on
 * a day the goal is already met.
 *
 * The alarm fires with the app closed, so the receiver cannot ask the web
 * layer anything — it can only read what was last written down. This is that
 * writing-down, and it is why `skipWhenMet` is decided natively rather than
 * here: by the time the reminder is due, "here" may not have run for hours.
 *
 * @param {boolean} metToday   goal reached in at least one counting book
 * @param {number}  streakDays the longest live streak, for the wording
 */
export async function reportProgress(metToday, streakDays) {
  const box = await getPlugin();
  if (!box) return false;
  try {
    await box.plugin.reportProgress({
      metToday: !!metToday,
      streakDays: Number.isFinite(streakDays) ? Math.max(0, Math.round(streakDays)) : 0,
      // Date-stamped so a receiver waking up tomorrow can tell that what it
      // is holding is yesterday's answer and treat the day as unmet.
      dayKey: todayKey(),
    });
    return true;
  } catch {
    return false;
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

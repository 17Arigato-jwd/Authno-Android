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

import { reminderConfig, reminderSlots, shouldScheduleReminder } from './streakSettings';
import { isAndroid } from './platform';
import { currentWritingDay } from './writeClock';

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

/**
 * Whether the OS will actually let the alarm run in the background.
 *
 * Separate from the notification permission and far less understood. An
 * aggressive OEM power manager will silently drop a repeating alarm from an
 * app it considers idle, and the writer experiences that as the reminder
 * being broken rather than as a setting they have never seen. Asked so the
 * settings screen can say what is happening; never demanded.
 *
 * @returns {Promise<'unrestricted'|'restricted'|'unavailable'>}
 */
export async function checkBackgroundAllowed() {
  const box = await getPlugin();
  if (!box) return 'unavailable';
  try {
    const res = await box.plugin.checkBackgroundAllowed();
    return res?.status === 'restricted' ? 'restricted' : 'unrestricted';
  } catch {
    return 'unavailable';
  }
}

/** Open the system screen where that restriction can be lifted. */
export async function openBackgroundSettings() {
  const box = await getPlugin();
  if (!box) return false;
  try {
    await box.plugin.openBackgroundSettings();
    return true;
  } catch {
    return false;
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
    const slots = reminderSlots(settings);
    await box.plugin.schedule({
      hour: cfg.hour,
      minute: cfg.minute,
      skipWhenMet: cfg.skipWhenMet,
      // The second slot rides alongside rather than replacing the first two
      // fields, so a build of the app running against an older native side
      // keeps its single daily reminder instead of losing it to an argument
      // it does not understand.
      slotsJson: JSON.stringify(slots),
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
 * @param {number}  goalWords  the goal to name in the notification body
 */
export async function reportProgress(metToday, streakDays, goalWords) {
  const box = await getPlugin();
  if (!box) return false;
  try {
    await box.plugin.reportProgress({
      metToday: !!metToday,
      streakDays: Number.isFinite(streakDays) ? Math.max(0, Math.round(streakDays)) : 0,
      goalWords: Number.isFinite(goalWords) ? Math.max(0, Math.round(goalWords)) : 0,
      // Date-stamped so a receiver waking up tomorrow can tell that what it
      // is holding is yesterday's answer and treat the day as unmet.
      //
      // The WRITING day, matching the key `metToday` was worked out under.
      // Stamping the calendar date instead would mean a goal met at 00:40 —
      // which belongs to the night before — was filed against the day that had
      // just started, and the following evening's reminder would fall silent
      // on a day nobody had written a word of.
      dayKey: todayKey(),
    });
    return true;
  } catch {
    return false;
  }
}

function todayKey() {
  return currentWritingDay();
}

/**
 * streakSettings.js — one answer to "are streaks on here?"
 *
 * Streaks can be switched off globally, or for one book while the rest keep
 * counting. That is two settings living in two different places — the global
 * flag in `writerSettings`, the per-book flag inside the book's own `streak`
 * object, which travels with the `.authbook` file — and every consumer needs
 * the same resolution of the two. Before this the expression
 * `book?.streak?.streakEnabled ?? settings.streakEnabled ?? true` was written
 * out by hand at four call sites and nowhere else, so the widget, the
 * reminder and the recorder each had their own idea.
 *
 * Everything here is pure. The point is that "is this on?" is answerable
 * without a React tree, because the widget bridge and the reminder scheduler
 * both need to ask outside one.
 */

/** Nothing set anywhere means on — streaks are the app's default behaviour. */
export const STREAKS_DEFAULT = true;

/**
 * Global switch. Off means no book counts, whatever its own flag says.
 *
 * A book-level `true` cannot re-enable streaks under a global `false`: the
 * global switch is the writer saying "not for me", and a per-book setting
 * from six months ago should not overrule that.
 */
export function streaksEnabledGlobally(settings) {
  return settings?.streakEnabled ?? STREAKS_DEFAULT;
}

/**
 * The per-book flag on its own, with no global applied.
 *
 * `null` means "this book has no opinion" — it follows the global. That is a
 * third state and it has to survive round-trips, which is why turning a book
 * back to "follow global" deletes the key rather than writing `true`.
 */
export function bookStreakPreference(book) {
  const v = book?.streak?.streakEnabled;
  return typeof v === 'boolean' ? v : null;
}

/** What actually happens for this book, once both settings are applied. */
export function streaksEnabledFor(book, settings) {
  if (!streaksEnabledGlobally(settings)) return false;
  const own = bookStreakPreference(book);
  return own === null ? true : own;
}

/**
 * A book's streak object with the flag set, or with it removed for `null`.
 *
 * Returns the streak object rather than the book: callers patch through
 * `onSessionChange(id, { streak })`, and handing back a whole book would
 * invite one to overwrite fields it never read.
 */
export function withBookStreakPreference(book, enabled) {
  const streak = { ...(book?.streak ?? {}) };
  if (enabled === null || enabled === undefined) delete streak.streakEnabled;
  else streak.streakEnabled = !!enabled;
  return streak;
}

/**
 * The books still counting, for the reminder and the widget.
 *
 * Storyboards are excluded for the same reason they are excluded from the
 * widget sync: they are not books and have no word goal.
 */
export function booksWithStreaks(sessions, settings) {
  if (!streaksEnabledGlobally(settings)) return [];
  return (sessions || []).filter(
    (s) => s && s.type !== 'storyboard' && streaksEnabledFor(s, settings),
  );
}

// ── Reminders ────────────────────────────────────────────────────────────────

/**
 * Off by default, and deliberately.
 *
 * A writing app that starts notifying without being asked has made a decision
 * on the writer's behalf about something they will see on their lock screen.
 * The permission prompt is also a cost: asking on first launch, before anyone
 * has written anything, spends it on a feature nobody has met yet.
 */
export const DEFAULT_REMINDER = {
  enabled: false,
  hour: 20,      // 24-hour clock, device local time
  minute: 0,
  /** Skip the nudge on days the goal is already met. */
  skipWhenMet: true,
};

export function reminderConfig(settings) {
  const r = settings?.streakReminder;
  if (!r || typeof r !== 'object') return { ...DEFAULT_REMINDER };
  return {
    enabled: !!r.enabled,
    hour: clampInt(r.hour, 0, 23, DEFAULT_REMINDER.hour),
    minute: clampInt(r.minute, 0, 59, DEFAULT_REMINDER.minute),
    skipWhenMet: r.skipWhenMet !== false,
  };
}

/**
 * Should a reminder actually be scheduled right now?
 *
 * Two conditions, both easy to get wrong separately: the reminder is switched
 * on, AND there is at least one book still counting. Turning streaks off
 * globally has to cancel the alarm — otherwise the phone keeps buzzing about
 * a feature the writer has just switched off, which reads as a bug in the
 * app rather than a setting they missed.
 */
export function shouldScheduleReminder(sessions, settings) {
  const cfg = reminderConfig(settings);
  if (!cfg.enabled) return false;
  return booksWithStreaks(sessions, settings).length > 0;
}

/** "20:00" — for the settings row and for the native payload. */
export function formatReminderTime(cfg) {
  const c = cfg && typeof cfg.hour === 'number' ? cfg : DEFAULT_REMINDER;
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

/** Parses "20:00" back. Returns null rather than guessing at junk. */
export function parseReminderTime(text) {
  const m = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

package com.aurorastudios.authno;

import java.util.Calendar;
import java.util.Locale;

/**
 * Which day the words being written right now belong to.
 *
 * Usually the date on the device. Between midnight and 4am it can still be
 * yesterday: a session that was still running when midnight arrived holds the
 * day open an hour at a time. The rule lives in JS (utils/streakWindow.js),
 * where it can see when the writer last actually wrote; this side is handed
 * the answer with every sync and only has to decide whether it is still good.
 *
 * ── Why not recompute it here ────────────────────────────────────────────────
 *
 * Two implementations of a rule that decides whether somebody keeps a streak
 * is one more than anybody can keep honest. The widget deciding the day had
 * ended and the app deciding it had not would put a broken run and an unbroken
 * one on the same screen.
 *
 * ── Why the deadline is the freshness test ───────────────────────────────────
 *
 * A synced day key goes stale on its own: an app that has not run since
 * Tuesday left Tuesday's answer behind. Rather than guessing an expiry, the
 * payload carries the absolute moment the window closes, so a stored day is
 * trustworthy exactly while that moment is still ahead. Once it has passed,
 * the device's own date is right by definition — the window is over, and what
 * comes after it is a new day.
 *
 * Imports nothing from android and nothing from org.json, so it compiles and
 * RUNS off-device. That is the whole reason the JSON is parsed by the callers
 * rather than here.
 */
final class WritingDay {

    private WritingDay() {}

    /**
     * @param deadline    absolute millis the window closes, 0 if never synced
     * @param dayKey      "yyyy-mm-dd" from the same payload, "" if never synced
     * @param now         wall-clock millis
     * @param deviceToday the device's own date, in the same format
     */
    static String pick(long deadline, String dayKey, long now, String deviceToday) {
        // The shape check matters: a malformed key would be compared against
        // log entries that use the real format, match nothing, and report
        // every day as unwritten — a whole streak gone on a typo.
        if (deadline > now && dayKey != null && dayKey.matches("\\d{4}-\\d{2}-\\d{2}")) return dayKey;
        return deviceToday;
    }

    /** Today by the device's calendar, in the format the streak log is keyed by. */
    static String deviceToday() {
        Calendar c = Calendar.getInstance();
        return dateKey(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH));
    }

    /** month is 0-based, matching Calendar. */
    static String dateKey(int year, int month0, int day) {
        return String.format(Locale.US, "%04d-%02d-%02d", year, month0 + 1, day);
    }

    /**
     * "2026-08-14" → a Calendar at local midnight on that date.
     *
     * Falls back to today rather than throwing. A key this cannot parse means
     * something upstream wrote nonsense, and refusing to draw the widget is a
     * worse answer than drawing the calendar's day.
     */
    static Calendar toCalendar(String key) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        try {
            String[] parts = key.split("-");
            if (parts.length != 3) return c;
            c.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
        } catch (Exception ignored) { /* today, already loaded */ }
        return c;
    }
}

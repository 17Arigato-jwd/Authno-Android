package com.aurorastudios.authno;

import java.util.ArrayList;
import java.util.List;

/**
 * The times a reminder fires, and the words it fires with.
 *
 * Both arrive from JS as JSON and both have to survive being read by a
 * receiver that woke up alone, days later, with no app running. So this parses
 * without org.json — a hand-rolled reader over a shape this side controls
 * completely — and therefore imports nothing at all, which is what lets the
 * parsing be tested off-device where the mistakes are.
 *
 * ── Why the copy is precomputed ──────────────────────────────────────────────
 *
 * The lines come from utils/reminderCopy.js, which picks by time of day, by
 * how long the run is, by how close the goal is and by which book was last
 * open. None of that is knowable here. Reimplementing it in Java would put the
 * same rules in two languages and let them drift, and the drift would only
 * ever be visible on somebody's lock screen. So the app renders both slots'
 * lines whenever it reports progress, and this side just picks the one for the
 * slot that fired — falling back to ReminderText when what is stored is from
 * another day, on the same principle shouldNotify already uses.
 */
final class ReminderSlots {

    private ReminderSlots() {}

    /** More than this is a configuration nobody asked for. */
    static final int MAX = 4;

    static final class Slot {
        final int hour;
        final int minute;
        final String name; // "morning" | "evening"

        Slot(int hour, int minute, String name) {
            this.hour = hour;
            this.minute = minute;
            this.name = name;
        }
    }

    /**
     * Parse `[{"hour":9,"minute":30,"slot":"morning"}, …]`.
     *
     * Anything unparseable returns empty and the caller falls back to the
     * single stored hour/minute — a writer whose reminder quietly stopped is a
     * worse outcome than one who gets the old single reminder.
     */
    static List<Slot> parse(String json) {
        List<Slot> out = new ArrayList<>();
        if (json == null) return out;
        int i = 0;
        while (i < json.length() && out.size() < MAX) {
            int open = json.indexOf('{', i);
            if (open < 0) break;
            int close = json.indexOf('}', open);
            if (close < 0) break;
            String obj = json.substring(open + 1, close);
            int hour = intField(obj, "hour", -1);
            int minute = intField(obj, "minute", 0);
            String name = stringField(obj, "slot");
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                out.add(new Slot(hour, minute, "morning".equals(name) ? "morning" : "evening"));
            }
            i = close + 1;
        }
        return out;
    }

    /**
     * The title and body the app rendered for this slot, or null.
     *
     * `lines` is `{"morning":{"title":"…","body":"…"},"evening":{…}}`. Returns
     * null for anything missing rather than an empty pair, so the caller can
     * tell "no line stored" from "a line that happens to be short".
     */
    static String[] lineFor(String linesJson, String slot) {
        if (linesJson == null || slot == null) return null;
        int at = linesJson.indexOf('"' + slot + '"');
        if (at < 0) return null;
        int open = linesJson.indexOf('{', at);
        if (open < 0) return null;
        int close = linesJson.indexOf('}', open);
        if (close < 0) return null;
        String obj = linesJson.substring(open + 1, close);
        String title = stringField(obj, "title");
        String body = stringField(obj, "body");
        if (title == null || body == null || title.isEmpty() || body.isEmpty()) return null;
        return new String[]{ title, body };
    }

    // ── The small reader ──────────────────────────────────────────────────────
    //
    // Enough JSON for the two shapes above and no more. Both are written by
    // JSON.stringify on this project's own objects, so the only escapes that
    // can appear are the ones handled here.

    private static int intField(String obj, String key, int fallback) {
        String raw = rawAfterKey(obj, key);
        if (raw == null) return fallback;
        int end = 0;
        while (end < raw.length() && (Character.isDigit(raw.charAt(end)) || (end == 0 && raw.charAt(end) == '-'))) end++;
        if (end == 0) return fallback;
        try {
            return Integer.parseInt(raw.substring(0, end));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String stringField(String obj, String key) {
        String raw = rawAfterKey(obj, key);
        if (raw == null || raw.isEmpty() || raw.charAt(0) != '"') return null;
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == '\\' && i + 1 < raw.length()) {
                char n = raw.charAt(++i);
                switch (n) {
                    case 'n': sb.append('\n'); break;
                    case 't': sb.append('\t'); break;
                    case 'u':
                        if (i + 4 < raw.length()) {
                            try {
                                sb.append((char) Integer.parseInt(raw.substring(i + 1, i + 5), 16));
                                i += 4;
                            } catch (NumberFormatException ignored) { /* leave it out */ }
                        }
                        break;
                    default: sb.append(n);
                }
                continue;
            }
            if (c == '"') return sb.toString();
            sb.append(c);
        }
        return null; // unterminated
    }

    /** Everything after `"key":`, whitespace skipped, or null. */
    private static String rawAfterKey(String obj, String key) {
        int at = obj.indexOf('"' + key + '"');
        if (at < 0) return null;
        int colon = obj.indexOf(':', at + key.length() + 2);
        if (colon < 0) return null;
        int i = colon + 1;
        while (i < obj.length() && Character.isWhitespace(obj.charAt(i))) i++;
        return i < obj.length() ? obj.substring(i) : null;
    }
}

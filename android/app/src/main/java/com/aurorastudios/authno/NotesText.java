package com.aurorastudios.authno;

import java.util.Locale;

/**
 * The words on the Notes widget.
 *
 * Split out of NotesWidgetProvider for the same reason ResumeText is: it
 * imports nothing from android, so it can be compiled and RUN off-device.
 * A widget provider is otherwise glue that only means anything on a launcher,
 * and none of this project's native code has ever executed on hardware — so
 * the parts that are ordinary logic are worth pinning down where they can be.
 *
 * Most of the trimming happens in JS: buildNotesPayload() in src/utils/notes.js
 * already caps the title at 40 characters and the preview at 60, and already
 * answers "Empty note" for a note with nothing in it. What is left here is what
 * only the widget knows — how many rows it can show, and what a row says when
 * the note has no second line.
 */
final class NotesText {

    private NotesText() {}

    /** The fallback the JS payload uses when a note has no text on any line. */
    static final String EMPTY_NOTE = "Empty note";

    /**
     * A title that is safe to put in a row.
     *
     * The payload should never send a blank one, but "should never" is not a
     * guarantee across a JSON bridge and a SharedPreferences round-trip, and a
     * row with no text in it reads as a rendering fault rather than as a note.
     */
    static String title(String raw) {
        if (raw == null) return EMPTY_NOTE;
        String t = raw.trim();
        return t.isEmpty() ? EMPTY_NOTE : t;
    }

    /**
     * The second line of a row: what the note goes on to say, or when it was
     * written.
     *
     * A one-line note is the common case — that is what quick capture is for —
     * so falling back to the time keeps every row two lines tall and stops the
     * list jumping around as notes are added. Returns an empty string, never
     * null, because RemoteViews.setTextViewText(null) throws.
     */
    static String secondary(String preview, long updated, long now) {
        if (preview != null && !preview.trim().isEmpty()) return preview.trim();
        String when = ResumeText.ago(updated, now);
        return when == null ? "" : when;
    }

    static String secondary(String preview, long updated) {
        return secondary(preview, updated, System.currentTimeMillis());
    }

    /**
     * The header's count.
     *
     * Counts everything stored, not the handful of rows that fit, so a writer
     * with thirty notes is not told they have four. `shown` is what the widget
     * rendered; it is used only to say that there is more below.
     */
    static String countLabel(int total) {
        if (total <= 0) return "No notes yet";
        return String.format(Locale.getDefault(), "%,d note%s", total, total == 1 ? "" : "s");
    }

    /**
     * "+3 more" under the last row, or null when everything is on screen.
     *
     * Null rather than an empty string so the caller hides the view instead of
     * leaving a blank line where a row used to be.
     */
    static String moreLabel(int total, int shown) {
        int rest = total - Math.max(0, shown);
        if (rest <= 0) return null;
        return String.format(Locale.getDefault(), "+%,d more", rest);
    }
}

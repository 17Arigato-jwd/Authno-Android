package com.aurorastudios.authno;

import java.util.Locale;

/**
 * The words on the Resume card.
 *
 * Split out of ResumeWidgetProvider deliberately: it imports nothing from
 * android, so it can be compiled and RUN off-device. Everything else in a
 * widget provider is glue that only means anything on a launcher, but this is
 * ordinary logic with ordinary edge cases — plurals, a clock that has gone
 * backwards, a timestamp that was never written — and those are worth pinning
 * down rather than eyeballing.
 */
final class ResumeText {

    private ResumeText() {}

    /** "1,204 words · 2h ago" — one line, degrading as information runs out. */
    static String meta(int words, long ts) {
        return meta(words, ts, System.currentTimeMillis());
    }

    /** Testable form: `now` injected so the elapsed-time branches are reachable. */
    static String meta(int words, long ts, long now) {
        String left = String.format(Locale.getDefault(), "%,d word%s",
                Math.max(0, words), words == 1 ? "" : "s");
        String when = ago(ts, now);
        return when == null ? left : left + " · " + when;
    }

    static String ago(long ts) {
        return ago(ts, System.currentTimeMillis());
    }

    /**
     * Coarse, and deliberately so. "2h ago" is what a glance needs.
     *
     * Returns null rather than a value when it cannot tell — no timestamp, or a
     * timestamp in the future, which happens after a timezone change or a
     * restored backup. Saying nothing is better than "in -3h ago"; the card
     * simply shows the word count on its own.
     */
    static String ago(long ts, long now) {
        if (ts <= 0L) return null;
        long secs = (now - ts) / 1000L;
        if (secs < 0) return null;
        if (secs < 90) return "just now";
        long mins = secs / 60;
        if (mins < 60) return mins + "m ago";
        long hours = mins / 60;
        if (hours < 24) return hours + "h ago";
        long days = hours / 24;
        if (days == 1) return "yesterday";
        if (days < 7) return days + " days ago";
        long weeks = days / 7;
        if (weeks < 5) return weeks == 1 ? "last week" : weeks + " weeks ago";
        return "a while ago";
    }
}

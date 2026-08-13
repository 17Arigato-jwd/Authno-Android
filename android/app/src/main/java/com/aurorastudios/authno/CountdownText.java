package com.aurorastudios.authno;

import java.util.Locale;

/**
 * The words and numbers on the countdown widget.
 *
 * Split out for the same reason ResumeText and NotesText were: it imports
 * nothing from android, so it compiles and RUNS off-device. The provider
 * around it can only be exercised on a launcher; this is arithmetic with edge
 * cases — a goal already met, a deadline that has passed, a book with no goal
 * at all — and those are worth pinning down rather than eyeballing at 03:59.
 */
final class CountdownText {

    private CountdownText() {}

    /** "1,204 / 500 words" — what is written against what was asked for. */
    static String progress(int words, int goal) {
        if (goal <= 0) return String.format(Locale.US, "%,d %s", Math.max(0, words),
                words == 1 ? "word" : "words");
        return String.format(Locale.US, "%,d / %,d words", Math.max(0, words), goal);
    }

    /**
     * How much is left to write, or that there is nothing left.
     *
     * Returns null when the goal is met, so the caller hides the line rather
     * than printing "0 words to go" at somebody who has finished.
     */
    static String remaining(int words, int goal) {
        if (goal <= 0) return null;
        int left = goal - Math.max(0, words);
        if (left <= 0) return null;
        return String.format(Locale.US, "%,d to go", left);
    }

    /**
     * The line under the clock.
     *
     * "left to extend your streak" is the honest version once a streak exists;
     * without one there is nothing to extend and saying so would be a lie
     * dressed as motivation.
     */
    static String caption(int streakDays, boolean met) {
        if (met) return "Today is counted";
        if (streakDays <= 0) return "left to start a streak";
        return "left to extend your streak";
    }

    /** The streak, said plainly. Empty when there is none — no "0 days". */
    static String streakLabel(int streakDays) {
        if (streakDays <= 0) return "";
        return streakDays == 1 ? "1 day" : streakDays + " days";
    }

    /**
     * A static fallback for API < 24, where a RemoteViews chronometer cannot
     * count down and would tick upward instead — a clock running the wrong way
     * is worse than one that does not move.
     *
     * Coarse on purpose: without a live tick, seconds would be stale the
     * moment they were drawn.
     */
    static String staticRemaining(long msLeft) {
        long total = Math.max(0L, msLeft) / 1000L;
        long h = total / 3600;
        long m = (total % 3600) / 60;
        if (h >= 1) return String.format(Locale.US, "%dh %02dm", h, m);
        if (m >= 1) return m + "m";
        return "under a minute";
    }
}

package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * ReminderText imports nothing from android, so it runs on the JVM.
 *
 * The interesting half is shouldNotify: the receiver fires with the app
 * closed, reading a progress report that may be days old, and getting that
 * wrong means either a nudge that never arrives or one that arrives on a day
 * the writer already finished.
 */
public class ReminderTextTest {

    // ── whether to fire ──────────────────────────────────────────────────────

    @Test public void goalMetTodaySilencesIt() {
        assertFalse(ReminderText.shouldNotify(true, true, "2026-08-12", "2026-08-12"));
    }

    @Test public void goalUnmetTodayFiresIt() {
        assertTrue(ReminderText.shouldNotify(true, false, "2026-08-12", "2026-08-12"));
    }

    /**
     * The one that matters. The app may not have run since Tuesday, so a
     * stored "met" from Tuesday must not silence Thursday — a reminder that
     * silently stops arriving reads as the feature being broken.
     */
    @Test public void yesterdaysReportDoesNotSilenceToday() {
        assertTrue(ReminderText.shouldNotify(true, true, "2026-08-11", "2026-08-12"));
    }

    @Test public void aMissingReportFiresRatherThanStayingQuiet() {
        assertTrue(ReminderText.shouldNotify(true, true, null, "2026-08-12"));
        assertTrue(ReminderText.shouldNotify(true, true, "", "2026-08-12"));
        assertTrue(ReminderText.shouldNotify(true, true, "2026-08-12", null));
    }

    /** With the setting off, the reminder is unconditional — that is the point of it. */
    @Test public void skipWhenMetOffAlwaysFires() {
        assertTrue(ReminderText.shouldNotify(false, true, "2026-08-12", "2026-08-12"));
        assertTrue(ReminderText.shouldNotify(false, false, null, null));
    }

    // ── the words ────────────────────────────────────────────────────────────

    @Test public void theTitleCountsDaysAndGetsThePluralRight() {
        assertEquals("Time to write", ReminderText.title(0));
        assertEquals("1 day so far", ReminderText.title(1));
        assertEquals("2 days so far", ReminderText.title(2));
        assertEquals("40 days so far", ReminderText.title(40));
    }

    /** A negative can only come from corrupted state; it must not render as "-1 days". */
    @Test public void aNegativeStreakReadsAsNoStreak() {
        assertEquals("Time to write", ReminderText.title(-3));
    }

    @Test public void theBodyNamesTheGoal() {
        assertEquals("Your goal is 300 words today.", ReminderText.body(0, 300));
        assertEquals("Write 300 words to keep the run going.", ReminderText.body(5, 300));
        assertEquals("Write 1 word to keep the run going.", ReminderText.body(5, 1));
    }

    /** A goal of zero is reachable through a corrupted book; "0 words" is not a nudge. */
    @Test public void aMissingGoalStillReadsAsEnglish() {
        assertEquals("Your goal is a few words today.", ReminderText.body(0, 0));
        assertEquals("Write a few words to keep the run going.", ReminderText.body(3, -1));
    }

    @Test public void largeNumbersAreGrouped() {
        assertEquals("1,204", ReminderText.group(1204));
        assertEquals("999", ReminderText.group(999));
        assertEquals("1,000,000", ReminderText.group(1000000));
        assertEquals("0", ReminderText.group(0));
    }

    @Test public void thePluralFollowsTheUngroupedNumber() {
        assertEquals("1 word", ReminderText.plural(1, "word"));
        assertEquals("2 words", ReminderText.plural(2, "word"));
        assertEquals("1,000 words", ReminderText.plural(1000, "word"));
    }
}

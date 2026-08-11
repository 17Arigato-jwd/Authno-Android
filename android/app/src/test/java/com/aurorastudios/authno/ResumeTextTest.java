package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The words on the Resume card.
 *
 * A widget provider is mostly glue that only means anything on a launcher, but
 * this part is ordinary logic with ordinary edge cases, and it renders on a
 * surface somebody looks at every day. ResumeText imports nothing from android
 * precisely so these can run on the JVM.
 */
public class ResumeTextTest {

    private static final long NOW  = 1_700_000_000_000L;
    private static final long SEC  = 1000L;
    private static final long MIN  = 60 * SEC;
    private static final long HOUR = 60 * MIN;
    private static final long DAY  = 24 * HOUR;

    // ── ago() ────────────────────────────────────────────────────────────────

    @Test public void noTimestampSaysNothing() {
        assertNull(ResumeText.ago(0L, NOW));
        assertNull(ResumeText.ago(-5L, NOW));
    }

    /**
     * A clock that has gone backwards — timezone change, restored backup — must
     * produce no phrase at all rather than "in -3h ago".
     */
    @Test public void aTimestampInTheFutureSaysNothing() {
        assertNull(ResumeText.ago(NOW + HOUR, NOW));
    }

    @Test public void recentReadsAsJustNow() {
        assertEquals("just now", ResumeText.ago(NOW - 10 * SEC, NOW));
        assertEquals("just now", ResumeText.ago(NOW - 89 * SEC, NOW));
    }

    @Test public void minutesAndHours() {
        assertEquals("2m ago",  ResumeText.ago(NOW - 2 * MIN, NOW));
        assertEquals("59m ago", ResumeText.ago(NOW - 59 * MIN, NOW));
        assertEquals("2h ago",  ResumeText.ago(NOW - 2 * HOUR, NOW));
        assertEquals("23h ago", ResumeText.ago(NOW - 23 * HOUR, NOW));
    }

    @Test public void daysAndWeeks() {
        assertEquals("yesterday",    ResumeText.ago(NOW - 25 * HOUR, NOW));
        assertEquals("3 days ago",   ResumeText.ago(NOW - 3 * DAY, NOW));
        assertEquals("last week",    ResumeText.ago(NOW - 8 * DAY, NOW));
        assertEquals("3 weeks ago",  ResumeText.ago(NOW - 21 * DAY, NOW));
        assertEquals("a while ago",  ResumeText.ago(NOW - 400 * DAY, NOW));
    }

    // ── meta() ───────────────────────────────────────────────────────────────

    /** "1 words" on a card somebody sees every day would look careless. */
    @Test public void singularAndPlural() {
        assertEquals("1 word",   ResumeText.meta(1, 0L, NOW));
        assertEquals("0 words",  ResumeText.meta(0, 0L, NOW));
    }

    @Test public void thousandsAreGrouped() {
        assertEquals("1,204 words", ResumeText.meta(1204, 0L, NOW));
    }

    @Test public void readsAsOneSentenceWhenBothPartsExist() {
        assertEquals("1,204 words · 2h ago", ResumeText.meta(1204, NOW - 2 * HOUR, NOW));
        assertEquals("1 word · 2h ago",      ResumeText.meta(1, NOW - 2 * HOUR, NOW));
    }

    /** Counts arrive from JSON; a negative is nonsense but must not render. */
    @Test public void negativeWordsClampRatherThanRender() {
        assertEquals("0 words", ResumeText.meta(-4, 0L, NOW));
    }

    @Test public void anUnusableTimestampLeavesJustTheCount() {
        assertEquals("50 words", ResumeText.meta(50, NOW + DAY, NOW));
    }
}

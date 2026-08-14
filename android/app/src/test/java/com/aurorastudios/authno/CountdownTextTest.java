package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class CountdownTextTest {

    @Test public void progressPairsWrittenAgainstAsked() {
        assertEquals("120 / 500 words", CountdownText.progress(120, 500));
        assertEquals("1,204 / 1,000 words", CountdownText.progress(1204, 1000));
    }

    /** A book with no goal still has a word count worth showing. */
    @Test public void progressWithoutAGoalJustCounts() {
        assertEquals("340 words", CountdownText.progress(340, 0));
        assertEquals("1 word", CountdownText.progress(1, 0));
        assertEquals("0 words", CountdownText.progress(0, 0));
    }

    @Test public void negativeWordsReadAsZero() {
        assertEquals("0 / 500 words", CountdownText.progress(-9, 500));
    }

    @Test public void remainingCountsDownToTheGoal() {
        assertEquals("380 to go", CountdownText.remaining(120, 500));
        assertEquals("1,000 to go", CountdownText.remaining(0, 1000));
    }

    /** Nothing rather than "0 to go" at somebody who has finished. */
    @Test public void remainingIsNothingOnceMet() {
        assertNull(CountdownText.remaining(500, 500));
        assertNull(CountdownText.remaining(900, 500));
        assertNull(CountdownText.remaining(10, 0));
    }

    @Test public void theCaptionTellsTheTruthAboutWhatIsAtStake() {
        assertEquals("left to extend your streak", CountdownText.caption(4, false));
        assertEquals("left to start a streak", CountdownText.caption(0, false));
        assertEquals("Today is counted", CountdownText.caption(4, true));
        assertEquals("Today is counted", CountdownText.caption(0, true));
    }

    /**
     * Past midnight the date on the phone and the day being counted are two
     * different days, and the caption is the only place that gap is explained.
     */
    @Test public void anExtendedNightSaysSo() {
        assertEquals("left — yesterday is still open", CountdownText.caption(4, false, 1));
        assertEquals("left — yesterday is still open", CountdownText.caption(0, false, 3));
        assertEquals("Yesterday is counted", CountdownText.caption(4, true, 2));
    }

    /** No extension, no special wording — the ordinary evening is the default. */
    @Test public void zeroExtensionReadsAsAnOrdinaryEvening() {
        assertEquals(CountdownText.caption(4, false), CountdownText.caption(4, false, 0));
        assertEquals(CountdownText.caption(0, true), CountdownText.caption(0, true, 0));
        assertEquals("left to extend your streak", CountdownText.caption(4, false, -1));
    }

    @Test public void theStreakLabelSaysNothingWhenThereIsNoStreak() {
        assertEquals("", CountdownText.streakLabel(0));
        assertEquals("", CountdownText.streakLabel(-2));
        assertEquals("1 day", CountdownText.streakLabel(1));
        assertEquals("12 days", CountdownText.streakLabel(12));
    }

    @Test public void theStaticFallbackIsCoarseOnPurpose() {
        assertEquals("3h 12m", CountdownText.staticRemaining(3 * 3600000L + 12 * 60000L));
        assertEquals("1h 00m", CountdownText.staticRemaining(3600000L));
        assertEquals("9m", CountdownText.staticRemaining(9 * 60000L));
        assertEquals("under a minute", CountdownText.staticRemaining(30000L));
        assertEquals("under a minute", CountdownText.staticRemaining(0L));
        assertEquals("under a minute", CountdownText.staticRemaining(-5000L));
    }
}

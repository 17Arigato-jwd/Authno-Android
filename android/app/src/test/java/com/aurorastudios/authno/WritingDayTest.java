package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Calendar;

/**
 * Which day the widgets count against.
 *
 * The decision is small and the failure is not: the streak log is keyed by
 * this string, so picking the wrong one does not draw a wrong number — it
 * looks up a day nobody wrote on and draws a live streak as broken.
 */
public class WritingDayTest {

    private static final long NOW = 1_800_000_000_000L;

    @Test public void aFreshSyncIsTrusted() {
        assertEquals("2026-08-14",
                WritingDay.pick(NOW + 60_000, "2026-08-14", NOW, "2026-08-15"));
    }

    /**
     * The heart of it: the deadline is what expires, not the key. An app that
     * has not run since Tuesday left Tuesday's answer in preferences, and
     * drawing against it on Friday would show three days of nothing.
     */
    @Test public void aDeadlineThatHasPassedIsNotTrusted() {
        assertEquals("2026-08-15",
                WritingDay.pick(NOW - 1, "2026-08-14", NOW, "2026-08-15"));
        assertEquals("2026-08-15",
                WritingDay.pick(NOW, "2026-08-14", NOW, "2026-08-15"));
    }

    @Test public void neverSyncedFallsBackToTheDevice() {
        assertEquals("2026-08-15", WritingDay.pick(0L, "", NOW, "2026-08-15"));
        assertEquals("2026-08-15", WritingDay.pick(0L, null, NOW, "2026-08-15"));
    }

    /**
     * A key of the wrong shape would match no log entry at all, which reads as
     * "you have never written" rather than as the error it is.
     */
    @Test public void aMalformedKeyIsRefused() {
        assertEquals("2026-08-15",
                WritingDay.pick(NOW + 60_000, "yesterday", NOW, "2026-08-15"));
        assertEquals("2026-08-15",
                WritingDay.pick(NOW + 60_000, "2026-8-14", NOW, "2026-08-15"));
        assertEquals("2026-08-15",
                WritingDay.pick(NOW + 60_000, "", NOW, "2026-08-15"));
    }

    @Test public void datesArePaddedTheWayTheLogIsKeyed() {
        assertEquals("2026-01-05", WritingDay.dateKey(2026, 0, 5));
        assertEquals("2026-12-31", WritingDay.dateKey(2026, 11, 31));
    }

    @Test public void deviceTodayMatchesTheDeviceCalendar() {
        Calendar c = Calendar.getInstance();
        assertEquals(WritingDay.dateKey(c.get(Calendar.YEAR), c.get(Calendar.MONTH),
                c.get(Calendar.DAY_OF_MONTH)), WritingDay.deviceToday());
    }

    @Test public void aKeyBecomesMidnightOnThatDate() {
        Calendar c = WritingDay.toCalendar("2026-08-14");
        assertEquals(2026, c.get(Calendar.YEAR));
        assertEquals(Calendar.AUGUST, c.get(Calendar.MONTH));
        assertEquals(14, c.get(Calendar.DAY_OF_MONTH));
        assertEquals(0, c.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, c.get(Calendar.MINUTE));
        assertEquals(0, c.get(Calendar.MILLISECOND));
    }

    /** Walking back from the parsed day has to cross month and year ends. */
    @Test public void theCalendarWalksBackwardsProperly() {
        Calendar c = WritingDay.toCalendar("2026-01-01");
        c.add(Calendar.DAY_OF_YEAR, -1);
        assertEquals(WritingDay.dateKey(c.get(Calendar.YEAR), c.get(Calendar.MONTH),
                c.get(Calendar.DAY_OF_MONTH)), "2025-12-31");
    }

    @Test public void unparseableKeysGiveTodayRatherThanThrowing() {
        Calendar c = WritingDay.toCalendar("not a date");
        assertEquals(WritingDay.dateKey(c.get(Calendar.YEAR), c.get(Calendar.MONTH),
                c.get(Calendar.DAY_OF_MONTH)), WritingDay.deviceToday());
    }
}

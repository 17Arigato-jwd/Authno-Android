package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/**
 * Reading the reminder configuration that crossed the bridge.
 *
 * Everything here is parsing, and every failure is silent: a slot that does
 * not parse is a reminder that never fires, while still showing as switched on
 * in Settings. Nobody reports that as a bug — they just stop trusting it.
 */
public class ReminderSlotsTest {

    @Test public void oneSlot() {
        List<ReminderSlots.Slot> s = ReminderSlots.parse("[{\"hour\":20,\"minute\":0,\"slot\":\"evening\"}]");
        assertEquals(1, s.size());
        assertEquals(20, s.get(0).hour);
        assertEquals(0, s.get(0).minute);
        assertEquals("evening", s.get(0).name);
    }

    @Test public void twoSlotsInTheOrderTheyWereSent() {
        List<ReminderSlots.Slot> s = ReminderSlots.parse(
                "[{\"hour\":9,\"minute\":30,\"slot\":\"morning\"},{\"hour\":20,\"minute\":15,\"slot\":\"evening\"}]");
        assertEquals(2, s.size());
        assertEquals(9, s.get(0).hour);
        assertEquals(30, s.get(0).minute);
        assertEquals("morning", s.get(0).name);
        assertEquals(20, s.get(1).hour);
        assertEquals(15, s.get(1).minute);
    }

    @Test public void whitespaceAndKeyOrderDoNotMatter() {
        List<ReminderSlots.Slot> s = ReminderSlots.parse(
                "[ { \"slot\" : \"morning\" , \"minute\" : 5 , \"hour\" : 7 } ]");
        assertEquals(1, s.size());
        assertEquals(7, s.get(0).hour);
        assertEquals(5, s.get(0).minute);
        assertEquals("morning", s.get(0).name);
    }

    /**
     * Empty is the signal to fall back to the single stored hour and minute.
     * It must therefore be reachable from every kind of nonsense, and never
     * from a valid payload.
     */
    @Test public void nonsenseParsesToNothingRatherThanGuessing() {
        assertTrue(ReminderSlots.parse(null).isEmpty());
        assertTrue(ReminderSlots.parse("").isEmpty());
        assertTrue(ReminderSlots.parse("[]").isEmpty());
        assertTrue(ReminderSlots.parse("not json at all").isEmpty());
        assertTrue(ReminderSlots.parse("{").isEmpty());
    }

    /** An hour of 24 or -1 would arm an alarm at a time that does not exist. */
    @Test public void outOfRangeTimesAreDropped() {
        assertTrue(ReminderSlots.parse("[{\"hour\":24,\"minute\":0}]").isEmpty());
        assertTrue(ReminderSlots.parse("[{\"hour\":-1,\"minute\":0}]").isEmpty());
        assertTrue(ReminderSlots.parse("[{\"hour\":9,\"minute\":60}]").isEmpty());
        assertTrue(ReminderSlots.parse("[{\"minute\":30}]").isEmpty());
    }

    /** A valid slot beside a broken one still arms. */
    @Test public void oneBadSlotDoesNotTakeTheOthersWithIt() {
        List<ReminderSlots.Slot> s = ReminderSlots.parse(
                "[{\"hour\":99,\"minute\":0,\"slot\":\"morning\"},{\"hour\":20,\"minute\":0,\"slot\":\"evening\"}]");
        assertEquals(1, s.size());
        assertEquals(20, s.get(0).hour);
    }

    /** The request codes only reserve MAX of them; more would go unarmed and uncancelled. */
    @Test public void neverMoreThanTheAlarmSlotsReserved() {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < 12; i++) {
            if (i > 0) json.append(',');
            json.append("{\"hour\":").append(i).append(",\"minute\":0,\"slot\":\"morning\"}");
        }
        json.append(']');
        assertEquals(ReminderSlots.MAX, ReminderSlots.parse(json.toString()).size());
    }

    @Test public void anUnnamedSlotIsTreatedAsEvening() {
        List<ReminderSlots.Slot> s = ReminderSlots.parse("[{\"hour\":13,\"minute\":0}]");
        assertEquals("evening", s.get(0).name);
    }

    // ── The words ─────────────────────────────────────────────────────────────

    private static final String LINES =
            "{\"morning\":{\"title\":\"Day 4\",\"body\":\"500 words in The Long Novel.\"},"
          + "\"evening\":{\"title\":\"Still time\",\"body\":\"380 to go.\"}}";

    @Test public void theLineForASlot() {
        String[] m = ReminderSlots.lineFor(LINES, "morning");
        assertNotNull(m);
        assertEquals("Day 4", m[0]);
        assertEquals("500 words in The Long Novel.", m[1]);

        String[] e = ReminderSlots.lineFor(LINES, "evening");
        assertNotNull(e);
        assertEquals("Still time", e[0]);
    }

    /**
     * Null means "use ReminderText". An empty pair would post a notification
     * with no words in it, which is worse than the generic wording.
     */
    @Test public void anythingMissingIsNullSoTheFallbackRuns() {
        assertNull(ReminderSlots.lineFor(LINES, "afternoon"));
        assertNull(ReminderSlots.lineFor(LINES, null));
        assertNull(ReminderSlots.lineFor(null, "morning"));
        assertNull(ReminderSlots.lineFor("", "morning"));
        assertNull(ReminderSlots.lineFor("{\"morning\":{\"title\":\"\",\"body\":\"x\"}}", "morning"));
        assertNull(ReminderSlots.lineFor("{\"morning\":{\"title\":\"x\"}}", "morning"));
        assertNull(ReminderSlots.lineFor("garbage", "morning"));
    }

    /**
     * The copy is full of apostrophes and em dashes, and JSON.stringify escapes
     * quotes and non-ASCII the moment either appears. Getting this wrong would
     * truncate somebody's notification mid-sentence.
     */
    @Test public void escapesSurviveTheTrip() {
        String json = "{\"evening\":{\"title\":\"A \\\"quiet\\\" night\",\"body\":\"Line one\\nline two\"}}";
        String[] e = ReminderSlots.lineFor(json, "evening");
        assertNotNull(e);
        assertEquals("A \"quiet\" night", e[0]);
        assertEquals("Line one\nline two", e[1]);
    }

    @Test public void unicodeEscapesDecode() {
        String json = "{\"morning\":{\"title\":\"Day 4 \\u2014 keep going\",\"body\":\"ok\"}}";
        assertEquals("Day 4 — keep going", ReminderSlots.lineFor(json, "morning")[0]);
    }
}

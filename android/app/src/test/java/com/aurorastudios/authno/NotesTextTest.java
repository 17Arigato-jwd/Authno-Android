package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The words on the Notes widget.
 *
 * Same reasoning as ResumeTextTest: the provider around this can only be
 * exercised on a launcher, and no native code in this project has ever run on
 * hardware. NotesText imports nothing from android so the parts that are
 * ordinary logic can be checked here rather than eyeballed on a device.
 */
public class NotesTextTest {

    private static final long NOW  = 1_700_000_000_000L;
    private static final long MIN  = 60 * 1000L;
    private static final long HOUR = 60 * MIN;

    // ── title() ──────────────────────────────────────────────────────────────

    @Test public void aRealTitleIsLeftAlone() {
        assertEquals("Idea for chapter 4", NotesText.title("Idea for chapter 4"));
    }

    @Test public void whitespaceIsTrimmed() {
        assertEquals("Idea", NotesText.title("  Idea \n"));
    }

    /**
     * The JS payload already answers "Empty note" for a note with no text, but
     * that is across a JSON bridge and a SharedPreferences round-trip. A row
     * with nothing in it reads as a broken widget, not as an empty note.
     */
    @Test public void nothingBecomesTheEmptyNoteLabel() {
        assertEquals("Empty note", NotesText.title(null));
        assertEquals("Empty note", NotesText.title(""));
        assertEquals("Empty note", NotesText.title("   \n\t "));
    }

    // ── secondary() ──────────────────────────────────────────────────────────

    @Test public void aPreviewWins() {
        assertEquals("the rest of it", NotesText.secondary("the rest of it", NOW - HOUR, NOW));
    }

    @Test public void previewWhitespaceIsTrimmed() {
        assertEquals("the rest", NotesText.secondary("  the rest  ", NOW - HOUR, NOW));
    }

    /**
     * A one-line note is the common case — it is what quick capture is for —
     * so the row falls back to the time. Every row stays two lines tall and
     * the list does not jump around as notes are added.
     */
    @Test public void aOneLineNoteShowsWhenInstead() {
        assertEquals("2h ago", NotesText.secondary("", NOW - 2 * HOUR, NOW));
        assertEquals("2h ago", NotesText.secondary(null, NOW - 2 * HOUR, NOW));
        assertEquals("2h ago", NotesText.secondary("   ", NOW - 2 * HOUR, NOW));
    }

    /**
     * Never null. RemoteViews.setTextViewText(null) throws, and it would throw
     * on the launcher, in a process with no console, for the one writer whose
     * note has no preview and no usable timestamp.
     */
    @Test public void nothingAtAllIsStillAString() {
        assertEquals("", NotesText.secondary(null, 0L, NOW));
        assertEquals("", NotesText.secondary("", -1L, NOW));
        // A clock that has gone backwards, which ago() refuses to phrase.
        assertEquals("", NotesText.secondary(null, NOW + HOUR, NOW));
    }

    // ── countLabel() ─────────────────────────────────────────────────────────

    @Test public void oneNoteIsSingular() {
        assertEquals("1 note", NotesText.countLabel(1));
    }

    @Test public void manyNotesArePlural() {
        assertEquals("4 notes", NotesText.countLabel(4));
    }

    @Test public void anEmptyStoreSaysSo() {
        assertEquals("No notes yet", NotesText.countLabel(0));
        assertEquals("No notes yet", NotesText.countLabel(-1));
    }

    // ── moreLabel() ──────────────────────────────────────────────────────────

    /**
     * The count in the header is the whole store, so a writer with thirty
     * notes is never told they have four. This is the other half: saying that
     * the rows on screen are not all of them.
     */
    @Test public void moreThanFitsIsCounted() {
        assertEquals("+26 more", NotesText.moreLabel(30, 4));
    }

    @Test public void everythingOnScreenSaysNothing() {
        assertNull(NotesText.moreLabel(4, 4));
        assertNull(NotesText.moreLabel(2, 4));
        assertNull(NotesText.moreLabel(0, 0));
    }
}

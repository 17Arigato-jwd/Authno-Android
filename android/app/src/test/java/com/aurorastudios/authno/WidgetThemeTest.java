package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * WidgetTheme imports nothing from android, so it runs on the JVM.
 *
 * Worth pinning because it is the difference between a widget that matches the
 * app and one that renders somebody's Sepia theme as plain Dark — and because
 * everything it parses comes from JSON crossing a bridge, where a missing field
 * is not a hypothetical.
 */
public class WidgetThemeTest {

    // ── colour parsing ───────────────────────────────────────────────────────

    @Test public void sixDigitHex() {
        assertEquals(0xFF1A1B1E, WidgetTheme.color("#1a1b1e", 0));
        assertEquals(0xFFFFFFFF, WidgetTheme.color("#ffffff", 0));
    }

    @Test public void threeDigitHexExpands() {
        assertEquals(0xFFFFFFFF, WidgetTheme.color("#fff", 0));
        assertEquals(0xFF000000, WidgetTheme.color("#000", 0));
        assertEquals(0xFF112233, WidgetTheme.color("#123", 0));
    }

    @Test public void eightDigitHexKeepsItsAlpha() {
        assertEquals(0x80112233, WidgetTheme.color("#80112233", 0));
    }

    @Test public void whitespaceIsTolerated() {
        assertEquals(0xFF1A1B1E, WidgetTheme.color("  #1a1b1e  ", 0));
    }

    /**
     * The design system writes translucent surfaces as rgba(...). Those are
     * deliberately not parsed: a widget sits on an unknown wallpaper, so a
     * half-transparent card is worse than the fallback.
     */
    @Test public void rgbaFallsBackRatherThanRenderingTransparent() {
        assertEquals(0xFF123456, WidgetTheme.color("rgba(255,255,255,0.05)", 0xFF123456));
    }

    @Test public void junkFallsBack() {
        int fb = 0xFF123456;
        assertEquals(fb, WidgetTheme.color(null, fb));
        assertEquals(fb, WidgetTheme.color("", fb));
        assertEquals(fb, WidgetTheme.color("#", fb));
        assertEquals(fb, WidgetTheme.color("#12", fb));
        assertEquals(fb, WidgetTheme.color("#zzzzzz", fb));
        assertEquals(fb, WidgetTheme.color("1a1b1e", fb));   // no hash
    }

    // ── payload parsing ──────────────────────────────────────────────────────

    @Test public void aFullPayloadIsUsed() {
        WidgetTheme t = WidgetTheme.parse(
                "{\"bgColor\":\"#f4ecd8\",\"textPrimary\":\"#3b2f2f\","
                        + "\"textSecondary\":\"#5b4636\",\"textDim\":\"#8a7968\","
                        + "\"isDark\":false,\"themeId\":\"sepia\"}", true);
        assertEquals(0xFFF4ECD8, t.bg);
        assertEquals(0xFF3B2F2F, t.textPrimary);
        assertEquals(0xFF8A7968, t.textDim);
        assertFalse(t.isDark);
    }

    /** A widget placed before the app has ever synced must still render. */
    @Test public void noPayloadFallsBackToTheHint() {
        assertTrue(WidgetTheme.parse("", true).isDark);
        assertFalse(WidgetTheme.parse("", false).isDark);
        assertTrue(WidgetTheme.parse(null, true).isDark);
    }

    @Test public void malformedJsonFallsBackRatherThanThrowing() {
        WidgetTheme t = WidgetTheme.parse("{not json at all", true);
        assertTrue(t.isDark);
        assertEquals(WidgetTheme.fallback(true).bg, t.bg);
    }

    /**
     * A payload from a newer app version might omit a field this build reads.
     * Each one falls back on its own rather than losing the whole theme.
     */
    @Test public void aMissingFieldFallsBackOnItsOwn() {
        WidgetTheme t = WidgetTheme.parse("{\"bgColor\":\"#ffffff\",\"isDark\":false}", true);
        assertEquals(0xFFFFFFFF, t.bg);
        assertEquals(WidgetTheme.fallback(false).textPrimary, t.textPrimary);
        assertFalse(t.isDark);
    }

    /** The lightness in the payload wins over the older boolean. */
    @Test public void payloadLightnessOverridesTheHint() {
        assertFalse(WidgetTheme.parse("{\"isDark\":false}", true).isDark);
        assertTrue(WidgetTheme.parse("{\"isDark\":true}", false).isDark);
    }

    @Test public void fallbacksAreOpaque() {
        // A widget on an unknown wallpaper must not be see-through.
        assertEquals(0xFF000000, WidgetTheme.fallback(true).bg & 0xFF000000);
        assertEquals(0xFF000000, WidgetTheme.fallback(false).bg & 0xFF000000);
    }

    /**
     * StreakWidgetRenderer draws its calendar straight from these, so a role
     * left at 0 would paint transparent day numbers rather than fall back.
     */
    @Test public void everyCalendarRoleIsSet() {
        for (boolean dark : new boolean[]{true, false}) {
            WidgetTheme t = WidgetTheme.fallback(dark);
            for (int c : new int[]{t.bg, t.textPrimary, t.textSecondary, t.textDim,
                                   t.textFaint, t.textHasData, t.progressTrack,
                                   t.surface, t.surfaceRaised, t.border}) {
                assertEquals("opaque", 0xFF000000, c & 0xFF000000);
            }
        }
    }

    /** The config screen paints rows on these, so they must differ from the sheet. */
    @Test public void aRaisedSurfaceIsDistinctFromTheBackground() {
        for (boolean dark : new boolean[]{true, false}) {
            WidgetTheme t = WidgetTheme.fallback(dark);
            assertNotEquals(t.bg, t.surface);
            assertNotEquals(t.surface, t.surfaceRaised);
        }
    }

    @Test public void theCalendarRolesComeFromThePayload() {
        WidgetTheme t = WidgetTheme.parse(
                "{\"textFaint\":\"#111111\",\"textHasData\":\"#222222\","
                        + "\"progressTrack\":\"#333333\",\"isDark\":true}", true);
        assertEquals(0xFF111111, t.textFaint);
        assertEquals(0xFF222222, t.textHasData);
        assertEquals(0xFF333333, t.progressTrack);
    }

    /**
     * The design system's surface tokens are rgba(...) overlays. The progress
     * track has to be a solid colour for the same reason the card does, so the
     * app resolves it before sending; if it ever regresses to rgba the widget
     * must land on the fallback rather than draw nothing.
     */
    @Test public void anRgbaProgressTrackFallsBackToSolid() {
        WidgetTheme t = WidgetTheme.parse(
                "{\"progressTrack\":\"rgba(255,255,255,0.08)\",\"isDark\":true}", true);
        assertEquals(WidgetTheme.fallback(true).progressTrack, t.progressTrack);
    }

    // ── readableOn ───────────────────────────────────────────────────────────
    // The accent is the writer's own colour and every hue is allowed, so the
    // label on an accent-filled button cannot be hardcoded to white.

    @Test public void aDarkAccentTakesWhiteText() {
        assertEquals(0xFFFFFFFF, WidgetTheme.readableOn(0xFF5A00D9)); // the default violet
        assertEquals(0xFFFFFFFF, WidgetTheme.readableOn(0xFF000000));
        assertEquals(0xFFFFFFFF, WidgetTheme.readableOn(0xFF1A1B1E));
    }

    @Test public void aLightAccentTakesBlackText() {
        assertEquals(0xFF000000, WidgetTheme.readableOn(0xFFFFFFFF));
        assertEquals(0xFF000000, WidgetTheme.readableOn(0xFFFFC107)); // amber
        assertEquals(0xFF000000, WidgetTheme.readableOn(0xFF7FFF7F)); // pale green
    }

    /** Green dominates perceived luminance; blue barely registers. */
    @Test public void itWeighsChannelsPerceptually() {
        assertEquals(0xFF000000, WidgetTheme.readableOn(0xFF00FF00));
        assertEquals(0xFFFFFFFF, WidgetTheme.readableOn(0xFF0000FF));
    }

    /** Alpha in the accent must not be mistaken for a colour channel. */
    @Test public void alphaIsIgnored() {
        assertEquals(WidgetTheme.readableOn(0xFFFFFFFF), WidgetTheme.readableOn(0x00FFFFFF));
    }
}

package com.aurorastudios.authno;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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
}

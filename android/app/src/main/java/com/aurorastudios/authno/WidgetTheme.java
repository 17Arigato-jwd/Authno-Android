package com.aurorastudios.authno;

import org.json.JSONObject;

/**
 * The active app theme, as far as a widget needs it.
 *
 * Built by src/theme/ThemeBase.js › buildWidgetTheme and carried across as
 * JSON. Before this the widgets received a single boolean — "is the app
 * dark?" — which is why Sepia, Paper, OLED and Material You all rendered as
 * plain Dark: three of the six themes had no way to express themselves.
 *
 * Imports nothing from android, so it runs on the JVM and can be tested.
 * Everything here is a colour int or a flag; the drawing happens elsewhere.
 */
final class WidgetTheme {

    final int bg;
    final int textPrimary;
    final int textSecondary;
    final int textDim;
    final int textFaint;
    final int textHasData;
    final int progressTrack;
    /** A raised row on {@link #bg}, and the box that sits inside one. */
    final int surface;
    final int surfaceRaised;
    final int border;
    final boolean isDark;

    private WidgetTheme(int bg, int textPrimary, int textSecondary, int textDim,
                        int textFaint, int textHasData, int progressTrack,
                        int surface, int surfaceRaised, int border, boolean isDark) {
        this.bg = bg;
        this.textPrimary = textPrimary;
        this.textSecondary = textSecondary;
        this.textDim = textDim;
        this.textFaint = textFaint;
        this.textHasData = textHasData;
        this.progressTrack = progressTrack;
        this.surface = surface;
        this.surfaceRaised = surfaceRaised;
        this.border = border;
        this.isDark = isDark;
    }

    /** The design-system defaults, for a widget placed before any sync. */
    static WidgetTheme fallback(boolean isDark) {
        return isDark
                ? new WidgetTheme(0xFF1A1B1E, 0xFFFFFFFF, 0xFFDCDDDE, 0xFF72767D,
                                  0xFF4F545C, 0xFFB9BBBE, 0xFF2B2D31,
                                  0xFF1F2023, 0xFF25262A, 0xFF303135, true)
                : new WidgetTheme(0xFFFFFFFF, 0xFF111113, 0xFF2B2D31, 0xFF6B6F76,
                                  0xFFA3A7AD, 0xFF4D5156, 0xFFD7D9DD,
                                  0xFFF7F7F8, 0xFFF0F0F1, 0xFFE6E6E7, false);
    }

    /**
     * Parse what the app sent. Any missing or malformed field falls back rather
     * than throwing: a widget that renders in the wrong colours is a blemish,
     * one that fails to render is a hole on somebody's home screen.
     */
    static WidgetTheme parse(String json, boolean isDarkHint) {
        WidgetTheme fb = fallback(isDarkHint);
        if (json == null || json.trim().isEmpty()) return fb;
        try {
            JSONObject o = new JSONObject(json);
            boolean dark = o.optBoolean("isDark", isDarkHint);
            WidgetTheme base = fallback(dark);
            return new WidgetTheme(
                    color(o.optString("bgColor", null), base.bg),
                    color(o.optString("textPrimary", null), base.textPrimary),
                    color(o.optString("textSecondary", null), base.textSecondary),
                    color(o.optString("textDim", null), base.textDim),
                    color(o.optString("textFaint", null), base.textFaint),
                    color(o.optString("textHasData", null), base.textHasData),
                    color(o.optString("progressTrack", null), base.progressTrack),
                    color(o.optString("surface", null), base.surface),
                    color(o.optString("surfaceRaised", null), base.surfaceRaised),
                    color(o.optString("border", null), base.border),
                    dark);
        } catch (Exception ignored) {
            return fb;
        }
    }

    /**
     * Black or white, whichever can actually be read on {@code background}.
     *
     * The accent is the writer's own colour and every hue is allowed, so a
     * label hardcoded to white disappears the moment somebody picks amber or
     * pale green. WCAG relative luminance, with the 0.179 threshold that
     * maximises the worse of the two contrast ratios.
     */
    static int readableOn(int background) {
        double r = channel((background >> 16) & 0xFF);
        double g = channel((background >> 8) & 0xFF);
        double b = channel(background & 0xFF);
        double l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return l > 0.179 ? 0xFF000000 : 0xFFFFFFFF;
    }

    private static double channel(int v) {
        double c = v / 255.0;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    /**
     * #rgb, #rrggbb and #aarrggbb. A theme colour can also arrive as an
     * rgba(...) string — the design system uses those for translucent surfaces
     * — and those are deliberately NOT parsed here: a widget surface has to be
     * opaque to sit on an unknown wallpaper, so the fallback is the right
     * answer rather than a half-transparent card.
     */
    static int color(String hex, int fallback) {
        if (hex == null) return fallback;
        String s = hex.trim();
        if (s.isEmpty() || s.charAt(0) != '#') return fallback;
        s = s.substring(1);
        try {
            if (s.length() == 3) {
                int r = Integer.parseInt(s.substring(0, 1), 16);
                int g = Integer.parseInt(s.substring(1, 2), 16);
                int b = Integer.parseInt(s.substring(2, 3), 16);
                return 0xFF000000 | (r * 17) << 16 | (g * 17) << 8 | (b * 17);
            }
            if (s.length() == 6) return 0xFF000000 | (int) Long.parseLong(s, 16);
            if (s.length() == 8) return (int) Long.parseLong(s, 16);
        } catch (Exception ignored) { /* fall through */ }
        return fallback;
    }
}

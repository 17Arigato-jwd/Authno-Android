package com.aurorastudios.authno;

import android.graphics.Color;

/**
 * DSTokens.java — Authno Design Tokens (Android mirror)
 * ─────────────────────────────────────────────────────────────────────────────
 * Java mirror of src/DesignSystem/tokens.js.
 * Keep both files in sync — every constant here maps 1-to-1 with a token.
 *
 * Naming convention:
 *   tokens.js           → DSTokens.java
 *   COLORS.violet       → DSTokens.COLORS.VIOLET
 *   COLORS.surface2     → DSTokens.COLORS.SURFACE_2
 *   SPACING.md          → DSTokens.SPACING.MD
 *   TYPOGRAPHY.size.sm  → DSTokens.TYPOGRAPHY.SIZE_SM
 *   RADIUS.xl           → DSTokens.RADIUS.XL
 *
 * All color constants are pre-parsed Android int values.
 * All size constants are dp/sp — multiply by display density where needed.
 */
public final class DSTokens {

    private DSTokens() {} // static-only utility class

    // ── Colors ────────────────────────────────────────────────────────────────
    public static final class COLORS {
        // Brand
        public static final int VIOLET       = Color.parseColor("#8b5cf6");
        public static final int VIOLET_DARK  = Color.parseColor("#5a00d9");
        public static final int INDIGO       = Color.parseColor("#6366f1");
        public static final int SKY          = Color.parseColor("#38bdf8");
        // Semantic
        public static final int SUCCESS      = Color.parseColor("#22c55e");
        public static final int WARNING      = Color.parseColor("#f59e0b");
        public static final int DANGER       = Color.parseColor("#ef4444");
        public static final int ROSE         = Color.parseColor("#ec4899");
        public static final int EMBER        = Color.parseColor("#f97316");
        // Surfaces (dark-first)
        public static final int SURFACE_0    = Color.parseColor("#0b0b0c");
        public static final int SURFACE_1    = Color.parseColor("#111113");
        public static final int SURFACE_2    = Color.parseColor("#1a1b1e");
        public static final int SURFACE_3    = Color.parseColor("#2b2d31");
        public static final int SURFACE_4    = Color.parseColor("#313338");
        // Text
        public static final int TEXT_PRIMARY   = Color.parseColor("#ffffff");
        public static final int TEXT_SECONDARY = Color.parseColor("#dcddde");
        public static final int TEXT_MUTED     = Color.parseColor("#b9bbbe");
        public static final int TEXT_SUBTLE    = Color.parseColor("#72767d");
        public static final int TEXT_DISABLED  = Color.parseColor("#4f545c");
    }

    // ── Radius (dp) ──────────────────────────────────────────────────────────
    public static final class RADIUS {
        public static final int NONE = 0;
        public static final int SM   = 6;
        public static final int MD   = 10;
        public static final int LG   = 14;
        public static final int XL   = 20;
        public static final int FULL = 9999;
    }

    // ── Spacing (dp) ─────────────────────────────────────────────────────────
    public static final class SPACING {
        public static final int XS   = 4;
        public static final int SM   = 8;
        public static final int MD   = 12;
        public static final int LG   = 16;
        public static final int XL   = 24;
        public static final int XXL  = 32;
        public static final int XXXL = 48;
    }

    // ── Typography sizes (sp) ─────────────────────────────────────────────────
    public static final class TYPOGRAPHY {
        public static final int SIZE_XS   = 9;
        public static final int SIZE_SM   = 11;
        public static final int SIZE_BASE = 13;
        public static final int SIZE_MD   = 15;
        public static final int SIZE_LG   = 18;
        public static final int SIZE_XL   = 22;
        public static final int SIZE_XXL  = 28;
        public static final int SIZE_HERO = 36;
    }

    // ── Widget helpers ────────────────────────────────────────────────────────
    /** Default brand accent used when no user accent is stored. */
    public static final int DEFAULT_ACCENT = COLORS.VIOLET_DARK;

    /**
     * Widget card background: surface_2 at 90 % opacity.
     * Matches the #E6 alpha used in widget_background.xml.
     */
    public static final int WIDGET_BG = Color.argb(
            0xE6,
            Color.red(COLORS.SURFACE_2),
            Color.green(COLORS.SURFACE_2),
            Color.blue(COLORS.SURFACE_2));

    // ── Colour utilities ──────────────────────────────────────────────────────

    /** Replace the alpha channel of {@code color} with {@code alpha} (0–255). */
    public static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }

    /**
     * Parse a CSS hex string, returning {@code fallback} on any error.
     * Handles both #RRGGBB and #AARRGGBB.
     */
    public static int parseColor(String hex, int fallback) {
        try { return Color.parseColor(hex); }
        catch (Exception ignored) { return fallback; }
    }
}

package com.aurorastudios.authno;

import android.appwidget.AppWidgetManager;
import android.os.Bundle;

/**
 * WidgetSize.java — how big this widget is, right now.
 *
 * A RemoteViews layout cannot respond to its own size. It is built in this
 * process and laid out in the launcher's, nothing measures on this side, and
 * there is no `onMeasure` to override. What a vertical LinearLayout does when
 * its children do not fit is allocate top-down and give the last ones whatever
 * is left — usually nothing — so content does not compress, it falls off the
 * bottom, silently, and the user sees a widget with its button missing.
 *
 * The only measurement available on this side is the options bundle the
 * launcher writes: OPTION_APPWIDGET_MIN_WIDTH and friends, in dp. It is the
 * size the launcher has actually given this widget in its current layout, and
 * it is authoritative in a way nothing else here is — a widget the user
 * dragged has a size that no manifest, layout or default knows about.
 *
 * Providers use this to decide what to SHOW rather than to lay anything out:
 * hide a row that will not fit, draw a bitmap at the size of the space it
 * lands in, pick how many list rows there is room for. That is the whole
 * technique, and it is the only one available.
 *
 * ── The two dimensions ──────────────────────────────────────────────────────
 *
 * The launcher reports four numbers, not two: MIN_WIDTH/MAX_HEIGHT describe
 * the portrait shape and MAX_WIDTH/MIN_HEIGHT the landscape one, because a
 * home screen that rotates gives the same widget two different boxes and
 * cannot re-ask the provider mid-rotation. A layout has to work in both.
 *
 * So `height` is the SMALLER of the two heights and `width` the smaller of the
 * two widths. Choosing what fits the roomier orientation means choosing wrong
 * for the other one, and being wrong by hiding something is recoverable
 * (rotate back) while being wrong by overflowing is not (the user cannot see
 * what was dropped).
 */
final class WidgetSize {

    /** dp. Always positive — see the fallbacks in {@link #of}. */
    final int width;
    final int height;

    /** True when the numbers are the launcher's, false when they are guesses. */
    final boolean measured;

    private WidgetSize(int width, int height, boolean measured) {
        this.width = width;
        this.height = height;
        this.measured = measured;
    }

    /**
     * Read the current size, or fall back to something conservative.
     *
     * There are three ways to get no options: a launcher that does not write
     * them, a widget mid-placement whose bundle is not filled in yet, and a
     * manager call that throws because the widget id is stale. All three are
     * treated the same way and all three are normal.
     *
     * The fallback is the widget's own declared minimum from its
     * appwidget-provider, passed in by the caller. That is the smallest the
     * widget is ever allowed to be, so deciding as if it were that size shows
     * the least — which is the safe direction to be wrong in.
     */
    static WidgetSize of(AppWidgetManager mgr, int widgetId, int fallbackW, int fallbackH) {
        Bundle opts = null;
        try {
            opts = mgr.getAppWidgetOptions(widgetId);
        } catch (Exception ignored) {
            // A stale id, or a manager that has already forgotten this widget.
        }
        if (opts == null) return new WidgetSize(fallbackW, fallbackH, false);

        int minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int maxW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
        int minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int maxH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);

        // Any one of the four can be zero on a launcher that fills in some and
        // not others, so each is taken only if it is real.
        int w = smallestPositive(minW, maxW);
        int h = smallestPositive(minH, maxH);
        if (w <= 0 || h <= 0) return new WidgetSize(fallbackW, fallbackH, false);
        return new WidgetSize(w, h, true);
    }

    private static int smallestPositive(int a, int b) {
        if (a > 0 && b > 0) return Math.min(a, b);
        return Math.max(a, b);   // one of them, or 0 if neither
    }

    /**
     * How many rows of {@code rowDp} fit below {@code chromeDp} of fixed content.
     *
     * Clamped to at least one: a widget showing nothing looks broken in a way
     * a widget showing one thing does not, and the user can always make it
     * bigger.
     */
    int rowsFor(int chromeDp, int rowDp, int max) {
        if (rowDp <= 0) return max;
        int fits = (height - chromeDp) / rowDp;
        if (fits < 1) fits = 1;
        return Math.min(fits, max);
    }

    /** Is there room for {@code needDp} of content on top of {@code chromeDp}? */
    boolean roomFor(int chromeDp, int needDp) {
        return height - chromeDp >= needDp;
    }

    @Override public String toString() {
        return width + "x" + height + "dp" + (measured ? "" : " (assumed)");
    }
}

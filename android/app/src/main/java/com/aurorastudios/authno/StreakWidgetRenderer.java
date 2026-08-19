package com.aurorastudios.authno;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.widget.RemoteViews;

import org.json.JSONObject;
import org.json.JSONArray;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Stateless helper that reads a book's streak data and populates a
 * RemoteViews for the home-screen widget. All calendar drawing is done
 * on a Bitmap using Canvas so we are not limited by RemoteViews' restricted
 * view set.
 *
 * All colours come from {@link DSTokens} — the single source of truth that
 * mirrors {@code src/DesignSystem/tokens.js}.  Never hardcode colour
 * literals here; add a constant to DSTokens instead.
 */
public class StreakWidgetRenderer {

    // ── Theme palette ─────────────────────────────────────────────────────────
    // This used to hold its own DARK/LIGHT Palette pair, which was a bug once
    // the provider started painting from the real app theme: the provider set
    // themed colours on widget_title, widget_streak_label and
    // widget_progress_label, then called populate(), which wrote over all three
    // from the hardcoded pair. The renderer runs last, so the theme only
    // survived on the "no book linked" branch — i.e. never, in normal use.
    //
    // WidgetTheme carries exactly the six roles the Palette did (plus bg), so
    // it is now the palette. Its fallback() pair holds the same values the
    // constants here did, which also means one place to change them.

    private static final String[] DAY_HEADERS = {"M", "T", "W", "T", "F", "S", "S"};

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Fills every field of the widget RemoteViews from the given book JSON object.
     *
     * @param ctx       Android context
     * @param views     The RemoteViews instance for this widget
     * @param book      JSONObject with at least { id, title, streak: { log, goalWords } }
     * @param accentHex e.g. "#5a00d9" — falls back to DSTokens.DEFAULT_ACCENT
     */
    public static void populate(Context ctx, RemoteViews views,
                                JSONObject book, String accentHex) {
        populate(ctx, views, book, accentHex, WidgetTheme.fallback(true));
    }

    /** Kept for callers that only know the app's lightness, not its theme. */
    public static void populate(Context ctx, RemoteViews views,
                                JSONObject book, String accentHex, boolean isDark) {
        populate(ctx, views, book, accentHex, WidgetTheme.fallback(isDark));
    }

    public static void populate(Context ctx, RemoteViews views,
                                JSONObject book, String accentHex, WidgetTheme pal) {
        if (pal == null) pal = WidgetTheme.fallback(true);
        int accent = DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT);

        try {
            String title      = book.optString("title", "Untitled Book");
            JSONObject streak = book.optJSONObject("streak");
            int goalWords     = streak != null ? streak.optInt("goalWords", 300) : 300;
            JSONObject rawLog = streak != null ? streak.optJSONObject("log") : null;

            Map<String, int[]> log = parseLog(rawLog, goalWords);

            // The day being counted, not the date on the device. They are the
            // same until somebody is still writing when midnight arrives, and
            // then this widget would otherwise draw an empty new day over a
            // session that is still running.
            String todayKey  = StreakWidgetProvider.writingDayKey(ctx);
            int streakDays   = computeStreak(log, todayKey);
            int[] todayEntry = log.get(todayKey);
            int wordsToday   = todayEntry != null ? todayEntry[0] : 0;
            int goalToday    = todayEntry != null ? todayEntry[1] : goalWords;
            boolean todayMet = wordsToday >= goalToday;

            // Title
            views.setTextViewText(R.id.widget_title, title);
            views.setTextColor(R.id.widget_title, pal.textSecondary);

            // Streak count
            views.setTextViewText(R.id.widget_streak_count, String.valueOf(streakDays));
            views.setTextColor(R.id.widget_streak_count, streakDays > 0 ? accent : pal.textDim);

            // Streak label
            String label = streakDays == 1 ? "day streak"
                         : streakDays  > 1 ? "days streak"
                         : "no streak yet";
            views.setTextViewText(R.id.widget_streak_label, label);
            views.setTextColor(R.id.widget_streak_label, pal.textDim);

            // Today progress label
            // "met" rather than a tick glyph. A widget label cannot carry a
            // vector without a compound drawable, which is uncertain below API
            // 23, and an emoji tick renders in whatever font the launcher has.
            // The word also survives for anyone who cannot see the colour
            // change on the next line, which was otherwise the only other cue.
            String progressLabel = wordsToday + " / " + goalToday + " words today"
                    + (todayMet ? " · met" : "");
            views.setTextViewText(R.id.widget_progress_label, progressLabel);
            views.setTextColor(R.id.widget_progress_label, todayMet ? accent : pal.textDim);

            // Progress bar (0–100)
            int pct = goalToday > 0 ? Math.min(100, wordsToday * 100 / goalToday) : 0;
            views.setProgressBar(R.id.widget_progress_bar, 100, pct, false);

            // Calendar bitmap
            float density = ctx.getResources().getDisplayMetrics().density;
            Bitmap calBmp = renderCalendar(log, todayKey, accent, density, pal);
            views.setImageViewBitmap(R.id.widget_calendar, calBmp);

        } catch (Exception e) {
            views.setTextViewText(R.id.widget_title, "AuthNo");
        }
    }

    // ── Calendar bitmap ───────────────────────────────────────────────────────

    private static Bitmap renderCalendar(Map<String, int[]> log,
                                         String todayKey,
                                         int accent,
                                         float density,
                                         WidgetTheme pal) {
        // Cell geometry on the design system's spacing scale, same as the
        // layout around it. 34×28 and an 18dp header were eyeballed, and a
        // calendar whose proportions come from nowhere is exactly what makes
        // this widget look adjacent to the app rather than part of it.
        //
        // 32dp columns also make the bitmap wider relative to its height
        // (7×32 = 224dp across, ~164dp down), which matters because the view
        // below is fitCenter into whatever height is left over: the closer the
        // bitmap's aspect is to the slot's, the less of that slot goes unused.
        final int COLS     = 7;
        final int CELL_W   = (int) (DSTokens.SPACING.XXL * density);   // 32dp
        final int CELL_H   = (int) (DSTokens.SPACING.XL  * density);   // 24dp
        final int HEADER_H = (int) (DSTokens.SPACING.LG  * density);   // 16dp
        final int PAD_V    = (int) (DSTokens.SPACING.XS  * density);   // 4dp

        Calendar today  = Calendar.getInstance();
        int year        = today.get(Calendar.YEAR);
        int month       = today.get(Calendar.MONTH);
        int daysInMonth = today.getActualMaximum(Calendar.DAY_OF_MONTH);

        Calendar first = Calendar.getInstance();
        first.set(year, month, 1);
        int dow      = first.get(Calendar.DAY_OF_WEEK);
        int startPad = (dow + 5) % 7; // Monday-based

        int rows = Math.max(5, (int) Math.ceil((startPad + daysInMonth) / 7.0));

        int bmpW = COLS * CELL_W;
        int bmpH = HEADER_H + PAD_V + rows * CELL_H;

        Bitmap bmp = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888);
        Canvas c   = new Canvas(bmp);
        c.drawColor(Color.TRANSPARENT);

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setTextAlign(Paint.Align.CENTER);
        Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        // Typography from DSTokens, unscaled. The 0.9f that used to sit on the
        // header size put it at 9.9sp — between two steps of the scale, which
        // is the one place a size cannot be. size.xs IS the caption step.
        float headerTextSize = DSTokens.TYPOGRAPHY.SIZE_XS * density;   // 9sp
        float dayTextSize    = DSTokens.TYPOGRAPHY.SIZE_SM * density;   // 11sp

        // Accent tints
        int accentFill   = DSTokens.withAlpha(accent, 0x2e);
        int accentBorder = DSTokens.withAlpha(accent, 0x90);

        // Day-of-week headers
        textPaint.setTextSize(headerTextSize);
        textPaint.setTypeface(Typeface.DEFAULT_BOLD);
        textPaint.setColor(pal.textFaint);
        for (int col = 0; col < COLS; col++) {
            c.drawText(DAY_HEADERS[col],
                    col * CELL_W + CELL_W / 2f,
                    HEADER_H - 2 * density,
                    textPaint);
        }

        // Day cells
        for (int cell = 0; cell < rows * COLS; cell++) {
            int day = cell - startPad + 1;
            if (day < 1 || day > daysInMonth) continue;

            int   row    = cell / COLS;
            int   col    = cell % COLS;
            float left   = col * CELL_W;
            float top    = HEADER_H + PAD_V + row * CELL_H;
            float right  = left + CELL_W;
            float bottom = top  + CELL_H;
            float cx     = left + CELL_W / 2f;
            float cy     = top  + CELL_H / 2f;
            float radius = CELL_H / 2f - density;

            String  key     = dateKey(year, month, day);
            boolean met     = isMet(log, key);
            boolean isToday = key.equals(todayKey);
            boolean hasData = log.containsKey(key);

            // Pill / arc background for met days
            if (met) {
                String  prevKey = day > 1          ? dateKey(year, month, day - 1) : null;
                String  nextKey = day < daysInMonth ? dateKey(year, month, day + 1) : null;
                boolean prevMet = col != 0 && prevKey != null && isMet(log, prevKey);
                boolean nextMet = col != 6 && nextKey != null && isMet(log, nextKey);

                fillPaint.setColor(accentFill);
                fillPaint.setStyle(Paint.Style.FILL);

                if (prevMet && nextMet) {
                    c.drawRect(left, top + density, right, bottom - density, fillPaint);
                } else if (prevMet) {
                    c.drawRect(left, top + density, cx, bottom - density, fillPaint);
                    c.drawCircle(cx, cy, radius, fillPaint);
                } else if (nextMet) {
                    c.drawRect(cx, top + density, right, bottom - density, fillPaint);
                    c.drawCircle(cx, cy, radius, fillPaint);
                } else {
                    c.drawCircle(cx, cy, radius, fillPaint);
                }

                fillPaint.setColor(accentBorder);
                fillPaint.setStyle(Paint.Style.STROKE);
                fillPaint.setStrokeWidth(1.5f * density);
                if (prevMet && nextMet) {
                    c.drawLine(left, top + density, right, top + density, fillPaint);
                    c.drawLine(left, bottom - density, right, bottom - density, fillPaint);
                } else if (prevMet) {
                    RectF rf = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);
                    c.drawArc(rf, -90, 180, false, fillPaint);
                    c.drawLine(left, top + density, cx, top + density, fillPaint);
                    c.drawLine(left, bottom - density, cx, bottom - density, fillPaint);
                } else if (nextMet) {
                    RectF rf = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);
                    c.drawArc(rf, 90, 180, false, fillPaint);
                    c.drawLine(cx, top + density, right, top + density, fillPaint);
                    c.drawLine(cx, bottom - density, right, bottom - density, fillPaint);
                } else {
                    c.drawCircle(cx, cy, radius, fillPaint);
                }
                fillPaint.setStyle(Paint.Style.FILL);
            }

            // Today dot (goal not yet met)
            if (isToday && !met) {
                fillPaint.setColor(accent);
                fillPaint.setStyle(Paint.Style.FILL);
                c.drawCircle(cx, bottom - 3 * density, 2 * density, fillPaint);
            }

            // Partial progress bar (thin line at bottom of cell)
            if (hasData && !met && !isToday) {
                int[] entry = log.get(key);
                if (entry != null && entry[1] > 0) {
                    float barW = (CELL_W - 8 * density) * Math.min(1f, (float) entry[0] / entry[1]);
                    float barL = left + 4 * density;
                    float barT = bottom - 3 * density;
                    fillPaint.setColor(pal.progressTrack);
                    c.drawRoundRect(new RectF(barL, barT, right - 4 * density, barT + 2 * density),
                            density, density, fillPaint);
                    if (barW > 0) {
                        fillPaint.setColor(DSTokens.withAlpha(accent, 0x60));
                        c.drawRoundRect(new RectF(barL, barT, barL + barW, barT + 2 * density),
                                density, density, fillPaint);
                    }
                }
            }

            // Day number text
            textPaint.setTextSize(dayTextSize);
            if (met) {
                textPaint.setColor(accent);
                textPaint.setTypeface(Typeface.DEFAULT_BOLD);
            } else if (isToday) {
                textPaint.setColor(pal.textPrimary);
                textPaint.setTypeface(Typeface.DEFAULT_BOLD);
            } else if (hasData) {
                textPaint.setColor(pal.textHasData);
                textPaint.setTypeface(Typeface.DEFAULT);
            } else {
                textPaint.setColor(pal.textDim);
                textPaint.setTypeface(Typeface.DEFAULT);
            }
            c.drawText(String.valueOf(day), cx, cy + dayTextSize * 0.35f, textPaint);
        }

        return bmp;
    }

    // ── Streak / log helpers ──────────────────────────────────────────────────

    /**
     * Package-visible: the countdown widget reads the same log and must reach
     * the same numbers. A second parser would drift from this one the first
     * time either changed, and the two widgets sit on the same home screen.
     */
    static Map<String, int[]> parseLog(JSONObject raw, int fallbackGoal) {
        Map<String, int[]> map = new HashMap<>();
        if (raw == null) return map;
        try {
            JSONArray keys = raw.names();
            if (keys == null) return map;
            for (int i = 0; i < keys.length(); i++) {
                String k = keys.getString(i);
                Object v = raw.get(k);
                if (v instanceof Number) {
                    map.put(k, new int[]{((Number) v).intValue(), fallbackGoal});
                } else if (v instanceof JSONObject) {
                    JSONObject entry = (JSONObject) v;
                    map.put(k, new int[]{entry.optInt("words", 0), entry.optInt("goal", fallbackGoal)});
                }
            }
        } catch (Exception ignored) {}
        return map;
    }

    private static boolean isMet(Map<String, int[]> log, String key) {
        int[] e = log.get(key);
        return e != null && e[0] >= e[1];
    }

    static int computeStreak(Map<String, int[]> log, String todayKey) {
        int streak = 0;
        // From the day being counted, not from the device's clock. Inside an
        // extension those are different days, and starting from the calendar
        // would test a day that has not begun, find nothing, and draw a run
        // somebody is actively extending as already broken.
        Calendar cursor = WritingDay.toCalendar(todayKey);
        if (!isMet(log, todayKey)) cursor.add(Calendar.DAY_OF_YEAR, -1);
        for (int i = 0; i < 3650; i++) {
            String k = dateKey(cursor.get(Calendar.YEAR),
                               cursor.get(Calendar.MONTH),
                               cursor.get(Calendar.DAY_OF_MONTH));
            if (isMet(log, k)) {
                streak++;
                cursor.add(Calendar.DAY_OF_YEAR, -1);
            } else {
                break;
            }
        }
        return streak;
    }


    private static String dateKey(int year, int month, int day) {
        return String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day);
    }
}

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

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Stateless helper that reads a book's streak data and populates a
 * RemoteViews for the home-screen widget.  All calendar drawing is done
 * on a Bitmap using Canvas so we are not limited by RemoteViews' restricted
 * view set.
 */
public class StreakWidgetRenderer {

    // SharedPrefs colours (dark, matches the app's dark theme)
    private static final int BG_DARK       = Color.parseColor("#1a1b1e");
    private static final int TEXT_PRIMARY  = Color.parseColor("#f2f3f5");
    private static final int TEXT_DIM      = Color.parseColor("#72767d");
    private static final int TEXT_FAINT    = Color.parseColor("#4f545c");
    private static final int PROGRESS_TRACK= Color.parseColor("#2e3035");

    private static final String[] DAY_HEADERS = {"M","T","W","T","F","S","S"};

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Fills every field of the widget RemoteViews from the given book JSON object.
     *
     * @param ctx       Android context
     * @param views     The RemoteViews instance for this widget
     * @param book      JSONObject with at least { id, title, streak: { log, goalWords } }
     * @param accentHex e.g. "#5a00d9"
     */
    public static void populate(Context ctx, RemoteViews views,
                                JSONObject book, String accentHex) {
        int accent = parseColor(accentHex, Color.parseColor("#5a00d9"));

        try {
            String title  = book.optString("title", "Untitled Book");
            JSONObject streak      = book.optJSONObject("streak");
            int        goalWords   = streak != null ? streak.optInt("goalWords", 300) : 300;
            JSONObject rawLog      = streak != null ? streak.optJSONObject("log") : null;

            Map<String, int[]> log = parseLog(rawLog, goalWords); // int[]{words, goal}

            String todayKey    = todayKey();
            int    streak_days = computeStreak(log, todayKey);
            int[]  todayEntry  = log.get(todayKey);
            int    wordsToday  = todayEntry != null ? todayEntry[0] : 0;
            int    goalToday   = todayEntry != null ? todayEntry[1] : goalWords;
            boolean todayMet   = wordsToday >= goalToday;

            // Title
            views.setTextViewText(R.id.widget_title, title);
            views.setTextColor(R.id.widget_title, TEXT_PRIMARY);

            // Streak count
            views.setTextViewText(R.id.widget_streak_count, String.valueOf(streak_days));
            views.setTextColor(R.id.widget_streak_count,
                    streak_days > 0 ? accent : TEXT_DIM);

            // Streak label
            String label = streak_days == 1 ? "day streak"
                         : streak_days  > 1 ? "days streak"
                         : "no streak yet";
            views.setTextViewText(R.id.widget_streak_label, label);

            // Today progress label
            String progressLabel = wordsToday + " / " + goalToday + " words today"
                    + (todayMet ? " ✓" : "");
            views.setTextViewText(R.id.widget_progress_label, progressLabel);
            views.setTextColor(R.id.widget_progress_label, todayMet ? accent : TEXT_DIM);

            // ProgressBar (0–100)
            int pct = goalToday > 0 ? Math.min(100, wordsToday * 100 / goalToday) : 0;
            views.setProgressBar(R.id.widget_progress_bar, 100, pct, false);

            // Calendar bitmap
            float density  = ctx.getResources().getDisplayMetrics().density;
            Bitmap calBmp  = renderCalendar(log, todayKey, accent, density);
            views.setImageViewBitmap(R.id.widget_calendar, calBmp);

        } catch (Exception e) {
            views.setTextViewText(R.id.widget_title, "AuthNo");
        }
    }

    // ── Calendar bitmap ───────────────────────────────────────────────────────

    /**
     * Renders the current month's calendar onto a Bitmap.
     * Completed days are highlighted with accent-coloured pills/arcs (same
     * visual language as the in-app StreakCalendar component).
     */
    private static Bitmap renderCalendar(Map<String, int[]> log,
                                         String todayKey,
                                         int accent,
                                         float density) {
        // Fixed pixel dimensions — launcher scales the ImageView to fit.
        final int COLS     = 7;
        final int CELL_W   = (int)(34 * density);
        final int CELL_H   = (int)(28 * density);
        final int HEADER_H = (int)(18 * density);
        final int PAD_V    = (int)(4  * density);

        // Build grid cells
        Calendar today = Calendar.getInstance();
        int year  = today.get(Calendar.YEAR);
        int month = today.get(Calendar.MONTH);
        int daysInMonth = today.getActualMaximum(Calendar.DAY_OF_MONTH);

        Calendar first = Calendar.getInstance();
        first.set(year, month, 1);
        int dow      = first.get(Calendar.DAY_OF_WEEK); // 1=Sun
        int startPad = (dow + 5) % 7;                  // Monday-based

        int totalCells = startPad + daysInMonth;
        int rows = (int) Math.ceil(totalCells / 7.0);
        // Ensure at least 5 rows to avoid tiny widget
        rows = Math.max(rows, 5);

        int bmpW = COLS * CELL_W;
        int bmpH = HEADER_H + PAD_V + rows * CELL_H;

        Bitmap bmp = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888);
        Canvas c   = new Canvas(bmp);
        // Transparent background — widget card handles it
        c.drawColor(Color.TRANSPARENT);

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setTypeface(Typeface.DEFAULT_BOLD);
        textPaint.setTextAlign(Paint.Align.CENTER);

        Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        float textSize = 10 * density;
        float daySize  = 11 * density;

        // ── Day-of-week headers ──
        textPaint.setTextSize(textSize);
        textPaint.setColor(TEXT_FAINT);
        for (int col = 0; col < COLS; col++) {
            float cx = col * CELL_W + CELL_W / 2f;
            float cy = HEADER_H - 2 * density;
            c.drawText(DAY_HEADERS[col], cx, cy, textPaint);
        }

        int accentFill   = setAlpha(accent, 0x2e);
        int accentBorder = setAlpha(accent, 0x90);

        // ── Day cells ──
        for (int cell = 0; cell < rows * COLS; cell++) {
            int day = cell - startPad + 1;
            if (day < 1 || day > daysInMonth) continue;

            int row = cell / COLS;
            int col = cell % COLS;

            float left   = col * CELL_W;
            float top    = HEADER_H + PAD_V + row * CELL_H;
            float right  = left + CELL_W;
            float bottom = top  + CELL_H;
            float cx     = left + CELL_W / 2f;
            float cy     = top  + CELL_H / 2f;
            float radius = CELL_H / 2f - density;

            String key     = dateKey(year, month, day);
            boolean met    = isMet(log, key);
            boolean isToday= key.equals(todayKey);
            boolean hasData= log.containsKey(key);

            // Pill/arc background for met days
            if (met) {
                String prevKey = day > 1 ? dateKey(year, month, day - 1) : null;
                String nextKey = day < daysInMonth ? dateKey(year, month, day + 1) : null;
                boolean prevMet = col != 0 && prevKey != null && isMet(log, prevKey);
                boolean nextMet = col != 6 && nextKey != null && isMet(log, nextKey);

                fillPaint.setColor(accentFill);
                fillPaint.setStyle(Paint.Style.FILL);

                if (prevMet && nextMet) {
                    // Middle of a run — full rect strip
                    c.drawRect(left, top + density, right, bottom - density, fillPaint);
                } else if (prevMet) {
                    // Right end
                    c.drawRect(left, top + density, cx, bottom - density, fillPaint);
                    c.drawCircle(cx, cy, radius, fillPaint);
                } else if (nextMet) {
                    // Left end
                    c.drawRect(cx, top + density, right, bottom - density, fillPaint);
                    c.drawCircle(cx, cy, radius, fillPaint);
                } else {
                    // Isolated circle
                    c.drawCircle(cx, cy, radius, fillPaint);
                }

                // Border ring
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

            // Today dot indicator (below number, when goal not yet met)
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
                    fillPaint.setColor(PROGRESS_TRACK);
                    c.drawRoundRect(new RectF(barL, barT, right - 4 * density, barT + 2 * density), density, density, fillPaint);
                    if (barW > 0) {
                        fillPaint.setColor(setAlpha(accent, 0x60));
                        c.drawRoundRect(new RectF(barL, barT, barL + barW, barT + 2 * density), density, density, fillPaint);
                    }
                }
            }

            // Day number text
            textPaint.setTextSize(daySize);
            float textY = cy + daySize * 0.35f;

            if (met) {
                textPaint.setColor(accent);
                textPaint.setTypeface(Typeface.DEFAULT_BOLD);
            } else if (isToday) {
                textPaint.setColor(TEXT_PRIMARY);
                textPaint.setTypeface(Typeface.DEFAULT_BOLD);
            } else if (hasData) {
                textPaint.setColor(Color.parseColor("#96989d"));
                textPaint.setTypeface(Typeface.DEFAULT);
            } else {
                textPaint.setColor(TEXT_DIM);
                textPaint.setTypeface(Typeface.DEFAULT);
            }
            c.drawText(String.valueOf(day), cx, textY, textPaint);
        }

        return bmp;
    }

    // ── Streak / log helpers ──────────────────────────────────────────────────

    /** Parses a JSON log object into a Java Map. Legacy plain-int values are promoted. */
    private static Map<String, int[]> parseLog(JSONObject raw, int fallbackGoal) {
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

    private static int computeStreak(Map<String, int[]> log, String todayKey) {
        int streak = 0;
        Calendar cursor = Calendar.getInstance();
        if (!isMet(log, todayKey)) cursor.add(Calendar.DAY_OF_YEAR, -1);
        for (int i = 0; i < 3650; i++) { // cap at ~10 years
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

    // ── Date utilities ────────────────────────────────────────────────────────

    private static String todayKey() {
        return dateKey(Calendar.getInstance().get(Calendar.YEAR),
                       Calendar.getInstance().get(Calendar.MONTH),
                       Calendar.getInstance().get(Calendar.DAY_OF_MONTH));
    }

    private static String dateKey(int year, int month, int day) {
        return String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day);
    }

    // ── Colour utilities ──────────────────────────────────────────────────────

    private static int parseColor(String hex, int fallback) {
        try { return Color.parseColor(hex); } catch (Exception e) { return fallback; }
    }

    private static int setAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }
}

package com.aurorastudios.authno;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Map;

/**
 * How long is left of today's writing day, for one book.
 *
 * The book is chosen when the widget is placed — see StreakWidgetConfigActivity,
 * which both widgets share — and stored under the same
 * "widget_book_<appWidgetId>" key the streak widget uses.
 *
 * ── The clock ────────────────────────────────────────────────────────────────
 *
 * The countdown is a system chronometer, not a number this app redraws. Given
 * a base in elapsedRealtime and setChronometerCountDown, the platform ticks it
 * every second with the widget process asleep: no alarm, no wakelock, no
 * battery cost, and it stays correct if a sync never arrives.
 *
 * setChronometerCountDown is API 24. Below that the same view counts *upward*,
 * and a clock running the wrong way is worse than one that does not move — so
 * on API 22-23 the chronometer is hidden and a coarse "3h 12m" is drawn
 * instead. It is stale between syncs, and honest about being approximate.
 *
 * ── The deadline ─────────────────────────────────────────────────────────────
 *
 * Sent from JS (streakWindow.countdownState) rather than computed here. A
 * writing day ends at midnight unless the writer was still going when it
 * arrived, in which case it buys an hour at a time up to 4am — a rule that
 * depends on when they last wrote, which this process has no way of knowing.
 * Recomputing it here would also mean the app, this widget and any future
 * surface could disagree about when the day ends, which is worse than none of
 * them having a countdown at all. Falling back to local midnight when nothing
 * has been synced is the one guess this makes, and it is the one a reader
 * would make too.
 */
public class CountdownWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) updateWidget(ctx, mgr, id);
    }

    /** Placing several and removing one must not leave the others' books behind. */
    @Override
    public void onDeleted(Context ctx, int[] widgetIds) {
        SharedPreferences.Editor ed = ctx
                .getSharedPreferences(StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE).edit();
        for (int id : widgetIds) ed.remove(StreakWidgetProvider.WIDGET_BOOK_PREFIX + id);
        ed.apply();
    }

    /** Also called by WidgetDataPlugin after every sync, and by the config screen. */
    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        SharedPreferences prefs = ctx.getSharedPreferences(
                StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);

        String accentHex = prefs.getString(StreakWidgetProvider.KEY_ACCENT_COLOR, "#5a00d9");
        boolean isDark   = prefs.getBoolean(StreakWidgetProvider.KEY_IS_DARK, true);
        WidgetTheme theme = WidgetTheme.parse(
                prefs.getString(StreakWidgetProvider.KEY_THEME_JSON, ""), isDark);
        int accent = DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT);

        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.countdown_widget);
        applyTheme(views, theme, accent);

        String bookId = prefs.getString(StreakWidgetProvider.WIDGET_BOOK_PREFIX + widgetId, null);
        JSONObject book = findBook(prefs, bookId);

        if (book == null) {
            // Either nothing was chosen, or the chosen book is gone. Saying so
            // beats a countdown against a book that no longer exists.
            views.setTextViewText(R.id.countdown_book, "AuthNo");
            views.setTextViewText(R.id.countdown_caption, "No book linked");
            views.setTextViewText(R.id.countdown_progress, "");
            views.setTextViewText(R.id.countdown_remaining, "");
            views.setViewVisibility(R.id.countdown_clock, View.GONE);
            views.setViewVisibility(R.id.countdown_static, View.GONE);
            views.setViewVisibility(R.id.countdown_streak, View.GONE);
            views.setOnClickPendingIntent(R.id.countdown_root, openApp(ctx, widgetId, null));
            mgr.updateAppWidget(widgetId, views);
            return;
        }

        // Derived from the log, the way the streak widget derives it. The
        // synced book carries `streak: { log, goalWords }` and nothing else —
        // reading a `wordsToday` or `current` field off it, which the first
        // version of this did, got a zero every time because the app has never
        // written either one.
        JSONObject streak = book.optJSONObject("streak");
        int goalDefault = streak == null ? 0 : streak.optInt("goalWords", 0);
        Map<String, int[]> log = StreakWidgetRenderer.parseLog(
                streak == null ? null : streak.optJSONObject("log"), goalDefault);

        String dayKey = StreakWidgetProvider.writingDayKey(prefs);
        int[] entry = log.get(dayKey);
        int wordsToday = entry != null ? entry[0] : 0;
        int goalWords  = entry != null ? entry[1] : goalDefault;
        int streakDays = StreakWidgetRenderer.computeStreak(log, dayKey);
        boolean met = goalWords > 0 && wordsToday >= goalWords;

        long deadline = deadlineFrom(prefs);
        int extendedHours = extendedFrom(prefs);

        views.setTextViewText(R.id.countdown_book, book.optString("title", "Untitled Book"));
        views.setTextViewText(R.id.countdown_progress, CountdownText.progress(wordsToday, goalWords));
        views.setTextViewText(R.id.countdown_caption,
                CountdownText.caption(streakDays, met, extendedHours));

        String left = CountdownText.remaining(wordsToday, goalWords);
        views.setTextViewText(R.id.countdown_remaining, left == null ? "" : left);
        views.setViewVisibility(R.id.countdown_remaining, left == null ? View.GONE : View.VISIBLE);

        String streakLabel = CountdownText.streakLabel(streakDays);
        views.setTextViewText(R.id.countdown_streak, streakLabel);
        views.setViewVisibility(R.id.countdown_streak, streakLabel.isEmpty() ? View.GONE : View.VISIBLE);

        long msLeft = Math.max(0L, deadline - System.currentTimeMillis());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            // elapsedRealtime, not wall clock: the chronometer counts against
            // uptime, so handing it a System.currentTimeMillis base would put
            // the target decades away.
            views.setChronometer(R.id.countdown_clock,
                    SystemClock.elapsedRealtime() + msLeft, null, true);
            views.setChronometerCountDown(R.id.countdown_clock, true);
            views.setViewVisibility(R.id.countdown_clock, View.VISIBLE);
            views.setViewVisibility(R.id.countdown_static, View.GONE);
        } else {
            views.setTextViewText(R.id.countdown_static, CountdownText.staticRemaining(msLeft));
            views.setViewVisibility(R.id.countdown_static, View.VISIBLE);
            views.setViewVisibility(R.id.countdown_clock, View.GONE);
        }

        // The whole card opens the book — unlike the resume and notes widgets,
        // this one carries no buttons, so there is no tap it could steal.
        views.setOnClickPendingIntent(R.id.countdown_root,
                openApp(ctx, widgetId, book.optString("id", null)));

        mgr.updateAppWidget(widgetId, views);
    }

    /**
     * When today's writing day ends.
     *
     * From the JS payload when there is one. Without it — a widget placed
     * before the app has ever synced — local midnight, which is what the
     * writer would assume and is never wildly wrong.
     */
    private static long deadlineFrom(SharedPreferences prefs) {
        String raw = prefs.getString(StreakWidgetProvider.KEY_COUNTDOWN_JSON, "");
        if (raw != null && !raw.trim().isEmpty()) {
            try {
                long d = new JSONObject(raw).optLong("deadline", 0L);
                if (d > System.currentTimeMillis()) return d;
            } catch (Exception ignored) { /* fall through to midnight */ }
        }
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.add(java.util.Calendar.DAY_OF_YEAR, 1);
        c.set(java.util.Calendar.HOUR_OF_DAY, 0);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /**
     * How many hours past midnight the deadline has been pushed, or 0.
     *
     * Read rather than derived. Working it out here from the deadline and the
     * current time would mean this widget re-deciding a question streakWindow
     * has already answered, and the two would drift the first time either
     * changed — the drift being invisible until somebody's streak disagreed
     * with their widget at 1am.
     */
    private static int extendedFrom(SharedPreferences prefs) {
        String raw = prefs.getString(StreakWidgetProvider.KEY_COUNTDOWN_JSON, "");
        if (raw == null || raw.trim().isEmpty()) return 0;
        try {
            return Math.max(0, new JSONObject(raw).optInt("extended", 0));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static JSONObject findBook(SharedPreferences prefs, String bookId) {
        if (bookId == null || bookId.isEmpty()) return null;
        try {
            JSONArray books = new JSONArray(prefs.getString(StreakWidgetProvider.KEY_BOOKS_JSON, "[]"));
            for (int i = 0; i < books.length(); i++) {
                JSONObject b = books.optJSONObject(i);
                if (b != null && bookId.equals(b.optString("id", ""))) return b;
            }
        } catch (Exception ignored) { /* treated as no book */ }
        return null;
    }

    private static void applyTheme(RemoteViews views, WidgetTheme theme, int accent) {
        views.setInt(R.id.countdown_card_bg, "setColorFilter", theme.bg);
        views.setTextColor(R.id.countdown_book, theme.textDim);
        views.setTextColor(R.id.countdown_caption, theme.textDim);
        views.setTextColor(R.id.countdown_progress, theme.textPrimary);
        views.setTextColor(R.id.countdown_remaining, theme.textDim);
        views.setTextColor(R.id.countdown_streak, accent);
        // The clock is the one element the eye goes to, so it takes the accent.
        views.setTextColor(R.id.countdown_clock, accent);
        views.setTextColor(R.id.countdown_static, accent);
    }

    /**
     * Request codes are offset clear of the other widgets'. Widget ids are
     * unique across providers so they cannot collide on the id itself, but
     * keeping the arithmetic distinct means a future button here cannot
     * quietly reuse one of their slots.
     */
    private static PendingIntent openApp(Context ctx, int widgetId, String bookId) {
        Intent i = new Intent(ctx, MainActivity.class);
        if (bookId != null && !bookId.isEmpty()) {
            i.putExtra("authnoAction", "resume");
            i.putExtra("authnoBookId", bookId);
        }
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, widgetId * 10 + 6, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

package com.aurorastudios.authno;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * The Resume card — "where was I?", answered in one tap.
 *
 * Data flow:
 *   App.js  →  widgetBridge.buildResumePayload() + theme.buildWidgetTheme()
 *           →  WidgetDataPlugin.syncBooks()  →  SharedPreferences  →  here
 *
 * No configuration activity and no per-instance state: there is only ever one
 * "last place you were writing", so every instance shows the same thing and
 * nothing has to be chosen when it is placed.
 */
public class ResumeWidgetProvider extends AppWidgetProvider {

    /** Padding, the book line, one line of chapter title, and the button. */
    private static final int CORE_DP = 99;

    /** The word count and when. */
    private static final int META_DP = 23;

    /** The book icon and name. */
    private static final int BOOK_LINE_DP = 15;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) updateWidget(ctx, mgr, id);
    }

    /**
     * Re-render when the user resizes the widget.
     *
     * Without this a widget decides what to show once, when it is placed, and
     * keeps showing that forever: dragged taller it leaves the new space
     * empty, dragged shorter it clips. The provider is the only thing that can
     * react, because a RemoteViews layout cannot see its own size — and this
     * is the only callback that tells it the size changed.
     */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr,
                                          int widgetId, Bundle newOptions) {
        super.onAppWidgetOptionsChanged(ctx, mgr, widgetId, newOptions);
        updateWidget(ctx, mgr, widgetId);
    }

    /** Also called by WidgetDataPlugin after every sync. */
    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        SharedPreferences prefs = ctx.getSharedPreferences(
                StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);

        String accentHex = prefs.getString(StreakWidgetProvider.KEY_ACCENT_COLOR, "#5a00d9");
        boolean isDark   = prefs.getBoolean(StreakWidgetProvider.KEY_IS_DARK, true);
        String resumeRaw = prefs.getString(StreakWidgetProvider.KEY_RESUME_JSON, "");
        WidgetTheme theme = WidgetTheme.parse(
                prefs.getString(StreakWidgetProvider.KEY_THEME_JSON, ""), isDark);

        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.resume_widget);
        int accent = DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT);

        applyTheme(views, theme, accent);

        JSONObject r = parse(resumeRaw);

        if (r == null) {
            // Nothing written yet, or the recorded book has been deleted. Say so
            // plainly — a card naming a chapter that is not there, with a button
            // that lands nowhere, is worse than an honest empty state. The
            // button still opens the app, because that IS the next step here.
            views.setTextViewText(R.id.resume_book, "AuthNo");
            views.setTextViewText(R.id.resume_chapter, "Nothing open yet");
            views.setTextViewText(R.id.resume_meta, "No writing recorded");
            views.setTextViewText(R.id.resume_button, "Open AuthNo");
            views.setOnClickPendingIntent(R.id.resume_button, openApp(ctx, widgetId, null));
            mgr.updateAppWidget(widgetId, views);
            return;
        }

        String bookId = r.optString("bookId", null);
        views.setTextViewText(R.id.resume_book, r.optString("bookTitle", "Untitled Book"));
        views.setTextViewText(R.id.resume_chapter, r.optString("chapTitle", "Untitled chapter"));
        views.setTextViewText(R.id.resume_button, "Continue writing");

        // ── What this widget is tall enough for ────────────────────────────
        //
        // The chapter name and the button are the card. The word-count-and-
        // when line is the extra, and it is the one to drop: the button is the
        // only control here, so if anything falls off the bottom it is the
        // thing the widget exists for.
        //
        // The book line goes at the very smallest, because the chapter name
        // usually implies the book and a card with no chapter and no button is
        // not worth showing at all.
        WidgetSize size = WidgetSize.of(mgr, widgetId, 160, 130);

        boolean showMeta = size.roomFor(CORE_DP, META_DP);
        views.setTextViewText(R.id.resume_meta,
                showMeta ? ResumeText.meta(r.optInt("words", 0), r.optLong("ts", 0L)) : "");
        views.setViewVisibility(R.id.resume_meta,
                showMeta ? android.view.View.VISIBLE : android.view.View.GONE);

        boolean showBook = size.roomFor(CORE_DP - BOOK_LINE_DP, 0);
        views.setViewVisibility(R.id.resume_book_row,
                showBook ? android.view.View.VISIBLE : android.view.View.GONE);

        // ONLY the button. The card is information; a whole-surface tap target
        // on a home screen gets hit while scrolling, swiping between pages, or
        // picking the widget up to move it, and the cost of a mistake is the
        // whole app opening.
        views.setOnClickPendingIntent(R.id.resume_button, openApp(ctx, widgetId, bookId));

        mgr.updateAppWidget(widgetId, views);
    }

    /**
     * Paint the card in the app's actual theme.
     *
     * The background is tinted rather than swapped for one of two static
     * drawables: RemoteViews cannot recolour a shape set with
     * setBackgroundResource, which is why the older widgets could only ever be
     * dark or light and rendered Sepia, Paper and OLED as plain Dark. An
     * ImageView can be tinted, so one silhouette covers all six.
     */
    private static void applyTheme(RemoteViews views, WidgetTheme theme, int accent) {
        views.setInt(R.id.resume_card_bg, "setColorFilter", theme.bg);

        views.setTextColor(R.id.resume_book, theme.textDim);
        views.setTextColor(R.id.resume_chapter, theme.textPrimary);
        views.setTextColor(R.id.resume_meta, theme.textDim);

        // The accent goes on the button label — the only element that is an
        // action, and the one place the writer's chosen colour should land.
        views.setTextColor(R.id.resume_button, accent);

        // Resting and pressed states, crossfading on the design system's
        // durations. Which pair depends only on whether the theme is dark,
        // because both are translucent overlays on the card beneath rather
        // than opaque fills — the same way the design system defines
        // surfaces.low / surfaces.mid.
        views.setInt(R.id.resume_button, "setBackgroundResource",
                theme.isDark ? R.drawable.widget_btn_state_dark
                             : R.drawable.widget_btn_state_light);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static JSONObject parse(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(raw);
            // A payload with no book is the same as no payload: the empty state
            // is correct and the button must not pretend to open something.
            return o.optString("bookId", "").isEmpty() ? null : o;
        } catch (Exception ignored) { return null; }
    }

    /**
     * Resume, or plain open when there is nothing to resume.
     *
     * Request codes are offset clear of StreakWidgetProvider's widgetId*10
     * scheme. AppWidget ids are unique across providers so the two cannot
     * collide on the id itself, but keeping the arithmetic distinct means a
     * future button here cannot quietly reuse one of the streak widget's slots.
     */
    private static PendingIntent openApp(Context ctx, int widgetId, String bookId) {
        Intent i = new Intent(ctx, MainActivity.class);
        if (bookId != null && !bookId.isEmpty()) {
            i.putExtra("authnoAction", "resume");
            i.putExtra("authnoBookId", bookId);
        }
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, widgetId * 10 + 7, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

package com.aurorastudios.authno;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * The Resume card — "where was I?", answered in one tap.
 *
 * Data flow:
 *   App.js  →  widgetBridge.buildResumePayload()  →  WidgetDataPlugin.syncBooks()
 *           →  SharedPreferences[KEY_RESUME_JSON]  →  here
 *
 * Unlike the streak widget this needs no configuration activity and stores no
 * per-instance state: there is only ever one "last place you were writing", so
 * every instance shows the same thing and nothing has to be chosen when it is
 * placed. Placing it should cost one drag.
 */
public class ResumeWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) updateWidget(ctx, mgr, id);
    }

    /** Also called by WidgetDataPlugin after every sync. */
    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        SharedPreferences prefs = ctx.getSharedPreferences(
                StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);

        String accentHex = prefs.getString(StreakWidgetProvider.KEY_ACCENT_COLOR, "#5a00d9");
        boolean isDark   = prefs.getBoolean(StreakWidgetProvider.KEY_IS_DARK, true);
        String resumeRaw = prefs.getString(StreakWidgetProvider.KEY_RESUME_JSON, "");

        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.resume_widget);

        views.setInt(R.id.resume_root, "setBackgroundResource",
                isDark ? R.drawable.widget_background : R.drawable.widget_background_light);

        JSONObject r = parse(resumeRaw);

        if (r == null) {
            // Nothing written yet, or the recorded book has been deleted. Say
            // so plainly — a card claiming a chapter that is not there, with a
            // tap that lands nowhere, is worse than an honest empty state.
            views.setTextViewText(R.id.resume_book, "AuthNo");
            views.setTextViewText(R.id.resume_chapter, "Nothing open yet");
            views.setTextViewText(R.id.resume_meta, "Tap to start writing");
            views.setOnClickPendingIntent(R.id.resume_root, openApp(ctx, widgetId, null));
            mgr.updateAppWidget(widgetId, views);
            return;
        }

        String bookTitle = r.optString("bookTitle", "Untitled Book");
        String chapTitle = r.optString("chapTitle", "Untitled chapter");
        String bookId    = r.optString("bookId", null);
        int words        = r.optInt("words", 0);
        long ts          = r.optLong("ts", 0L);

        views.setTextViewText(R.id.resume_book, bookTitle);
        views.setTextViewText(R.id.resume_chapter, chapTitle);
        views.setTextViewText(R.id.resume_meta, ResumeText.meta(words, ts));

        // The accent goes on the chapter name — the one thing the eye should
        // land on, and the only element that reads as the action.
        views.setTextColor(R.id.resume_chapter,
                DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT));

        // The whole card is the button. There is exactly one thing to do here,
        // so a separate tap target would only be somewhere to miss.
        views.setOnClickPendingIntent(R.id.resume_root, openApp(ctx, widgetId, bookId));

        mgr.updateAppWidget(widgetId, views);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static JSONObject parse(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(raw);
            // A payload with no book is the same as no payload: the empty state
            // is correct and the tap must not pretend to open something.
            return o.optString("bookId", "").isEmpty() ? null : o;
        } catch (Exception ignored) { return null; }
    }

    /**
     * Resume, or plain open when there is nothing to resume.
     *
     * Request codes are offset well clear of StreakWidgetProvider's widgetId*10
     * scheme. AppWidget ids are unique across providers, so the two cannot
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

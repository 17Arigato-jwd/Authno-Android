package com.aurorastudios.authno;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget that displays a book's writing streak calendar.
 *
 * Data flow:
 *   React app  →  WidgetDataPlugin.syncBooks()  →  SharedPreferences
 *                                                       ↓
 *   StreakWidgetProvider.onUpdate()  →  StreakWidgetRenderer  →  RemoteViews
 *
 * Each widget instance stores its linked book ID under the key
 * "widget_book_<appWidgetId>" in SharedPreferences.
 */
public class StreakWidgetProvider extends AppWidgetProvider {

    // SharedPreferences file shared between this provider, the config activity,
    // and the WidgetDataPlugin so all three see the same data.
    static final String PREFS_NAME         = "authno_widget_prefs";
    static final String KEY_BOOKS_JSON     = "authno_books";
    static final String KEY_ACCENT_COLOR   = "authno_accent_color";
    static final String WIDGET_BOOK_PREFIX = "widget_book_";

    // ── Lifecycle callbacks ───────────────────────────────────────────────────

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) {
            updateWidget(ctx, mgr, id);
        }
    }

    @Override
    public void onDeleted(Context ctx, int[] widgetIds) {
        SharedPreferences.Editor ed =
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        for (int id : widgetIds) {
            ed.remove(WIDGET_BOOK_PREFIX + id);
        }
        ed.apply();
    }

    // ── Static helper — also called from StreakWidgetConfigActivity ───────────

    /**
     * Rebuilds the RemoteViews for a single widget instance and pushes it to
     * the launcher.  Safe to call from any context (config activity, plugin, etc.).
     */
    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        SharedPreferences prefs =
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        String bookId    = prefs.getString(WIDGET_BOOK_PREFIX + widgetId, null);
        String accentHex = prefs.getString(KEY_ACCENT_COLOR, "#5a00d9");

        // Try the native-written file first (written by Filesystem plugin from JS),
        // fall back to SharedPreferences for backwards compatibility.
        String booksJson = null;
        try {
            java.io.File f = new java.io.File(ctx.getFilesDir(), "authno_books.json");
            if (f.exists()) {
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(f));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                String s = sb.toString().trim();
                if (!s.isEmpty()) booksJson = s;
            }
        } catch (Exception ignored) {}
        if (booksJson == null) booksJson = prefs.getString(KEY_BOOKS_JSON, "[]");

        // Look up the linked book in the stored JSON array
        JSONObject book = findBook(booksJson, bookId);

        RemoteViews views =
                new RemoteViews(ctx.getPackageName(), R.layout.streak_widget);

        // Tapping the widget opens MainActivity with a deep-link extra so the
        // app can navigate straight to the correct book.
        Intent launch = new Intent(ctx, MainActivity.class);
        if (bookId != null) launch.putExtra("widgetBookId", bookId);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, widgetId, launch, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        if (book != null) {
            StreakWidgetRenderer.populate(ctx, views, book, accentHex);
        } else {
            // Widget not configured yet (or the linked book was deleted)
            views.setTextViewText(R.id.widget_title, "Tap to open AuthNo");
            views.setTextViewText(R.id.widget_streak_count, "—");
            views.setTextViewText(R.id.widget_streak_label, "no book linked");
            views.setTextViewText(R.id.widget_progress_label, "Open the app to sync");
        }

        mgr.updateAppWidget(widgetId, views);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static JSONObject findBook(String booksJson, String bookId) {
        if (bookId == null || bookId.isEmpty()) return null;
        try {
            JSONArray arr = new JSONArray(booksJson);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject b = arr.getJSONObject(i);
                if (bookId.equals(b.optString("id"))) return b;
            }
        } catch (Exception ignored) {}
        return null;
    }
}

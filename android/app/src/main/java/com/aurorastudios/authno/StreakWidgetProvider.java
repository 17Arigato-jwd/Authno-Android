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
    static final String KEY_IS_DARK        = "authno_is_dark";
    static final String WIDGET_BOOK_PREFIX = "widget_book_";

    // Actions handled by this receiver itself. Both are sent as EXPLICIT
    // intents (new Intent(ctx, StreakWidgetProvider.class)), so they need no
    // <intent-filter> and are not reachable from other apps — a widget button
    // should not become an exported entry point.
    static final String ACTION_REFRESH = "com.aurorastudios.authno.WIDGET_REFRESH";
    static final String ACTION_CYCLE   = "com.aurorastudios.authno.WIDGET_CYCLE_BOOK";

    // ── Lifecycle callbacks ───────────────────────────────────────────────────

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) {
            updateWidget(ctx, mgr, id);
        }
    }

    /**
     * Buttons that act without opening the app.
     *
     * A widget can only respond to a PendingIntent, and the usual answer is to
     * launch the activity. For "show me the next book" and "you look stale,
     * reload" that is a poor trade: the writer wanted to stay on the home
     * screen. Broadcasting back to this receiver does the work in place.
     */
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_REFRESH.equals(action) || ACTION_CYCLE.equals(action)) {
            int widgetId = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return;

            if (ACTION_CYCLE.equals(action)) cycleBook(ctx, widgetId);
            // Refresh needs no state change: updateWidget re-reads the data
            // file and re-renders, which is the whole point of the button.
            updateWidget(ctx, AppWidgetManager.getInstance(ctx), widgetId);
            return;
        }

        super.onReceive(ctx, intent);
    }

    /**
     * Point this widget at the next book in the synced list, wrapping around.
     *
     * A writer with three books should not need three widgets. If the current
     * book is not in the list any more — deleted, or never synced — this lands
     * on the first one, which is a better answer than staying broken.
     */
    private static void cycleBook(Context ctx, int widgetId) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String currentId = prefs.getString(WIDGET_BOOK_PREFIX + widgetId, null);
        String nextId = nextBookId(readBooksJson(ctx, prefs), currentId);
        if (nextId == null) return;   // nothing synced yet — leave it alone
        prefs.edit().putString(WIDGET_BOOK_PREFIX + widgetId, nextId).apply();
    }

    static String nextBookId(String booksJson, String currentId) {
        try {
            JSONArray arr = new JSONArray(booksJson);
            if (arr.length() == 0) return null;
            int at = -1;
            for (int i = 0; i < arr.length(); i++) {
                if (currentId != null && currentId.equals(arr.getJSONObject(i).optString("id"))) {
                    at = i; break;
                }
            }
            // at == -1 (unknown/deleted book) falls through to index 0.
            return arr.getJSONObject((at + 1) % arr.length()).optString("id");
        } catch (Exception ignored) { return null; }
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
        boolean isDark   = prefs.getBoolean(KEY_IS_DARK, true);

        String booksJson = readBooksJson(ctx, prefs);

        // Look up the linked book in the stored JSON array
        JSONObject book = findBook(booksJson, bookId);

        RemoteViews views =
                new RemoteViews(ctx.getPackageName(), R.layout.streak_widget);

        // Theme the card at runtime — the layout's dark drawable used to be
        // the only option, so the widget ignored light app themes.
        views.setInt(R.id.widget_root, "setBackgroundResource",
                isDark ? R.drawable.widget_background : R.drawable.widget_background_light);
        views.setInt(R.id.widget_start_btn, "setBackgroundResource",
                isDark ? R.drawable.widget_btn_bg : R.drawable.widget_btn_bg_light);
        views.setTextColor(R.id.widget_start_btn,
                DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT));

        // Tapping the widget opens MainActivity with a deep-link extra so the
        // app can navigate straight to the correct book.
        // Request codes: PendingIntents are keyed by (requestCode, Intent) and
        // Intent extras are NOT compared, so the two taps below need distinct
        // request codes — widgetId*10 and widgetId*10+1.
        Intent launch = new Intent(ctx, MainActivity.class);
        if (bookId != null) launch.putExtra("widgetBookId", bookId);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, widgetId * 10, launch, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        // Start writing → the app's Resume Writing path (editor, last caret).
        Intent write = new Intent(ctx, MainActivity.class);
        write.putExtra("authnoAction", "resume");
        if (bookId != null) write.putExtra("authnoBookId", bookId);
        write.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent piWrite = PendingIntent.getActivity(ctx, widgetId * 10 + 1, write, flags);
        views.setOnClickPendingIntent(R.id.widget_start_btn, piWrite);

        // + Chapter → opens the app on a fresh chapter of THIS widget's book,
        // which may not be the one the app currently has open.
        Intent newChap = new Intent(ctx, MainActivity.class);
        newChap.putExtra("authnoAction", "new-chapter");
        if (bookId != null) newChap.putExtra("authnoBookId", bookId);
        newChap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_new_chapter_btn,
                PendingIntent.getActivity(ctx, widgetId * 10 + 2, newChap, flags));

        // ── The two that stay on the home screen ──
        // getBroadcast, not getActivity: these come back to onReceive above and
        // re-render in place. The request codes continue the widgetId*10 + n
        // scheme — PendingIntents are keyed by (requestCode, Intent) and extras
        // are NOT part of that key, so every button on a widget needs its own
        // offset. Nine per widget before this collides with the next widget.
        Intent cycle = new Intent(ctx, StreakWidgetProvider.class)
                .setAction(ACTION_CYCLE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        views.setOnClickPendingIntent(R.id.widget_next_book_btn,
                PendingIntent.getBroadcast(ctx, widgetId * 10 + 3, cycle, flags));

        Intent refresh = new Intent(ctx, StreakWidgetProvider.class)
                .setAction(ACTION_REFRESH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        views.setOnClickPendingIntent(R.id.widget_refresh_btn,
                PendingIntent.getBroadcast(ctx, widgetId * 10 + 4, refresh, flags));

        // Theme the new buttons with the primary one.
        int accent = DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT);
        int[] actionBtns = { R.id.widget_new_chapter_btn, R.id.widget_next_book_btn, R.id.widget_refresh_btn };
        for (int btn : actionBtns) {
            views.setInt(btn, "setBackgroundResource",
                    isDark ? R.drawable.widget_btn_bg : R.drawable.widget_btn_bg_light);
            views.setTextColor(btn, accent);
        }

        // Cycling is meaningless with one book, and a button that visibly does
        // nothing reads as broken. GONE rather than disabled so the two that
        // remain take the full width.
        views.setViewVisibility(R.id.widget_next_book_btn,
                bookCount(booksJson) > 1 ? android.view.View.VISIBLE : android.view.View.GONE);

        if (book != null) {
            StreakWidgetRenderer.populate(ctx, views, book, accentHex, isDark);
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

    /**
     * The synced book list. The native-written file is the current source; the
     * SharedPreferences copy is the older one and is kept as a fallback so a
     * widget placed before that change keeps working.
     *
     * Shared by the render path and the cycle button so the two can never
     * disagree about which books exist.
     */
    static String readBooksJson(Context ctx, SharedPreferences prefs) {
        try {
            java.io.File f = new java.io.File(ctx.getFilesDir(), "authno_books.json");
            if (f.exists()) {
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(f));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                String s = sb.toString().trim();
                if (!s.isEmpty()) return s;
            }
        } catch (Exception ignored) {}
        return prefs.getString(KEY_BOOKS_JSON, "[]");
    }

    static int bookCount(String booksJson) {
        try { return new JSONArray(booksJson).length(); } catch (Exception ignored) { return 0; }
    }

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

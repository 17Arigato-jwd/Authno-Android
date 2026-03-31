package com.aurorastudios.authno;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * Capacitor plugin — bridge between React's in-memory session state and the
 * native Android home-screen widget.
 *
 * Call from JS:
 *
 *   import { WidgetDataPlugin } from '../utils/widgetBridge';
 *   WidgetDataPlugin.syncBooks({ booksJson, accentHex });
 *
 * The plugin writes the data to SharedPreferences AND to authno_books.json so
 * that both data paths are always in sync before any widget refresh occurs.
 *
 * Must be registered in MainActivity:
 *   registerPlugin(WidgetDataPlugin.class);
 */
@CapacitorPlugin(name = "WidgetData")
public class WidgetDataPlugin extends Plugin {

    /**
     * Accepts:
     *   booksJson  {string}  JSON array of book objects (id, title, streak)
     *   accentHex  {string}  e.g. "#5a00d9"
     */
    @PluginMethod
    public void syncBooks(PluginCall call) {
        String booksJson = call.getString("booksJson", "[]");
        String accentHex = call.getString("accentHex", "#5a00d9");

        Context ctx = getContext();

        // 1. Write to SharedPreferences (fast, always succeeds)
        SharedPreferences.Editor ed = ctx
                .getSharedPreferences(StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
                .edit();
        ed.putString(StreakWidgetProvider.KEY_BOOKS_JSON, booksJson);
        ed.putString(StreakWidgetProvider.KEY_ACCENT_COLOR, accentHex);
        ed.apply();

        // 2. Also write authno_books.json so the file-first path in
        //    StreakWidgetProvider.updateWidget() always sees fresh data.
        //    Without this write the widget reads a stale file and ignores
        //    the SharedPreferences data we just set above.
        writeBooksCacheFile(ctx, booksJson);

        // 3. Refresh every widget instance that is currently on the launcher
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(
                new ComponentName(ctx, StreakWidgetProvider.class));
        for (int id : ids) {
            StreakWidgetProvider.updateWidget(ctx, mgr, id);
        }

        call.resolve();
    }

    /**
     * Writes {@code json} to {@code <filesDir>/authno_books.json} atomically
     * (write to a temp file then rename) so the widget never reads a
     * half-written file.
     */
    static void writeBooksCacheFile(Context ctx, String json) {
        try {
            File dest = new File(ctx.getFilesDir(), "authno_books.json");
            File tmp  = new File(ctx.getFilesDir(), "authno_books.json.tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp);
                 OutputStreamWriter w = new OutputStreamWriter(fos, StandardCharsets.UTF_8)) {
                w.write(json);
                w.flush();
                fos.getFD().sync(); // ensure bytes hit disk before rename
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(dest); // atomic on the same filesystem
        } catch (Exception ignored) {
            // File write is best-effort; SharedPreferences fallback still works
        }
    }
}

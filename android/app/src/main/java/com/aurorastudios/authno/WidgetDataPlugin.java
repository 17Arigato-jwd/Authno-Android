package com.aurorastudios.authno;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin — bridge between React's in-memory session state and the
 * native Android home-screen widget.
 *
 * Call from JS:
 *
 *   import { WidgetDataPlugin } from '../utils/widgetBridge';
 *   WidgetDataPlugin.syncBooks({ booksJson, accentHex });
 *
 * The plugin writes the data to SharedPreferences.  Any widget instance that
 * is currently on the home screen is then refreshed immediately.
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
        SharedPreferences.Editor ed = ctx
                .getSharedPreferences(StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
                .edit();
        ed.putString(StreakWidgetProvider.KEY_BOOKS_JSON, booksJson);
        ed.putString(StreakWidgetProvider.KEY_ACCENT_COLOR, accentHex);
        ed.apply();

        // Refresh every widget instance that is currently placed on the launcher
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(
                new ComponentName(ctx, StreakWidgetProvider.class));
        for (int id : ids) {
            StreakWidgetProvider.updateWidget(ctx, mgr, id);
        }

        call.resolve();
    }
}

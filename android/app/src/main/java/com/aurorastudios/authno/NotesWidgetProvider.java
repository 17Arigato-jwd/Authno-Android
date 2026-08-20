package com.aurorastudios.authno;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Quick capture on the home screen.
 *
 * Data flow:
 *   notes.js › buildNotesPayload()  →  widgetBridge.syncWidget()
 *           →  WidgetDataPlugin.syncBooks()  →  SharedPreferences  →  here
 *
 * Read-only, and deliberately so. Books and the resume card are read-only on
 * the widget side too, but here the temptation is different: a notes widget
 * looks like it ought to be able to write one. It cannot, and not only because
 * RemoteViews has no EditText — a second writer into the same store is the
 * problem the session mirror already taught this project, and it is not worth
 * inheriting for a text field. Every path that creates or edits a note goes
 * through the app. See docs/todo/notes-widget.md.
 *
 * No configuration activity: notes are not per-book, so there is nothing to
 * choose when the widget is placed.
 */
public class NotesWidgetProvider extends AppWidgetProvider {

    /**
     * How many rows the layout HAS. How many are shown is a different number —
     * see rowsThatFit.
     *
     * RemoteViews has no inflater, so a provider can only address views that
     * already exist in the layout. Four slots is the ceiling; the widget is
     * frequently smaller than four slots.
     */
    private static final int MAX_ROWS = 4;

    /**
     * One row's height in dp: 4dp padding top and bottom, a 13sp title and an
     * 11sp subtitle. Kept here rather than measured because a provider cannot
     * measure — RemoteViews are built in this process and laid out in the
     * launcher's, and nothing crosses back.
     */
    private static final int ROW_DP = 40;

    /** Everything above the list: padding, the header line, the button, a gap. */
    private static final int CHROME_DP = 80;

    /** The "+n more" line, when there is one. */
    private static final int MORE_DP = 19;

    private static final int[] ROW_IDS   = { R.id.note_row_0,   R.id.note_row_1,   R.id.note_row_2,   R.id.note_row_3 };
    private static final int[] TITLE_IDS = { R.id.note_title_0, R.id.note_title_1, R.id.note_title_2, R.id.note_title_3 };
    private static final int[] SUB_IDS   = { R.id.note_sub_0,   R.id.note_sub_1,   R.id.note_sub_2,   R.id.note_sub_3 };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) updateWidget(ctx, mgr, id);
    }

    /**
     * Re-render when the user resizes the widget.
     *
     * Without this the row count is decided once, at placement, and a widget
     * dragged taller keeps showing the number of notes that fitted the size it
     * used to be. Every provider here wants this; this is the one where the
     * layout actually changes with height.
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
        WidgetTheme theme = WidgetTheme.parse(
                prefs.getString(StreakWidgetProvider.KEY_THEME_JSON, ""), isDark);

        // The whole store's size, not the number of rows sent. buildNotesPayload
        // trims to what the widget can show, so counting the array would tell a
        // writer with thirty notes that they have four.
        int total = prefs.getInt(StreakWidgetProvider.KEY_NOTES_TOTAL, 0);
        JSONArray notes = parse(prefs.getString(StreakWidgetProvider.KEY_NOTES_JSON, ""));

        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.notes_widget);
        int accent = DSTokens.parseColor(accentHex, DSTokens.DEFAULT_ACCENT);

        applyTheme(views, theme, accent);

        // The capture button is the point of the widget, so it is wired before
        // anything else and never depends on there being notes to show.
        views.setOnClickPendingIntent(R.id.notes_new_button, launch(ctx, widgetId, 8, "new-note", null));

        // Decided before the loop, because the "+n more" line takes a row's
        // worth of space itself and there is no point fitting a row only to
        // push the explanation of the missing ones off the bottom.
        // How many rows this widget is tall enough for, right now.
        //
        // The layout declares four and the provider used to reveal all four
        // whenever there were four notes — regardless of room. At the default
        // 4x2 size there is not: four rows plus the header and the capture
        // button come to about 260dp against a widget that asks for 140. The
        // surplus rows did not shrink, they fell off the bottom, taking the
        // "+n more" line that would have explained them.
        //
        // The "+n more" line is decided first because it costs a row's worth
        // of space itself, and there is no point fitting a row only to push
        // the explanation of the missing ones off the bottom.
        int available = notes == null ? 0 : notes.length();
        WidgetSize size = WidgetSize.of(mgr, widgetId, 250, 140);
        boolean hasMore = total > available;
        int limit = size.rowsFor(CHROME_DP + (hasMore ? MORE_DP : 0), ROW_DP, MAX_ROWS);

        int shown = 0;
        for (int i = 0; i < MAX_ROWS; i++) {
            JSONObject n = (notes == null || i >= limit) ? null : notes.optJSONObject(i);
            if (n == null) {
                views.setViewVisibility(ROW_IDS[i], android.view.View.GONE);
                continue;
            }
            String id = n.optString("id", "");
            views.setTextViewText(TITLE_IDS[i], NotesText.title(n.optString("title", "")));
            views.setTextViewText(SUB_IDS[i],
                    NotesText.secondary(n.optString("preview", ""), n.optLong("updated", 0L)));
            views.setViewVisibility(ROW_IDS[i], android.view.View.VISIBLE);

            // One request code per row. PendingIntents are keyed by
            // (requestCode, Intent) and extras are NOT part of that key, so
            // four rows sharing a code would all open whichever note was
            // registered last. This project has paid for that lesson once
            // already — see the streak widget's widgetId * 10 + n.
            //
            // A row with no id opens the list instead of a note it cannot
            // name. Better than a tap that appears to do nothing.
            views.setOnClickPendingIntent(ROW_IDS[i],
                    launch(ctx, widgetId, i, id.isEmpty() ? "notes" : "open-note", id.isEmpty() ? null : id));
            shown++;
        }

        boolean empty = shown == 0;
        views.setViewVisibility(R.id.notes_empty, empty ? android.view.View.VISIBLE : android.view.View.GONE);
        views.setViewVisibility(R.id.notes_list, empty ? android.view.View.GONE : android.view.View.VISIBLE);

        views.setTextViewText(R.id.notes_count, NotesText.countLabel(total));

        // Skipped outright when there are no rows: the "+n more" line lives
        // inside notes_list, which is hidden in the empty state, so a payload
        // that carried a total but no rows would otherwise leave a visible
        // count and an invisible explanation of it.
        String more = shown == 0 ? null : NotesText.moreLabel(total, shown);
        if (more == null) {
            views.setViewVisibility(R.id.notes_more, android.view.View.GONE);
        } else {
            views.setTextViewText(R.id.notes_more, more);
            views.setViewVisibility(R.id.notes_more, android.view.View.VISIBLE);
            // The list, not a note: there is no single note this refers to.
            views.setOnClickPendingIntent(R.id.notes_more, launch(ctx, widgetId, 9, "notes", null));
        }

        mgr.updateAppWidget(widgetId, views);
    }

    /**
     * Paint the card in the app's actual theme.
     *
     * Tinted rather than swapped for one of two static drawables: RemoteViews
     * cannot recolour a shape set with setBackgroundResource, which is why the
     * older widgets could only ever be dark or light and rendered Sepia, Paper
     * and OLED as plain Dark. An ImageView can be tinted, so one silhouette
     * covers all six.
     */
    private static void applyTheme(RemoteViews views, WidgetTheme theme, int accent) {
        views.setInt(R.id.notes_card_bg, "setColorFilter", theme.bg);

        views.setTextColor(R.id.notes_heading, theme.textDim);
        views.setTextColor(R.id.notes_count, theme.textDim);
        views.setTextColor(R.id.notes_empty, theme.textDim);
        views.setTextColor(R.id.notes_more, theme.textDim);

        for (int id : TITLE_IDS) views.setTextColor(id, theme.textPrimary);
        for (int id : SUB_IDS)   views.setTextColor(id, theme.textDim);

        // The accent goes on the one element that is an action.
        views.setTextColor(R.id.notes_new_button, accent);

        // Resting and pressed states, crossfading on the design system's
        // durations. Which pair depends only on whether the theme is dark,
        // because both are translucent overlays on the card beneath rather
        // than opaque fills.
        views.setInt(R.id.notes_new_button, "setBackgroundResource",
                theme.isDark ? R.drawable.widget_btn_state_dark
                             : R.drawable.widget_btn_state_light);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static JSONArray parse(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try { return new JSONArray(raw); } catch (Exception ignored) { return null; }
    }

    /**
     * Open the app and tell it what to do on arrival.
     *
     * `slot` must be unique per tap target within this widget instance. Widget
     * ids are unique across providers, so widgetId * 10 + slot cannot collide
     * with the streak widget's or the resume card's codes either — but the
     * arithmetic is kept in the same shape so a future button here cannot
     * quietly reuse one of their slots.
     */
    private static PendingIntent launch(Context ctx, int widgetId, int slot, String action, String noteId) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.putExtra("authnoAction", action);
        if (noteId != null && !noteId.isEmpty()) i.putExtra("authnoNoteId", noteId);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, widgetId * 10 + slot, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

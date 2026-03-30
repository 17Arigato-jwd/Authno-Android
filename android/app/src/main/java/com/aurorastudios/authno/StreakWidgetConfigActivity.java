package com.aurorastudios.authno;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Configuration activity launched by the Android widget picker whenever the
 * user adds an AuthNo Streak Widget to their home screen.
 *
 * It presents a list of books synced from the app.  When the user picks one,
 * the book ID is saved to SharedPreferences and the widget is rendered.
 *
 * If no books have been synced yet (i.e. the app has never been opened), the
 * activity shows a friendly prompt and still completes successfully.
 */
public class StreakWidgetConfigActivity extends AppCompatActivity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Widget ID is always passed in the launching intent.
        Intent intent = getIntent();
        Bundle extras = intent.getExtras();
        if (extras != null) {
            widgetId = extras.getInt(
                    AppWidgetManager.EXTRA_APPWIDGET_ID,
                    AppWidgetManager.INVALID_APPWIDGET_ID);
        }

        // Per Android docs: always set RESULT_CANCELED first so that if the
        // user backs out the widget is not placed.
        setResult(RESULT_CANCELED,
                new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));

        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        buildUI();
    }

    // ── UI (built in code — no extra layout file needed) ──────────────────────

    private void buildUI() {
        SharedPreferences prefs =
                getSharedPreferences(StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        String booksJson = prefs.getString(StreakWidgetProvider.KEY_BOOKS_JSON, "[]");
        String accentHex = prefs.getString(StreakWidgetProvider.KEY_ACCENT_COLOR, "#5a00d9");
        int accent = parseColor(accentHex);

        List<BookItem> books = parseBooks(booksJson);

        // Root
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#131417"));
        root.setPadding(dp(20), dp(24), dp(20), dp(24));
        setContentView(root);

        // Title
        TextView title = new TextView(this);
        title.setText("Link a Book");
        title.setTextColor(Color.parseColor("#f2f3f5"));
        title.setTextSize(20);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setPadding(0, 0, 0, dp(6));
        root.addView(title);

        // Subtitle
        TextView subtitle = new TextView(this);
        subtitle.setTextColor(Color.parseColor("#72767d"));
        subtitle.setTextSize(13);
        subtitle.setPadding(0, 0, 0, dp(20));
        root.addView(subtitle);

        if (books.isEmpty()) {
            subtitle.setText("Open AuthNo first to sync your books, then re-add the widget.");

            // "Open App" button
            TextView openBtn = makeButton("Open AuthNo", accent);
            openBtn.setOnClickListener(v -> {
                Intent launch = new Intent(this, MainActivity.class);
                launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(launch);
                finish();
            });
            root.addView(openBtn);
        } else {
            subtitle.setText("Pick the book whose streak this widget will show.");

            // Book list
            ListView list = new ListView(this);
            list.setBackgroundColor(Color.TRANSPARENT);
            list.setDivider(null);
            list.setAdapter(new BookAdapter(this, books, accent));
            list.setOnItemClickListener((parent, view, pos, id) ->
                    confirmSelection(books.get(pos), accentHex));
            root.addView(list, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        }
    }

    private void confirmSelection(BookItem book, String accentHex) {
        // Persist the widgetId → bookId mapping
        getSharedPreferences(StreakWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(StreakWidgetProvider.WIDGET_BOOK_PREFIX + widgetId, book.id)
                .apply();

        // Render the widget immediately
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        StreakWidgetProvider.updateWidget(this, mgr, widgetId);

        // Return OK so the launcher places the widget
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    // ── Book list adapter ──────────────────────────────────────────────────────

    private static class BookItem {
        final String id, title;
        final int streak;
        BookItem(String id, String title, int streak) {
            this.id = id; this.title = title; this.streak = streak;
        }
    }

    private static class BookAdapter extends ArrayAdapter<BookItem> {
        private final int accent;

        BookAdapter(Context ctx, List<BookItem> items, int accent) {
            super(ctx, 0, items);
            this.accent = accent;
        }

        @Override
        public View getView(int pos, View convertView, ViewGroup parent) {
            BookItem item = getItem(pos);
            Context ctx   = getContext();

            LinearLayout row = new LinearLayout(ctx);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            int pad = dp(ctx, 12);
            row.setPadding(pad, pad, pad, pad);

            // Book icon box
            LinearLayout iconBox = new LinearLayout(ctx);
            iconBox.setGravity(Gravity.CENTER);
            GradientDrawable iconBg = new GradientDrawable();
            iconBg.setShape(GradientDrawable.RECTANGLE);
            iconBg.setCornerRadius(dp(ctx, 10));
            iconBg.setColor(Color.parseColor("#1e1f23"));
            iconBg.setStroke(1, setAlpha(accent, 0x30));
            iconBox.setBackground(iconBg);
            int iconSize = dp(ctx, 40);
            LinearLayout.LayoutParams iconLp =
                    new LinearLayout.LayoutParams(iconSize, iconSize);
            iconLp.setMarginEnd(dp(ctx, 14));
            iconBox.setLayoutParams(iconLp);

            TextView bookEmoji = new TextView(ctx);
            bookEmoji.setText("📖");
            bookEmoji.setTextSize(18);
            iconBox.addView(bookEmoji);
            row.addView(iconBox, iconLp);

            // Text column
            LinearLayout textCol = new LinearLayout(ctx);
            textCol.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams tcLp =
                    new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            textCol.setLayoutParams(tcLp);

            TextView titleTv = new TextView(ctx);
            titleTv.setText(item != null ? item.title : "");
            titleTv.setTextColor(Color.parseColor("#f2f3f5"));
            titleTv.setTextSize(14);
            titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
            titleTv.setMaxLines(1);
            titleTv.setEllipsize(android.text.TextUtils.TruncateAt.END);
            textCol.addView(titleTv);

            TextView streakTv = new TextView(ctx);
            int s = item != null ? item.streak : 0;
            streakTv.setText(s > 0 ? "🔥 " + s + " day streak" : "No streak yet");
            streakTv.setTextColor(s > 0 ? accent : Color.parseColor("#72767d"));
            streakTv.setTextSize(12);
            textCol.addView(streakTv);

            row.addView(textCol);

            // Hover/press background
            GradientDrawable rowBg = new GradientDrawable();
            rowBg.setShape(GradientDrawable.RECTANGLE);
            rowBg.setCornerRadius(dp(ctx, 14));
            rowBg.setColor(Color.parseColor("#1a1b1e"));
            row.setBackground(rowBg);

            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            rowLp.setMargins(0, 0, 0, dp(ctx, 8));
            row.setLayoutParams(rowLp);

            return row;
        }
    }

    // ── Data helpers ──────────────────────────────────────────────────────────

    private static List<BookItem> parseBooks(String json) {
        List<BookItem> list = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject b = arr.getJSONObject(i);
                String id    = b.optString("id", "");
                String title = b.optString("title", "Untitled Book");

                // Compute streak client-side so we can display it in the picker
                JSONObject streak  = b.optJSONObject("streak");
                JSONObject rawLog  = streak != null ? streak.optJSONObject("log") : null;
                int goalWords = streak != null ? streak.optInt("goalWords", 300) : 300;
                int days = computeStreakDays(rawLog, goalWords);

                list.add(new BookItem(id, title, days));
            }
        } catch (Exception ignored) {}
        return list;
    }

    private static int computeStreakDays(JSONObject rawLog, int fallback) {
        if (rawLog == null) return 0;
        try {
            java.util.Calendar today = java.util.Calendar.getInstance();
            String todayKey = dateKey(today);
            // Check today first
            boolean todayMet = isMetInLog(rawLog, todayKey, fallback);
            if (!todayMet) today.add(java.util.Calendar.DAY_OF_YEAR, -1);
            int count = 0;
            for (int i = 0; i < 3650; i++) {
                if (isMetInLog(rawLog, dateKey(today), fallback)) {
                    count++;
                    today.add(java.util.Calendar.DAY_OF_YEAR, -1);
                } else break;
            }
            return count;
        } catch (Exception e) { return 0; }
    }

    private static boolean isMetInLog(JSONObject log, String key, int fallback) {
        try {
            if (!log.has(key)) return false;
            Object v = log.get(key);
            if (v instanceof Number) return ((Number) v).intValue() >= fallback;
            if (v instanceof JSONObject) {
                JSONObject e = (JSONObject) v;
                return e.optInt("words", 0) >= e.optInt("goal", fallback);
            }
        } catch (Exception ignored) {}
        return false;
    }

    private static String dateKey(java.util.Calendar cal) {
        return String.format(java.util.Locale.US, "%04d-%02d-%02d",
                cal.get(java.util.Calendar.YEAR),
                cal.get(java.util.Calendar.MONTH) + 1,
                cal.get(java.util.Calendar.DAY_OF_MONTH));
    }

    // ── View / colour helpers ─────────────────────────────────────────────────

    private TextView makeButton(String text, int accent) {
        TextView btn = new TextView(this);
        btn.setText(text);
        btn.setTextColor(Color.WHITE);
        btn.setTextSize(14);
        btn.setTypeface(null, android.graphics.Typeface.BOLD);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(dp(20), dp(14), dp(20), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.RECTANGLE);
        bg.setCornerRadius(dp(14));
        bg.setColor(accent);
        btn.setBackground(bg);
        return btn;
    }

    private int dp(int val) { return dp(this, val); }

    private static int dp(Context ctx, int val) {
        return Math.round(val * ctx.getResources().getDisplayMetrics().density);
    }

    private static int parseColor(String hex) {
        try { return Color.parseColor(hex); } catch (Exception e) { return Color.parseColor("#5a00d9"); }
    }

    private static int setAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }
}

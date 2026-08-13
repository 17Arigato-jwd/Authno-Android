package com.aurorastudios.authno;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.Calendar;

/**
 * RemindersPlugin — the daily writing nudge.
 *
 * Hand-rolled rather than @capacitor/local-notifications, matching the other
 * plugins in this project: one dependency fewer, and the scheduling policy
 * below is specific enough that the generic plugin would need most of it
 * written anyway.
 *
 * The alarm survives the app being closed and, via BootReceiver, the phone
 * being restarted. What it cannot do is ask the web layer anything at fire
 * time — the app may not have run for days — so everything the notification
 * needs is written to SharedPreferences ahead of time by reportProgress().
 */
@CapacitorPlugin(
    name = "Reminders",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class RemindersPlugin extends Plugin {

    static final String PREFS = "authno_reminders";
    static final String KEY_HOUR          = "hour";
    static final String KEY_MINUTE        = "minute";
    static final String KEY_SKIP_WHEN_MET = "skipWhenMet";
    static final String KEY_ENABLED       = "enabled";
    // Written by the app while it runs; read by the receiver when it fires.
    static final String KEY_MET_TODAY     = "metToday";
    static final String KEY_STREAK_DAYS   = "streakDays";
    static final String KEY_DAY_KEY       = "dayKey";
    static final String KEY_GOAL_WORDS    = "goalWords";

    static final String CHANNEL_ID = "authno_streak";
    static final int    NOTIFICATION_ID = 4201;
    /** Distinct from every widget request code — those are keyed on widget ids. */
    static final int    ALARM_REQUEST_CODE = 91001;

    // ── JS surface ────────────────────────────────────────────────────────────

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", hasPermission(getContext()) ? "granted" : "denied");
        call.resolve(ret);
    }

    /**
     * Android 13+ shows the system prompt. Below that the permission is granted
     * at install time and this resolves straight away.
     *
     * Called when the writer switches the reminder ON, never at launch: asking
     * before anyone has written anything spends the one prompt the system
     * gives us on a feature they have not met yet.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasPermission(getContext())) {
            JSObject ret = new JSObject();
            ret.put("status", hasPermission(getContext()) ? "granted" : "denied");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "permissionCallback");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", hasPermission(getContext()) ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        Context ctx = getContext();
        int hour   = clamp(call.getInt("hour", 20), 0, 23);
        int minute = clamp(call.getInt("minute", 0), 0, 59);
        Boolean skip = call.getBoolean("skipWhenMet", Boolean.TRUE);

        prefs(ctx).edit()
                .putInt(KEY_HOUR, hour)
                .putInt(KEY_MINUTE, minute)
                .putBoolean(KEY_SKIP_WHEN_MET, skip == null || skip)
                .putBoolean(KEY_ENABLED, true)
                .apply();

        ensureChannel(ctx);
        arm(ctx);
        call.resolve();
    }

    /**
     * Post a notification immediately — what the "Send a test notification"
     * button calls.
     *
     * Deliberately goes through the same channel and the same permission a
     * scheduled reminder uses. A test that posted on its own channel could
     * come through cheerfully while the real reminder was blocked by a
     * per-channel toggle the writer had forgotten about, which would make the
     * button worse than useless: it would certify a path that does not work.
     *
     * A different notification id, though, so testing does not quietly
     * dismiss or replace a real reminder sitting on the shade.
     */
    @PluginMethod
    public void showNow(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();

        if (!hasPermission(ctx)) {
            out.put("status", "denied");
            call.resolve(out);
            return;
        }

        ensureChannel(ctx);

        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.putExtra("authnoAction", "resume");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, ALARM_REQUEST_CODE + 2,
                open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_authno)
                .setContentTitle(call.getString("title", "AuthNo"))
                .setContentText(call.getString("body", ""))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(pi);

        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID + 1, b.build());
            out.put("status", "shown");
        } catch (SecurityException e) {
            out.put("status", "denied");
        }
        call.resolve(out);
    }

    /**
     * Whether this app is exempt from battery optimisation.
     *
     * This is the difference between a reminder that arrives and one that does
     * not, on a great many devices. setInexactRepeating is a request, and
     * aggressive OEM power managers — Xiaomi, Huawei, Oppo, Samsung to a
     * lesser degree — will drop an alarm from an app they have decided is
     * idle. The writer experiences that as the feature being broken, so the
     * settings screen needs to be able to say what is actually happening.
     *
     * Reported, never demanded: this is checked so the app can explain, and
     * the request below only ever happens when somebody asks for it.
     */
    @PluginMethod
    public void checkBackgroundAllowed(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            // No such restriction existed yet, so nothing can be exempt from it.
            out.put("status", "unrestricted");
            call.resolve(out);
            return;
        }
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean ok = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        out.put("status", ok ? "unrestricted" : "restricted");
        call.resolve(out);
    }

    /**
     * Open the system screen where the writer can lift the restriction.
     *
     * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows a system dialog but
     * requires a permission Google Play treats as a policy matter, so this
     * takes the honest route: the settings list, where the choice is theirs
     * and visibly theirs. Falls back to the app's own settings page if the
     * device has no such screen.
     */
    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + ctx.getPackageName()));
                i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Exception ignored) { /* nothing else to try */ }
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        prefs(ctx).edit().putBoolean(KEY_ENABLED, false).apply();
        disarm(ctx);
        // A reminder already on the shade is stale the moment the writer turns
        // the feature off; leaving it there is the app arguing with a setting.
        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /**
     * Today's progress, stored for a receiver that will run with the app shut.
     *
     * The day key travels with it so a stale report can be recognised as stale
     * — see ReminderText.shouldNotify. Without it, a "goal met" from Tuesday
     * would silence Wednesday and every day after.
     */
    @PluginMethod
    public void reportProgress(PluginCall call) {
        Boolean met = call.getBoolean("metToday", Boolean.FALSE);
        prefs(getContext()).edit()
                .putBoolean(KEY_MET_TODAY, met != null && met)
                .putInt(KEY_STREAK_DAYS, Math.max(0, call.getInt("streakDays", 0)))
                .putInt(KEY_GOAL_WORDS, Math.max(0, call.getInt("goalWords", 0)))
                .putString(KEY_DAY_KEY, call.getString("dayKey", ""))
                .apply();
        call.resolve();
    }

    // ── Alarm plumbing, shared with BootReceiver ──────────────────────────────

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean hasPermission(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        }
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Inexact, on purpose.
     *
     * setExactAndAllowWhileIdle would need SCHEDULE_EXACT_ALARM, which on
     * Android 12+ is a special-access permission the user has to grant from a
     * settings screen. For a writing nudge that is a wildly disproportionate
     * ask: the difference between 20:00 and 20:20 does not matter, and being
     * denied the permission outright would matter a great deal.
     *
     * Repeating rather than one-shot so a phone that never opens the app again
     * still gets tomorrow's reminder.
     */
    static void arm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(KEY_ENABLED, false)) return;

        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, p.getInt(KEY_HOUR, 20));
        next.set(Calendar.MINUTE, p.getInt(KEY_MINUTE, 0));
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        // Today's slot has passed — the writer set 20:00 at 21:00, or the phone
        // just rebooted in the evening. Start tomorrow rather than firing
        // immediately, which would read as a bug.
        if (next.getTimeInMillis() <= System.currentTimeMillis()) {
            next.add(Calendar.DAY_OF_YEAR, 1);
        }

        try {
            am.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(),
                    AlarmManager.INTERVAL_DAY, alarmIntent(ctx));
        } catch (Exception ignored) {
            // OEM alarm limits — the reminder is best-effort by design.
        }
    }

    static void disarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try { am.cancel(alarmIntent(ctx)); } catch (Exception ignored) {}
    }

    /**
     * FLAG_UPDATE_CURRENT so re-scheduling moves the existing alarm rather than
     * adding a second one — otherwise changing the time twice would leave three
     * notifications a day.
     */
    private static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, ReminderReceiver.class).setAction(ReminderReceiver.ACTION_FIRE);
        return PendingIntent.getBroadcast(ctx, ALARM_REQUEST_CODE, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // DEFAULT, not HIGH: a writing nudge is not urgent, and a heads-up
        // banner interrupting whatever the reader is doing would earn the
        // whole channel a swift disable.
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Writing reminders", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("A daily nudge to write.");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.min(hi, Math.max(lo, v));
    }
}

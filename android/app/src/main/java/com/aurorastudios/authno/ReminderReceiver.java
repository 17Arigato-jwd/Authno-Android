package com.aurorastudios.authno;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Posts the daily writing reminder.
 *
 * Runs with the app closed, which shapes everything here: it cannot ask the
 * web layer anything, so it reads what RemindersPlugin.reportProgress() last
 * wrote down, and it treats that as stale unless it is stamped with today's
 * date. The decision and the wording both live in ReminderText, which imports
 * nothing from android and is therefore testable off-device.
 *
 * Registered as an explicit-intent receiver with no <intent-filter>, so it is
 * not exported and no other app can make it fire.
 */
public class ReminderReceiver extends BroadcastReceiver {

    static final String ACTION_FIRE = "com.aurorastudios.authno.STREAK_REMINDER";
    /** "morning" or "evening" — which of the configured times woke us. */
    static final String EXTRA_SLOT  = "authnoSlot";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !ACTION_FIRE.equals(intent.getAction())) return;

        SharedPreferences p = RemindersPlugin.prefs(ctx);
        if (!p.getBoolean(RemindersPlugin.KEY_ENABLED, false)) return;

        // The permission can be revoked between scheduling and firing. Posting
        // without it is a silent no-op on 13+, but checking keeps the alarm
        // from being the thing that looks broken.
        if (!RemindersPlugin.hasPermission(ctx)) return;

        boolean skipWhenMet = p.getBoolean(RemindersPlugin.KEY_SKIP_WHEN_MET, true);
        boolean metToday    = p.getBoolean(RemindersPlugin.KEY_MET_TODAY, false);
        String  reportDay   = p.getString(RemindersPlugin.KEY_DAY_KEY, "");
        int     streakDays  = p.getInt(RemindersPlugin.KEY_STREAK_DAYS, 0);
        int     goalWords   = p.getInt(RemindersPlugin.KEY_GOAL_WORDS, 0);

        // The WRITING day, matching what the app stamped the report with. A
        // goal met at 00:40 belongs to the night before; comparing it against
        // the device's date would read that report as yesterday's, treat the
        // day as unmet, and nag somebody who had just finished.
        String today = StreakWidgetProvider.writingDayKey(ctx);
        if (!ReminderText.shouldNotify(skipWhenMet, metToday, reportDay, today)) return;

        RemindersPlugin.ensureChannel(ctx);

        // Opens the app on the resume path — the reminder's whole point is
        // "start writing", so landing on the home screen would waste the tap.
        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.putExtra("authnoAction", "resume");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // Offset clear of the alarm codes, which now run from
        // ALARM_REQUEST_CODE to +MAX for the configured slots.
        PendingIntent pi = PendingIntent.getActivity(ctx, RemindersPlugin.ALARM_REQUEST_CODE + 100,
                open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // The words the app rendered for this slot, when they are from the day
        // that is being counted. utils/reminderCopy.js knows things this
        // process cannot — which book was last open, how close the goal is,
        // whether the run just hit a round number — so porting it here would
        // put the same rules in two languages and let them drift somewhere only
        // a lock screen would show it. Stale falls back to ReminderText, on the
        // same reasoning shouldNotify already uses for metToday.
        String slot = intent.getStringExtra(EXTRA_SLOT);
        String[] line = today.equals(reportDay)
                ? ReminderSlots.lineFor(p.getString(RemindersPlugin.KEY_LINES_JSON, ""), slot)
                : null;

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, RemindersPlugin.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_authno)
                .setContentTitle(line != null ? line[0] : ReminderText.title(streakDays))
                .setContentText(line != null ? line[1] : ReminderText.body(streakDays, goalWords))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(pi);

        try {
            NotificationManagerCompat.from(ctx).notify(RemindersPlugin.NOTIFICATION_ID, b.build());
        } catch (SecurityException ignored) {
            // Permission revoked between the check above and here.
        }

        // setInexactRepeating already handles tomorrow. Re-arming is for the
        // case where an OEM battery manager quietly dropped the repeat — cheap
        // insurance, and FLAG_UPDATE_CURRENT means it cannot stack a second.
        RemindersPlugin.arm(ctx);
    }

}

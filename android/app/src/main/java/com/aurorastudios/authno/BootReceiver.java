package com.aurorastudios.authno;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-arms the reminder after a restart.
 *
 * Alarms do not survive a reboot, and neither does a writer's expectation
 * that a reminder they switched on keeps arriving. Without this, the nudge
 * stops the next time the phone is restarted and never comes back until the
 * setting is toggled off and on again — which nobody would think to do,
 * because from the outside the setting still says it is on.
 *
 * Also handles the two package-replaced actions, so an app update does not
 * silently do the same thing.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        // arm() reads the stored enabled flag and returns without doing
        // anything when the reminder is off, so this needs no check of its own.
        try { RemindersPlugin.arm(ctx); } catch (Exception ignored) {}
    }
}

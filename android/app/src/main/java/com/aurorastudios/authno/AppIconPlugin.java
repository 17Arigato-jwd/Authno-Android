package com.aurorastudios.authno;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AppIconPlugin — runtime launcher-icon switching.
 *
 * The manifest declares one activity-alias per icon (IconDefault, IconLight,
 * IconRetro, IconGold), all targeting MainActivity; exactly one carries an
 * enabled LAUNCHER entry at any time. Switching = enable the chosen alias,
 * then disable the rest. DONT_KILL_APP keeps the running process alive,
 * though a few OEM launchers still close the task when its component
 * disappears — the Settings UI warns about that.
 *
 * PackageManager persists component state across reboots and app updates,
 * so there is nothing to restore at startup.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {

    private static final String[] ICONS = { "default", "light", "retro", "gold" };

    private static String aliasFor(String icon) {
        switch (icon) {
            case "light": return "IconLight";
            case "retro": return "IconRetro";
            case "gold":  return "IconGold";
            default:      return "IconDefault";
        }
    }

    private ComponentName componentFor(String icon) {
        String pkg = getContext().getPackageName();
        return new ComponentName(pkg, pkg + "." + aliasFor(icon));
    }

    @PluginMethod
    public void get(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String current = "default";
        for (String icon : ICONS) {
            int state = pm.getComponentEnabledSetting(componentFor(icon));
            // A fresh install reports DEFAULT (manifest value) for every alias,
            // which resolves to IconDefault; only an explicit ENABLED marks a
            // user-picked variant.
            if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                current = icon;
                break;
            }
        }
        JSObject ret = new JSObject();
        ret.put("icon", current);
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String icon = call.getString("icon", "default");
        boolean known = false;
        for (String k : ICONS) {
            if (k.equals(icon)) { known = true; break; }
        }
        if (!known) {
            call.reject("Unknown icon: " + icon);
            return;
        }

        PackageManager pm = getContext().getPackageManager();
        try {
            // Enable the new alias before disabling the old one so there is
            // never a moment without a LAUNCHER component — some launchers
            // drop the home-screen shortcut if they observe that gap.
            pm.setComponentEnabledSetting(componentFor(icon),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
            for (String other : ICONS) {
                if (other.equals(icon)) continue;
                pm.setComponentEnabledSetting(componentFor(other),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to switch icon: " + e.getMessage());
        }
    }
}

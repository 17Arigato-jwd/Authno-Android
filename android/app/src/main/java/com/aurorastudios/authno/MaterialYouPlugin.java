package com.aurorastudios.authno;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MaterialYouPlugin — exposes the Android 12+ dynamic colour ("Material You")
 * palette to the web layer.
 *
 * Android 12 (API 31) derives a tonal palette from the user's wallpaper and
 * publishes it as system colour resources (system_accent1_0 … _1000,
 * system_neutral1_*). This plugin reads a useful subset and returns them as
 * #RRGGBB strings; the JS side maps them onto the app's CSS-var theme system
 * (ThemeBase.applyAccent) when the "Material You colour" setting is on.
 *
 * Below API 31 → { supported: false } and the Settings toggle stays hidden.
 */
@CapacitorPlugin(name = "MaterialYou")
public class MaterialYouPlugin extends Plugin {

    private String hex(int resId) {
        int c = getContext().getColor(resId);
        return String.format("#%06X", 0xFFFFFF & c);
    }

    @PluginMethod
    public void getColors(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            ret.put("supported", false);
            call.resolve(ret);
            return;
        }
        try {
            ret.put("supported", true);
            // Accent tonal steps — 500 is the headline hue; 200/700 are the
            // light/dark leanings a theme might prefer.
            ret.put("accent",      hex(android.R.color.system_accent1_500));
            ret.put("accentLight", hex(android.R.color.system_accent1_200));
            ret.put("accentDark",  hex(android.R.color.system_accent1_700));
            // Secondary + neutral families for future surface tinting.
            ret.put("secondary",   hex(android.R.color.system_accent2_500));
            ret.put("tertiary",    hex(android.R.color.system_accent3_500));
            ret.put("neutral",     hex(android.R.color.system_neutral1_500));
            call.resolve(ret);
        } catch (Exception e) {
            // Defensive: some OEM builds have been seen missing single tones.
            ret.put("supported", false);
            call.resolve(ret);
        }
    }
}

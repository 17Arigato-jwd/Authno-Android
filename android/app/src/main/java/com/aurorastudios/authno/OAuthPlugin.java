package com.aurorastudios.authno;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabColorSchemeParams;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * OAuthPlugin — v1.2.3
 *
 * Replaces @capacitor/browser for OAuth flows (OneDrive, Dropbox, WebDAV-OIDC).
 * Uses Android Custom Tabs (androidx.browser:browser) with proper:
 *   - Browser availability check before launching (avoids silent hang)
 *   - FLAG_ACTIVITY_NEW_TASK set correctly for non-Activity context launch
 *   - No hardcoded com.android.chrome package (works on all Android browsers)
 *   - Graceful fallback to plain ACTION_VIEW if Custom Tabs unavailable
 *
 * JS usage:
 *   const result = await OAuth.openAuthUrl({ url: 'https://...' });
 *   // Resolves immediately — the actual redirect comes back via
 *   // MainActivity.handleOAuthRedirect() → __capacitor_app_url_open CustomEvent
 *
 * JS close:
 *   await OAuth.closeAuthBrowser();
 */
@CapacitorPlugin(name = "OAuth")
public class OAuthPlugin extends Plugin {

    private static final String TAG       = "OAuthPlugin";
    private static final int    TOOLBAR_COLOR = 0xFF1a1a24; // match app dark bg

    @PluginMethod
    public void openAuthUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        android.content.Context ctx = getActivity() != null
            ? getActivity()
            : getContext();

        Uri uri = Uri.parse(url);

        // ── Detect the best available Custom Tabs browser ─────────────────────
        // CustomTabsClient.getPackageName() correctly handles Android 11+ package
        // visibility — it queries for CustomTabsService, not a bare https:// intent,
        // so no <queries> entry is needed beyond the one for CustomTabsService.
        String customTabsPackage = CustomTabsClient.getPackageName(ctx, null);

        if (customTabsPackage != null) {
            // Custom Tabs available — best experience
            try {
                CustomTabColorSchemeParams darkParams = new CustomTabColorSchemeParams.Builder()
                    .setToolbarColor(TOOLBAR_COLOR)
                    .build();

                CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder()
                    .setDefaultColorSchemeParams(darkParams)
                    .setColorSchemeParams(
                        CustomTabsIntent.COLOR_SCHEME_DARK, darkParams)
                    .setShowTitle(false)
                    .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                    .setUrlBarHidingEnabled(true)
                    .build();

                // Force our chosen Custom Tabs package so we don't get a picker
                customTabsIntent.intent.setPackage(customTabsPackage);

                // FLAG_ACTIVITY_NEW_TASK is required when starting from a non-Activity
                // context. getActivity() returns an Activity here, so this is a safety net.
                customTabsIntent.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                customTabsIntent.launchUrl(ctx, uri);
                Log.d(TAG, "Custom Tabs launched via " + customTabsPackage + " for: " + url);
                call.resolve(new JSObject().put("method", "custom-tabs"));
                return;

            } catch (ActivityNotFoundException e) {
                Log.w(TAG, "Custom Tabs ActivityNotFoundException, falling back to ACTION_VIEW", e);
            }
        }

        // ── Fallback: plain ACTION_VIEW ───────────────────────────────────────
        // This works even if no Custom Tabs browser is installed.
        // We deliberately do NOT use setPackage() here so any browser can handle it.
        try {
            Intent fallbackIntent = new Intent(Intent.ACTION_VIEW, uri);
            fallbackIntent.addCategory(Intent.CATEGORY_BROWSABLE);
            fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallbackIntent);
            Log.d(TAG, "Plain ACTION_VIEW launched for: " + url);
            call.resolve(new JSObject().put("method", "action-view"));

        } catch (ActivityNotFoundException e2) {
            Log.e(TAG, "No browser available at all", e2);
            call.reject("NO_BROWSER",
                "No browser is installed on this device to handle the OAuth flow.");
        }
    }

    /**
     * Close the Custom Tab / browser started by openAuthUrl.
     * Sends a finish signal to BrowserFinishActivity which clears the back stack.
     * Called by the JS extension after the redirect is received.
     */
    @PluginMethod
    public void closeAuthBrowser(PluginCall call) {
        android.content.Context ctx = getActivity() != null
            ? getActivity()
            : getContext();

        // Start the single-purpose finisher activity that clears the browser
        Intent finishIntent = new Intent(ctx, OAuthFinishActivity.class);
        finishIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        try {
            ctx.startActivity(finishIntent);
        } catch (Exception e) {
            Log.w(TAG, "closeAuthBrowser: " + e.getMessage());
        }
        call.resolve();
    }
}

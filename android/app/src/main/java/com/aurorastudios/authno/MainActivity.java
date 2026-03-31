package com.aurorastudios.authno;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FilePickerPlugin.class);
        // ── Register the widget data bridge so React can call WidgetData.syncBooks() ──
        registerPlugin(WidgetDataPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().post(() -> {
            handleAuthBookIntent(getIntent());
            handleWidgetDeepLink(getIntent());
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        getBridge().getWebView().post(() -> {
            handleAuthBookIntent(intent);
            handleWidgetDeepLink(intent);
        });
    }

    /**
     * Handles ACTION_VIEW intents — tapping an .authbook file in a file manager.
     *
     * VCHS-ECS files are binary. We read raw bytes, base64-encode them, and
     * pass them to JS via two mechanisms:
     *
     *   1. CustomEvent via evaluateJavascript — works for warm starts (app
     *      already running), where React's listeners are already registered.
     *
     *   2. FilePickerPlugin static fields — fallback for cold starts, where the
     *      WebView may not have finished loading when this runs.  App.js calls
     *      FilePickerPlugin.getPendingIntent() on mount to retrieve the data.
     *
     * Using both ensures the file is always loaded regardless of timing.
     */
    private void handleAuthBookIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        try {
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return;

            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
            is.close();

            String base64  = Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
            String uriStr  = uri.toString().replace("'", "\\'");

            // Store for cold-start retrieval (App.js polls getPendingIntent() on mount).
            FilePickerPlugin.pendingBase64 = base64;
            FilePickerPlugin.pendingUri    = uriStr;

            // Also dispatch immediately — handles warm starts where React is already live.
            // JS will call storage.openBookFromBytes(base64, uri) which handles
            // both legacy JSON and new VCHS-ECS binary, then fires the event.
            String js =
                "window.dispatchEvent(new CustomEvent('open-authbook-android-bytes', {" +
                "  detail: { base64: '" + base64 + "', uri: '" + uriStr + "' }" +
                "}))";
            getBridge().getWebView().evaluateJavascript(js, null);

        } catch (Exception e) {
            String js = "window.dispatchEvent(new CustomEvent('open-authbook-android-error'))";
            getBridge().getWebView().evaluateJavascript(js, null);
        }
    }

    /**
     * Handles taps on the home-screen Streak Widget.
     *
     * The widget puts a "widgetBookId" extra on the launch intent.
     * We forward it to the React layer as a CustomEvent so App.js can navigate
     * straight to that book's editor.
     *
     * React side — add this listener in App.js (see widgetBridge.js):
     *   window.addEventListener('open-book-from-widget', e => {
     *     handleSelect(e.detail.bookId);
     *   });
     */
    private void handleWidgetDeepLink(Intent intent) {
        if (intent == null) return;
        String bookId = intent.getStringExtra("widgetBookId");
        if (bookId == null || bookId.isEmpty()) return;

        // Clear the extra so rotating the screen doesn't re-fire it
        intent.removeExtra("widgetBookId");

        String safeId = bookId.replace("'", "\\'");
        String js =
            "window.dispatchEvent(new CustomEvent('open-book-from-widget', {" +
            "  detail: { bookId: '" + safeId + "' }" +
            "}))";
        getBridge().getWebView().evaluateJavascript(js, null);
    }
}

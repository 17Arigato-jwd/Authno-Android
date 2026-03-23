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
        super.onCreate(savedInstanceState);
        getBridge().getWebView().post(() -> handleAuthBookIntent(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        getBridge().getWebView().post(() -> handleAuthBookIntent(intent));
    }

    /**
     * Handles ACTION_VIEW intents — tapping an .authbook file in a file manager.
     *
     * VCHS-ECS files are binary. We read raw bytes, base64-encode them, and
     * pass them to JS via a CustomEvent. The JS side (storage.js) detects the
     * format, runs migration if it is a legacy JSON file, then dispatches the
     * decoded session into App.js via the existing 'open-authbook-android' event.
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
}

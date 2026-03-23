package com.aurorastudios.authno;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register our SAF file-picker plugin BEFORE super.onCreate()
        registerPlugin(FilePickerPlugin.class);

        super.onCreate(savedInstanceState);

        // Handle .authbook file opened via file-manager intent
        getBridge().getWebView().post(() -> handleAuthBookIntent(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        getBridge().getWebView().post(() -> handleAuthBookIntent(intent));
    }

    /**
     * Handles ACTION_VIEW intents (tapping an .authbook in a file manager).
     * Reads the file content and fires the same 'open-authbook-android' event
     * that App.js already listens for — no JS changes needed for this path.
     */
    private void handleAuthBookIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;

        Uri uri = intent.getData();
        if (uri == null) return;

        try {
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return;

            InputStreamReader reader = new InputStreamReader(is, StandardCharsets.UTF_8);
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) != -1) sb.append(buf, 0, n);
            is.close();

            // Escape for safe embedding in JS template literal
            String json = sb.toString()
                            .replace("\\", "\\\\")
                            .replace("`", "\\`");

            // Inject the URI so App.js can store it as filePath for future saves
            String js =
                "window.dispatchEvent(new CustomEvent('open-authbook-android', {" +
                "  detail: { ...JSON.parse(`" + json + "`), filePath: '" + uri.toString() + "' }" +
                "}))";
            getBridge().getWebView().evaluateJavascript(js, null);

        } catch (Exception e) {
            String js = "window.dispatchEvent(new CustomEvent('open-authbook-android-error'))";
            getBridge().getWebView().evaluateJavascript(js, null);
        }
    }
}

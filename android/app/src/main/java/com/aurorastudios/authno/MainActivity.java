package com.aurorastudios.authno;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import org.json.JSONObject;
import android.webkit.WebResourceResponse;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * MainActivity — v1.2.0-alpha.1
 *
 * Changes from v1.1.14:
 *   - shouldInterceptRequest() serves AuthNo/extensions/* files over HTTP so
 *     the JS layer can use native ES dynamic import() for extension code.
 *     Without this, import('https://localhost/extensions/cloud-backup/index.js')
 *     returns a 404 and the extension never activates.
 *   - Added OAuth redirect URI intent handling for the @capacitor/browser flow.
 *     The custom scheme com.aurorastudios.authno:/oauth2/* is caught here and
 *     forwarded to JS via App.addListener('appUrlOpen', ...) so GDrive /
 *     Dropbox / OneDrive PKCE flows can complete.
 *   - All other behaviour is unchanged.
 */
public class MainActivity extends BridgeActivity {

    // Root of Capacitor's internal files directory — resolved once on create
    private File internalFilesDir;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FilePickerPlugin.class);
        registerPlugin(WidgetDataPlugin.class);
        registerPlugin(ExtbkAssetsPlugin.class);
        // v1.2.3: native auth plugins replacing @capacitor/browser OAuth
        registerPlugin(GoogleSignInPlugin.class);
        registerPlugin(GoogleDrivePlugin.class);   // v1.3.0: Drive scope via Identity Authorization API
        registerPlugin(OAuthPlugin.class);
        super.onCreate(savedInstanceState);

        internalFilesDir = getFilesDir();

        // Intercept https://localhost/extensions/* to serve extension files
        getBridge().getWebView().setWebViewClient(new com.getcapacitor.BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    android.webkit.WebView view, WebResourceRequest request) {

                Uri uri = request.getUrl();
                if (uri != null && "localhost".equals(uri.getHost())) {
                    String path = uri.getPath();
                    if (path != null && path.startsWith("/extensions/")) {
                        // Strip leading slash, resolve relative to internal files
                        // Full path: <filesDir>/AuthNo/extensions/<ext-id>/some/file.js
                        String relativePath = "AuthNo" + path; // path starts with /extensions/
                        File target = new File(internalFilesDir, relativePath);

                        // 3B (security): canonicalise and confirm the resolved
                        // file is still under the extensions root. Without this,
                        // a request like /extensions/../../databases/x escaped
                        // the sandbox and could read any app-private file over
                        // the WebView's own origin.
                        try {
                            String extRoot = new File(internalFilesDir, "AuthNo/extensions").getCanonicalPath() + File.separator;
                            String resolved = target.getCanonicalPath();
                            if (!resolved.startsWith(extRoot)) {
                                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                                        new HashMap<>(),
                                        new ByteArrayInputStream("Path traversal blocked".getBytes()));
                            }
                        } catch (Exception e) {
                            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                                    new HashMap<>(),
                                    new ByteArrayInputStream("Path resolution failed".getBytes()));
                        }

                        if (target.exists() && target.isFile()) {
                            try {
                                String mime = guessMime(target.getName());
                                Map<String, String> headers = new HashMap<>();
                                headers.put("Access-Control-Allow-Origin", "*");
                                headers.put("Cache-Control", "no-store");

                                InputStream is = new FileInputStream(target);
                                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, is);
                            } catch (Exception e) {
                                return new WebResourceResponse("text/plain", "UTF-8", 500, "Internal Error",
                                        new HashMap<>(),
                                        new ByteArrayInputStream(
                                                ("Error serving extension file: " + e.getMessage()).getBytes()));
                            }
                        }

                        // File not found — return 404 so JS import() rejects cleanly
                        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                                new HashMap<>(),
                                new ByteArrayInputStream("Extension file not found".getBytes()));
                    }
                }

                return super.shouldInterceptRequest(view, request);
            }
        });

        getBridge().getWebView().post(() -> {
            handleAuthBookIntent(getIntent());
            handleExtbkIntent(getIntent());
            handleThmbkIntent(getIntent());
            handleWidgetDeepLink(getIntent());
            handleOAuthRedirect(getIntent());  // NEW: catch cold-start OAuth returns
        });
    }

    // ── Suppress the native text-selection toolbar (B5) ──────────────────────
    // The WebView's floating Cut/Copy/"Search DuckDuckGo" ActionMode fought the
    // app's own selection menu (which adds Add-to-Thread, quick formatting and
    // themed clipboard actions). Web code cannot extend or hide that toolbar,
    // so it is dismissed here the moment it starts; the selection itself (and
    // its drag handles) remain fully functional and the JS layer shows its own
    // menu. Long-press paste at a bare caret is also covered by the JS menu.
    @Override
    public void onActionModeStarted(android.view.ActionMode mode) {
        super.onActionModeStarted(mode);
        try { mode.finish(); } catch (Exception ignored) { }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        getBridge().getWebView().post(() -> {
            handleAuthBookIntent(intent);
            handleExtbkIntent(intent);
            handleThmbkIntent(intent);
            handleWidgetDeepLink(intent);
            handleOAuthRedirect(intent);       // NEW: catch warm-start OAuth returns
        });
    }

    // ── OAuth redirect handler ────────────────────────────────────────────────
    //
    // When the browser finishes an OAuth flow it redirects to:
    //   com.aurorastudios.authno:/oauth2/gdrive?code=...&state=...
    //
    // Android delivers this as an ACTION_VIEW intent to MainActivity (singleTask).
    // We forward the full URL to Capacitor's App plugin listener so the JS-side
    // provider code can extract the auth code and exchange it for a token.

    private void handleOAuthRedirect(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        String scheme = uri.getScheme();
        if (!"com.aurorastudios.authno".equals(scheme)) return;

        // Forward to JS. 3E: JSONObject.quote() produces a fully escaped JS
        // string literal — the old single-quote-only escaping could be broken
        // out of by a backslash or newline in the value.
        String js =
            "window.dispatchEvent(new CustomEvent('__capacitor_app_url_open', {" +
            "  detail: { url: " + JSONObject.quote(uri.toString()) + " }" +
            "}));";
        getBridge().getWebView().evaluateJavascript(js, null);
    }

    // ── .authbook file intent ─────────────────────────────────────────────────

    private void handleAuthBookIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        String uriLower = uri.toString().toLowerCase();
        String mime = intent.getType();
        if (uriLower.endsWith(".extbk") || uriLower.contains(".extbk?")
                || "application/x-extbk".equals(mime)) return;
        if (uriLower.endsWith(".thmbk") || uriLower.contains(".thmbk?")
                || "application/x-thmbk".equals(mime)) return; // themes go to handleThmbkIntent

        try {
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return;

            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
            is.close();

            String base64  = Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
            String uriStr  = uri.toString();

            FilePickerPlugin.pendingBase64 = base64;
            FilePickerPlugin.pendingUri    = uriStr;

            // Large books: don't shove multi-MB base64 through evaluateJavascript
            // (string building + bridge limits). JS pulls it via the pending-intent
            // plugin call instead; only signal the event.
            String js;
            if (base64.length() > 2_000_000) {
                js = "window.dispatchEvent(new CustomEvent('open-authbook-android-pending'))";
            } else {
                js = "window.dispatchEvent(new CustomEvent('open-authbook-android-bytes', {" +
                     "  detail: { base64: " + JSONObject.quote(base64) + ", uri: " + JSONObject.quote(uriStr) + " }" +
                     "}))";
            }
            getBridge().getWebView().evaluateJavascript(js, null);

        } catch (Exception e) {
            String js = "window.dispatchEvent(new CustomEvent('open-authbook-android-error'))";
            getBridge().getWebView().evaluateJavascript(js, null);
        }
    }

    // ── .extbk extension install intent ──────────────────────────────────────

    private void handleExtbkIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;

        android.net.Uri uri = intent.getData();
        if (uri == null) return;

        String uriStr = uri.toString().toLowerCase();
        if (!uriStr.endsWith(".extbk") && !uriStr.contains(".extbk?")) {
            String mime = intent.getType();
            if (mime == null || !mime.equals("application/x-extbk")) return;
        }

        try {
            java.io.InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) { dispatchExtbkError("Could not open file stream"); return; }

            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
            is.close();

            String base64 = Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
            FilePickerPlugin.pendingExtbkBase64 = base64;
            FilePickerPlugin.pendingExtbkKind   = "extension";

            String js =
                "window.dispatchEvent(new CustomEvent('install-extbk-bytes', {" +
                "  detail: { base64: " + JSONObject.quote(base64) + " }" +
                "}))";
            getBridge().getWebView().evaluateJavascript(js, null);

        } catch (Exception e) {
            dispatchExtbkError(e.getMessage() != null ? e.getMessage() : "Unknown error");
        }
    }


    // ── .thmbk theme install intent (U4) ─────────────────────────────────────
    // Same container as .extbk; JS installs it via themeLoader.installThmbkBytes
    // and the InstallSheet renders staged progress.

    private void handleThmbkIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;

        android.net.Uri uri = intent.getData();
        if (uri == null) return;

        String uriStr = uri.toString().toLowerCase();
        if (!uriStr.endsWith(".thmbk") && !uriStr.contains(".thmbk?")) {
            String mime = intent.getType();
            if (mime == null || !mime.equals("application/x-thmbk")) return;
        }

        try {
            java.io.InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) { dispatchExtbkError("Could not open theme file stream"); return; }

            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
            is.close();

            String base64 = Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
            FilePickerPlugin.pendingExtbkBase64 = base64;
            FilePickerPlugin.pendingExtbkKind   = "theme";

            String js =
                "window.dispatchEvent(new CustomEvent('install-thmbk-bytes', {" +
                "  detail: { base64: " + JSONObject.quote(base64) + " }" +
                "}))";
            getBridge().getWebView().evaluateJavascript(js, null);

        } catch (Exception e) {
            dispatchExtbkError(e.getMessage() != null ? e.getMessage() : "Unknown error");
        }
    }

    private void dispatchExtbkError(String message) {
        String js =
            "window.dispatchEvent(new CustomEvent('install-extbk-error', {" +
            "  detail: { message: " + JSONObject.quote(message) + " }" +
            "}))";
        getBridge().getWebView().evaluateJavascript(js, null);
    }

    // ── Widget deep-link ──────────────────────────────────────────────────────

    private void handleWidgetDeepLink(Intent intent) {
        if (intent == null) return;
        String bookId = intent.getStringExtra("widgetBookId");
        if (bookId == null || bookId.isEmpty()) return;

        intent.removeExtra("widgetBookId");

        String js =
            "window.dispatchEvent(new CustomEvent('open-book-from-widget', {" +
            "  detail: { bookId: " + JSONObject.quote(bookId) + " }" +
            "}))";
        getBridge().getWebView().evaluateJavascript(js, null);
    }

    // ── MIME type helper ──────────────────────────────────────────────────────

    private static String guessMime(String filename) {
        if (filename == null) return "application/octet-stream";
        String lower = filename.toLowerCase();
        if (lower.endsWith(".js")   || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".json"))                           return "application/json";
        if (lower.endsWith(".css"))                            return "text/css";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".svg"))                            return "image/svg+xml";
        if (lower.endsWith(".png"))                            return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }
}

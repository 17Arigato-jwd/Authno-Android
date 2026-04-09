package com.aurorastudios.authno;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * AuthnoFilePicker — SAF wrapper for VCHS-ECS .authbook files
 *
 * Exposes five methods to JS:
 *   createDocument(fileName)       → "Save As" picker  → { uri }
 *   openDocument()                 → "Open" picker     → { uri, base64, name, size }
 *   writeBytesToUri(uri, base64)   → write binary to existing SAF URI
 *   readBytesFromUri(uri)          → read binary from existing SAF URI → { base64 }
 *   getPendingIntent()             → retrieve a file opened via cold-start intent
 *                                    → { hasPending, base64?, uri? }
 *
 * All file content crosses the JS/Java bridge as base64 because VCHS-ECS files
 * are binary and the Capacitor bridge only carries JSON-serialisable types.
 *
 * Compatible with Capacitor 5 and 6.
 */
@CapacitorPlugin(name = "AuthnoFilePicker")
public class FilePickerPlugin extends Plugin {

    /**
     * Cold-start pending intent storage.
     *
     * When the app is launched by tapping an .authbook file (ACTION_VIEW), the
     * WebView may not have finished loading by the time MainActivity tries to
     * dispatch the CustomEvent via evaluateJavascript — meaning the event fires
     * before React's listeners are registered and is silently lost.
     *
     * To fix this, MainActivity also stores the file data here.  App.js calls
     * getPendingIntent() on mount (after all useEffect listeners are registered)
     * to pick up any file that arrived during the cold-start race window.
     * The data is cleared once retrieved so it is only processed once.
     */
    static volatile String pendingBase64 = null;
    static volatile String pendingUri    = null;

    // ── Pending cold-start intent ──────────────────────────────────────────

    /**
     * Called by App.js on mount to retrieve a file that was opened via a
     * cold-start ACTION_VIEW intent (tapping an .authbook in a file manager
     * or share sheet while the app was not running).
     *
     * Returns { hasPending: true, base64, uri } if data is waiting, or
     * { hasPending: false } if nothing is pending.  Clears the stored data
     * atomically so the file is never processed twice.
     */
    @PluginMethod
    public void getPendingIntent(PluginCall call) {
        String b64 = pendingBase64;
        String uri = pendingUri;
        // Clear before resolving so a second call always returns hasPending=false
        pendingBase64 = null;
        pendingUri    = null;

        JSObject ret = new JSObject();
        if (b64 != null) {
            ret.put("hasPending", true);
            ret.put("base64", b64);
            ret.put("uri",    uri != null ? uri : "");
        } else {
            ret.put("hasPending", false);
        }
        call.resolve(ret);
    }

    // ── Create Document (Save As) ──────────────────────────────────────────

    @PluginMethod
    public void createDocument(PluginCall call) {
        String fileName = call.getString("fileName", "Untitled.authbook");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "handleCreateDocument");
    }

    @ActivityCallback
    private void handleCreateDocument(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                persistPermission(uri);
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                call.resolve(ret);
                return;
            }
        }
        call.resolve(); // user cancelled — JS checks for missing uri
    }

    // ── Open Document ──────────────────────────────────────────────────────

    @PluginMethod
    public void openDocument(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "handleOpenDocument");
    }

    @ActivityCallback
    private void handleOpenDocument(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                persistPermission(uri);
                try {
                    byte[] bytes  = readAllBytes(uri);
                    String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                    JSObject ret  = new JSObject();
                    ret.put("uri",    uri.toString());
                    ret.put("base64", base64);
                    ret.put("name",   getDisplayName(uri));
                    ret.put("size",   (long) bytes.length);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Failed to read file: " + e.getMessage());
                }
                return;
            }
        }
        call.resolve();
    }

    // ── Write binary bytes to existing URI ────────────────────────────────

    @PluginMethod
    public void writeBytesToUri(PluginCall call) {
        String uriStr = call.getString("uri");
        String base64 = call.getString("base64");
        if (uriStr == null || base64 == null) { call.reject("uri and base64 required"); return; }
        try {
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            ParcelFileDescriptor pfd = getActivity().getContentResolver()
                    .openFileDescriptor(Uri.parse(uriStr), "wt");
            if (pfd == null) throw new Exception("Could not open file descriptor");
            try (FileOutputStream fos = new FileOutputStream(pfd.getFileDescriptor())) {
                fos.write(bytes);
            }
            pfd.close();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) { call.reject("Write failed: " + e.getMessage()); }
    }

    // ── Check if URI is still accessible ──────────────────────────────────

    @PluginMethod
    public void checkUri(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) { call.reject("uri required"); return; }
        try {
            ParcelFileDescriptor pfd = getActivity().getContentResolver()
                    .openFileDescriptor(Uri.parse(uriStr), "r");
            if (pfd == null) throw new Exception("null descriptor");
            pfd.close();
            JSObject ret = new JSObject();
            ret.put("accessible", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("accessible", false);
            ret.put("reason", e.getMessage());
            call.resolve(ret);
        }
    }


    // ── Read binary bytes from existing URI ───────────────────────────────

    @PluginMethod
    public void readBytesFromUri(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) { call.reject("uri required"); return; }
        try {
            byte[] bytes  = readAllBytes(Uri.parse(uriStr));
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject ret  = new JSObject();
            ret.put("base64", base64);
            call.resolve(ret);
        } catch (Exception e) { call.reject("Read failed: " + e.getMessage()); }
    }

    // ── All-files-access (MANAGE_EXTERNAL_STORAGE, API 30+) ───────────────

    /**
     * Returns { granted: true } if the app already holds
     * Environment.isExternalStorageManager() on API 30+, or if the device
     * is below API 30 (where the permission is not required).
     */
    @PluginMethod
    public void checkFullStoragePermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ret.put("granted", Environment.isExternalStorageManager());
        } else {
            ret.put("granted", true);
        }
        call.resolve(ret);
    }

    /**
     * Opens the system Settings page for ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION
     * so the user can toggle "Allow management of all files" for this app.
     * Falls back to the generic ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION page if
     * the per-app URI is not supported.
     *
     * JS should call checkFullStoragePermission() again after the user returns
     * to the app (e.g. in onResume / App.appStateChange listener) to read the
     * updated value.
     */
    @PluginMethod
    public void requestFullStoragePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                && !Environment.isExternalStorageManager()) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getActivity().getPackageName()));
                getActivity().startActivity(intent);
            } catch (Exception e) {
                // Fallback: some OEM ROMs don't support the per-app URI
                try {
                    getActivity().startActivity(
                            new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                } catch (Exception ignored) {}
            }
        }
        JSObject ret = new JSObject();
        ret.put("opened", true);
        call.resolve(ret);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private void persistPermission(Uri uri) {
        try {
            getActivity().getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {}
    }

    private byte[] readAllBytes(Uri uri) throws Exception {
        try (InputStream is = getActivity().getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("InputStream null for " + uri);
            return drain(is);
        }
    }

    private byte[] drain(InputStream is) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }

    private String getDisplayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getActivity().getContentResolver().query(
                    uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) return c.getString(idx);
                }
            } catch (Exception ignored) {}
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "unknown.authbook";
    }
}

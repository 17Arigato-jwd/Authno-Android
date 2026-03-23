package com.aurorastudios.authno;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
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
 * Exposes four methods to JS:
 *   createDocument(fileName)          → "Save As" picker  → { uri }
 *   openDocument()                    → "Open" picker     → { uri, base64, name }
 *   writeBytesToUri(uri, base64)       → write binary to existing SAF URI
 *   readBytesFromUri(uri)             → read binary from existing SAF URI → { base64 }
 *
 * All file content crosses the JS/Java bridge as base64 because VCHS-ECS files
 * are binary and the Capacitor bridge only carries JSON-serialisable types.
 *
 * FIX NOTE: ActivityResult is imported from androidx.activity.result, NOT from
 * com.getcapacitor. com.getcapacitor.ActivityResult was removed in Capacitor 5.
 * This file is compatible with Capacitor 5 and 6.
 */
@CapacitorPlugin(name = "AuthnoFilePicker")
public class FilePickerPlugin extends Plugin {

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
        if (uriStr == null || base64 == null) {
            call.reject("Both 'uri' and 'base64' are required");
            return;
        }
        Uri uri = Uri.parse(uriStr);
        try {
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            // "wt" = write + truncate — fully replaces the file
            ParcelFileDescriptor pfd = getActivity()
                    .getContentResolver().openFileDescriptor(uri, "wt");
            if (pfd == null) throw new Exception("Could not open file descriptor");
            try (FileOutputStream fos = new FileOutputStream(pfd.getFileDescriptor())) {
                fos.write(bytes);
            }
            pfd.close();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    // ── Read binary bytes from existing URI ───────────────────────────────

    @PluginMethod
    public void readBytesFromUri(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) { call.reject("'uri' is required"); return; }
        Uri uri = Uri.parse(uriStr);
        try {
            byte[] bytes  = readAllBytes(uri);
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject ret  = new JSObject();
            ret.put("base64", base64);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private void persistPermission(Uri uri) {
        try {
            getActivity().getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) { }
    }

    private byte[] readAllBytes(Uri uri) throws Exception {
        try (InputStream is = getActivity().getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("InputStream is null");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
            return buf.toByteArray();
        }
    }

    private String getDisplayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getActivity().getContentResolver().query(
                    uri, new String[]{ OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) return cursor.getString(idx);
                }
            } catch (Exception ignored) { }
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "unknown.authbook";
    }
}

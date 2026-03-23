package com.aurorastudios.authno;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * AuthnoFilePicker
 *
 * Wraps Android's Storage Access Framework so that JS can:
 *   - createDocument(fileName)  → show "Save As" system picker → returns { uri }
 *   - openDocument()            → show "Open" system picker   → returns { uri, content, name }
 *   - writeToUri(uri, content)  → overwrite an existing SAF URI (no picker)
 *   - readFromUri(uri)          → read an existing SAF URI (no picker)
 *
 * SAF URIs are persistent across app restarts once
 * takePersistableUriPermission() is called.
 */
@CapacitorPlugin(name = "AuthnoFilePicker")
public class FilePickerPlugin extends Plugin {

    // ── Create Document (Save As) ─────────────────────────────────────────

    @PluginMethod
    public void createDocument(PluginCall call) {
        String fileName = call.getString("fileName", "Untitled.authbook");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");                          // avoids MIME-type lock-in
        intent.putExtra(Intent.EXTRA_TITLE, fileName);  // pre-fill the filename field

        startActivityForResult(call, intent, "handleCreateDocument");
    }

    @ActivityCallback
    private void handleCreateDocument(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                // Persist read+write permission so future writes need no picker
                getActivity().getContentResolver().takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                call.resolve(ret);
                return;
            }
        }
        // User cancelled — resolve with no data so JS can detect cancellation
        call.resolve();
    }

    // ── Open Document ─────────────────────────────────────────────────────

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
                // Persist read+write permission for future opens/saves
                getActivity().getContentResolver().takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
                try {
                    String content = readUri(uri);
                    JSObject ret = new JSObject();
                    ret.put("uri", uri.toString());
                    ret.put("content", content);
                    ret.put("name", getFileName(uri));
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Failed to read file: " + e.getMessage());
                }
                return;
            }
        }
        // User cancelled
        call.resolve();
    }

    // ── Write to existing URI (no picker) ─────────────────────────────────

    @PluginMethod
    public void writeToUri(PluginCall call) {
        String uriStr  = call.getString("uri");
        String content = call.getString("content");

        if (uriStr == null || content == null) {
            call.reject("Both 'uri' and 'content' are required");
            return;
        }

        Uri uri = Uri.parse(uriStr);
        try {
            // "wt" = write + truncate, so we replace the whole file
            ParcelFileDescriptor pfd = getActivity().getContentResolver()
                .openFileDescriptor(uri, "wt");
            if (pfd == null) throw new Exception("Could not open descriptor");

            try (FileOutputStream fos = new FileOutputStream(pfd.getFileDescriptor());
                 OutputStreamWriter writer = new OutputStreamWriter(fos, StandardCharsets.UTF_8)) {
                writer.write(content);
            }
            pfd.close();

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    // ── Read from existing URI (no picker) ────────────────────────────────

    @PluginMethod
    public void readFromUri(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("'uri' is required");
            return;
        }
        Uri uri = Uri.parse(uriStr);
        try {
            String content = readUri(uri);
            JSObject ret = new JSObject();
            ret.put("content", content);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    private String readUri(Uri uri) throws Exception {
        try (InputStream is = getActivity().getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("Stream is null");
            byte[] bytes = is.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    private String getFileName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getActivity().getContentResolver().query(
                    uri, new String[]{ OpenableColumns.DISPLAY_NAME },
                    null, null, null)) {
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

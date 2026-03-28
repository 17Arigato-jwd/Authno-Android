package com.aurorastudios.authno;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * AuthnoFilePicker — SAF + MediaStore wrapper for .authbook files.
 *
 * Methods exposed to JS:
 *   createDocument(fileName)         → SAF "Save As" picker     → { uri }
 *   openDocument()                   → SAF "Open" picker        → { uri, base64, name }
 *   writeBytesToUri(uri, base64)     → overwrite SAF URI
 *   readBytesFromUri(uri)            → read SAF URI             → { base64 }
 *   listPersistedBooks()             → all previously-granted URIs ending in .authbook
 *                                      → { files: [{ uri, base64, size, lastModified }] }
 *   scanForAuthbooks()               → MediaStore-wide scan     → { files: [...] }
 *   checkStoragePermission()         → { status: 'granted'|'denied'|'prompt' }
 *   requestStoragePermission()       → { status: 'granted'|'denied' }
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
        call.resolve();
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

    // ── List Persisted Books (Phase 1 of On-Device scan) ──────────────────
    //
    // Reads ContentResolver.getPersistedUriPermissions() — every URI the user
    // has ever opened or saved via SAF in this app.  No extra permission needed.
    // Returns instantly. This is the PRIMARY source for the On Device tab.

    @PluginMethod
    public void listPersistedBooks(PluginCall call) {
        new Thread(() -> {
            JSArray filesArray = new JSArray();
            try {
                ContentResolver cr = getActivity().getContentResolver();
                List<UriPermission> perms = cr.getPersistedUriPermissions();
                for (UriPermission perm : perms) {
                    Uri uri = perm.getUri();
                    String uriStr = uri.toString();
                    // Filter: only .authbook files
                    String displayName = getDisplayName(uri);
                    if (!displayName.endsWith(".authbook")) continue;

                    try {
                        byte[] bytes    = readAllBytes(uri);
                        String base64   = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        long   size     = bytes.length;
                        long   modified = perm.getPersistedTime(); // ms since epoch

                        JSObject entry = new JSObject();
                        entry.put("uri",          uriStr);
                        entry.put("name",         displayName);
                        entry.put("base64",       base64);
                        entry.put("size",         size);
                        entry.put("lastModified", modified);
                        filesArray.put(entry);
                    } catch (Exception ignored) {
                        // URI no longer accessible (file deleted) — skip it
                    }
                }
            } catch (Exception e) {
                // Return whatever we gathered so far
            }

            final JSArray finalArray = filesArray;
            getActivity().runOnUiThread(() -> {
                JSObject ret = new JSObject();
                ret.put("files", finalArray);
                call.resolve(ret);
            });
        }).start();
    }

    // ── Scan For Authbooks (Phase 2 — MediaStore broad scan) ──────────────
    //
    // Uses MediaStore.Files to find .authbook files anywhere on the device.
    // On API 33+ works without any extra permission.
    // On API ≤32 requires READ_EXTERNAL_STORAGE (declared in manifest).
    //
    // Does NOT return files already covered by listPersistedBooks(); the JS
    // layer de-duplicates anyway but skipping them here saves bandwidth.

    @PluginMethod
    public void scanForAuthbooks(PluginCall call) {
        new Thread(() -> {
            JSArray filesArray = new JSArray();
            Set<String> seen = new HashSet<>();

            // Collect persisted URIs so we can skip them
            try {
                for (UriPermission p : getActivity().getContentResolver().getPersistedUriPermissions()) {
                    seen.add(p.getUri().toString());
                }
            } catch (Exception ignored) {}

            try {
                ContentResolver cr = getActivity().getContentResolver();

                // MediaStore.Files query — works on API 29+ without special perms
                Uri collection;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
                } else {
                    collection = MediaStore.Files.getContentUri("external");
                }

                String[] projection = {
                    MediaStore.Files.FileColumns._ID,
                    MediaStore.Files.FileColumns.DISPLAY_NAME,
                    MediaStore.Files.FileColumns.SIZE,
                    MediaStore.Files.FileColumns.DATE_MODIFIED,
                };
                String selection     = MediaStore.Files.FileColumns.DISPLAY_NAME + " LIKE ?";
                String[] selArgs     = { "%.authbook" };
                String sortOrder     = MediaStore.Files.FileColumns.DATE_MODIFIED + " DESC";

                try (Cursor cursor = cr.query(collection, projection, selection, selArgs, sortOrder)) {
                    if (cursor != null) {
                        int idCol       = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID);
                        int nameCol     = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME);
                        int sizeCol     = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE);
                        int modifiedCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED);

                        int count = 0;
                        while (cursor.moveToNext() && count < 200) {
                            long   id       = cursor.getLong(idCol);
                            String name     = cursor.getString(nameCol);
                            long   size     = cursor.getLong(sizeCol);
                            long   modified = cursor.getLong(modifiedCol) * 1000L; // s → ms

                            Uri fileUri = Uri.withAppendedPath(collection, String.valueOf(id));
                            String uriStr = fileUri.toString();

                            // Skip already-persisted files (Phase 1 covered them)
                            if (seen.contains(uriStr)) continue;
                            // Skip large files (probably not an authbook)
                            if (size > 50 * 1024 * 1024) continue;

                            try {
                                byte[] bytes  = readAllBytes(fileUri);
                                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

                                JSObject entry = new JSObject();
                                entry.put("uri",          uriStr);
                                entry.put("name",         name != null ? name : "unknown.authbook");
                                entry.put("base64",       base64);
                                entry.put("size",         size);
                                entry.put("lastModified", modified);
                                filesArray.put(entry);
                                count++;
                            } catch (Exception ignored) { /* unreadable */ }
                        }
                    }
                }
            } catch (Exception e) {
                // Return whatever was gathered — MediaStore may not be available
            }

            final JSArray finalArray = filesArray;
            getActivity().runOnUiThread(() -> {
                JSObject ret = new JSObject();
                ret.put("files", finalArray);
                call.resolve(ret);
            });
        }).start();
    }

    // ── Check Storage Permission ───────────────────────────────────────────

    @PluginMethod
    public void checkStoragePermission(PluginCall call) {
        String status;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ — MANAGE_EXTERNAL_STORAGE for full access
            if (Environment.isExternalStorageManager()) {
                status = "granted";
            } else {
                // READ_EXTERNAL_STORAGE still works for scoped access on API 30-32
                int perm = ContextCompat.checkSelfPermission(
                        getContext(), Manifest.permission.READ_EXTERNAL_STORAGE);
                status = (perm == PackageManager.PERMISSION_GRANTED) ? "granted" : "prompt";
            }
        } else {
            int perm = ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.READ_EXTERNAL_STORAGE);
            if (perm == PackageManager.PERMISSION_GRANTED) {
                status = "granted";
            } else if (getActivity().shouldShowRequestPermissionRationale(
                    Manifest.permission.READ_EXTERNAL_STORAGE)) {
                status = "prompt";
            } else {
                status = "denied";
            }
        }
        JSObject ret = new JSObject();
        ret.put("status", status);
        call.resolve(ret);
    }

    // ── Request Storage Permission ─────────────────────────────────────────

    @PluginMethod
    public void requestStoragePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ — open "Allow all file access" settings page
            try {
                Intent intent = new Intent(
                        android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getActivity().getPackageName())
                );
                startActivityForResult(call, intent, "handleStoragePermissionResult");
            } catch (Exception e) {
                // Fallback: open generic Manage All Files settings
                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                startActivityForResult(call, intent, "handleStoragePermissionResult");
            }
        } else {
            // Android ≤10 — runtime permission dialog
            requestPermissionForAlias("publicStorage", call, "handleLegacyStoragePermissionResult");
        }
    }

    @ActivityCallback
    private void handleStoragePermissionResult(PluginCall call, ActivityResult result) {
        // User returned from settings — re-check
        String status = Environment.isExternalStorageManager() ? "granted" : "denied";
        JSObject ret = new JSObject();
        ret.put("status", status);
        call.resolve(ret);
    }

    @PluginMethod
    public void handleLegacyStoragePermissionResult(PluginCall call) {
        int perm = ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.READ_EXTERNAL_STORAGE);
        String status = (perm == PackageManager.PERMISSION_GRANTED) ? "granted" : "denied";
        JSObject ret = new JSObject();
        ret.put("status", status);
        call.resolve(ret);
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
            if (is == null) throw new Exception("InputStream is null for " + uri);
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

package com.aurorastudios.authno;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.ContentUris;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "AuthnoFilePicker")
public class FilePickerPlugin extends Plugin {

    // ── Create Document ────────────────────────────────────────────────────

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

    // ── Write Bytes ────────────────────────────────────────────────────────

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

    // ── Read Bytes ─────────────────────────────────────────────────────────

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

    // ── Phase 1: List Persisted SAF URIs (instant, no permission needed) ──
    // Every file the user ever opened/saved via SAF already has a persistent
    // content:// grant. This is the primary source — returns immediately.

    @PluginMethod
    public void listPersistedBooks(PluginCall call) {
        new Thread(() -> {
            JSArray files = new JSArray();
            try {
                List<UriPermission> perms = getActivity()
                        .getContentResolver().getPersistedUriPermissions();
                for (UriPermission perm : perms) {
                    Uri uri = perm.getUri();
                    String name = getDisplayName(uri);
                    if (!name.toLowerCase().endsWith(".authbook")) continue;
                    try {
                        byte[] bytes = readAllBytes(uri);
                        JSObject entry = new JSObject();
                        entry.put("uri",          uri.toString());
                        entry.put("name",         name);
                        entry.put("base64",       Base64.encodeToString(bytes, Base64.NO_WRAP));
                        entry.put("size",         (long) bytes.length);
                        entry.put("lastModified", perm.getPersistedTime());
                        files.put(entry);
                    } catch (Exception ignored) {}
                }
            } catch (Exception ignored) {}

            final JSArray result = files;
            getActivity().runOnUiThread(() -> {
                JSObject ret = new JSObject();
                ret.put("files", result);
                call.resolve(ret);
            });
        }).start();
    }

    // ── Phase 2: Full Device Scan (MANAGE_EXTERNAL_STORAGE) ───────────────
    // Recursive walk of external storage. Requires All Files Access on API 30+.
    // Skips files already covered by Phase 1 (JS deduplicates by URI anyway).

    @PluginMethod
    public void scanWithMediaStore(PluginCall call) {
        new Thread(() -> {
            JSArray files = new JSArray();
            Uri collection = MediaStore.Files.getContentUri("external");
            String[] projection = {
                MediaStore.Files.FileColumns._ID,
                MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.SIZE,
                MediaStore.Files.FileColumns.DATE_MODIFIED,
            };
            // Filter by extension — MediaStore doesn't have a MIME type for .authbook,
            // so match by display name suffix.
            String selection  = MediaStore.Files.FileColumns.DISPLAY_NAME + " LIKE ?";
            String[] selArgs  = { "%.authbook" };
            String sortOrder  = MediaStore.Files.FileColumns.DATE_MODIFIED + " DESC";

            try (Cursor c = getActivity().getContentResolver().query(
                    collection, projection, selection, selArgs, sortOrder)) {
                if (c != null) {
                    int idCol   = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID);
                    int nameCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME);
                    int sizeCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE);
                    int dateCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED);
                    while (c.moveToNext()) {
                        Uri uri = ContentUris.withAppendedId(collection, c.getLong(idCol));
                        try {
                            byte[] bytes = readAllBytes(uri);
                            JSObject entry = new JSObject();
                            entry.put("uri",          uri.toString());   // content:// — works with writeBytesToUri
                            entry.put("name",         c.getString(nameCol));
                            entry.put("base64",       Base64.encodeToString(bytes, Base64.NO_WRAP));
                            entry.put("size",         c.getLong(sizeCol));
                            entry.put("lastModified", c.getLong(dateCol) * 1000L);
                            files.put(entry);
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}

            final JSArray result = files;
            getActivity().runOnUiThread(() -> {
                JSObject ret = new JSObject();
                ret.put("files", result);
                call.resolve(ret);
            });
        }).start();
    }

    @PluginMethod
    public void scanForAuthbooks(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                call.reject("Permission denied: All Files Access not granted");
                return;
            }
        }

        // Collect persisted URIs to skip re-reading them
        Set<String> persistedPaths = new HashSet<>();
        try {
            for (UriPermission p : getActivity().getContentResolver().getPersistedUriPermissions()) {
                String seg = p.getUri().getLastPathSegment();
                if (seg != null) persistedPaths.add(seg);
            }
        } catch (Exception ignored) {}

        new Thread(() -> {
            JSArray files = new JSArray();
            recursiveSearch(Environment.getExternalStorageDirectory(), files, persistedPaths, new int[]{0});

            final JSArray result = files;
            getActivity().runOnUiThread(() -> {
                JSObject ret = new JSObject();
                ret.put("files", result);
                call.resolve(ret);
            });
        }).start();
    }

    private void recursiveSearch(File dir, JSArray out, Set<String> skip, int[] count) {
        if (count[0] >= 200) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File f : children) {
            if (count[0] >= 200) return;
            if (f.isDirectory()) {
                String n = f.getName();
                // Skip hidden dirs, Android system dirs, and common junk folders
                if (!n.startsWith(".") && !n.equalsIgnoreCase("Android")
                        && !n.equalsIgnoreCase("lost+found")) {
                    recursiveSearch(f, out, skip, count);
                }
            } else if (f.getName().toLowerCase().endsWith(".authbook")) {
                if (f.length() > 50 * 1024 * 1024) continue; // skip >50 MB
                // Skip if already in persisted list
                if (skip.contains(f.getAbsolutePath())) continue;
                try {
                    Uri uri    = Uri.fromFile(f);
                    byte[] bytes = readAllBytesFile(f);
                    JSObject entry = new JSObject();
                    entry.put("uri",          uri.toString());
                    entry.put("name",         f.getName());
                    entry.put("base64",       Base64.encodeToString(bytes, Base64.NO_WRAP));
                    entry.put("size",         f.length());
                    entry.put("lastModified", f.lastModified());
                    out.put(entry);
                    count[0]++;
                } catch (Exception ignored) {}
            }
        }
    }

    // ── Check Storage Permission ───────────────────────────────────────────

    @PluginMethod
    public void checkStoragePermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ret.put("status", Environment.isExternalStorageManager() ? "granted" : "denied");
        } else {
            int perm = ContextCompat.checkSelfPermission(getContext(),
                    Manifest.permission.READ_EXTERNAL_STORAGE);
            ret.put("status", perm == PackageManager.PERMISSION_GRANTED ? "granted" : "prompt");
        }
        call.resolve(ret);
    }

    // ── Request Storage Permission ─────────────────────────────────────────

    @PluginMethod
    public void requestStoragePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (Environment.isExternalStorageManager()) {
                JSObject ret = new JSObject();
                ret.put("status", "granted");
                call.resolve(ret);
                return;
            }
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, intent, "handlePermissionResult");
        } else {
            // API ≤29 — READ_EXTERNAL_STORAGE runtime dialog
            // Just resolve granted on older devices where scoped storage isn't enforced
            JSObject ret = new JSObject();
            int perm = ContextCompat.checkSelfPermission(getContext(),
                    Manifest.permission.READ_EXTERNAL_STORAGE);
            ret.put("status", perm == PackageManager.PERMISSION_GRANTED ? "granted" : "denied");
            call.resolve(ret);
        }
    }

    @ActivityCallback
    private void handlePermissionResult(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ret.put("status", Environment.isExternalStorageManager() ? "granted" : "denied");
        } else {
            ret.put("status", "granted");
        }
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

    private byte[] readAllBytesFile(File f) throws Exception {
        try (InputStream is = new java.io.FileInputStream(f)) {
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

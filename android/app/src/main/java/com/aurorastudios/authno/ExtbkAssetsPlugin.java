package com.aurorastudios.authno;

import android.content.res.AssetManager;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * ExtbkAssetsPlugin — v1.1.14
 *
 * Exposes bundled .extbk files from android/app/src/main/assets/extensions/
 * to the JS layer so seedPreinstalledExtensions() can install them on first
 * launch without shipping them inside the web bundle.
 *
 * Methods
 * -------
 *   list()              → { files: string[] }   — filenames in assets/extensions/
 *   read({ filename })  → { base64: string }     — base64 bytes of the named file
 *
 * Security
 * --------
 *   read() validates that filename contains only safe characters and ends with
 *   .extbk, preventing path traversal into other asset subdirectories.
 */
@CapacitorPlugin(name = "ExtbkAssets")
public class ExtbkAssetsPlugin extends Plugin {

    private static final String ASSETS_DIR = "extensions";

    /**
     * List all .extbk filenames available in assets/extensions/.
     *
     * Returns { files: [] } (empty array) if the directory does not exist,
     * so callers never need to handle an error case for a missing asset dir.
     */
    @PluginMethod
    public void list(PluginCall call) {
        try {
            AssetManager am = getContext().getAssets();
            String[] entries;
            try {
                entries = am.list(ASSETS_DIR);
            } catch (IOException e) {
                // Directory doesn't exist in this build — that's fine
                JSObject result = new JSObject();
                result.put("files", new JSArray());
                call.resolve(result);
                return;
            }

            JSArray files = new JSArray();
            if (entries != null) {
                for (String entry : entries) {
                    if (entry.endsWith(".extbk")) {
                        files.put(entry);
                    }
                }
            }

            JSObject result = new JSObject();
            result.put("files", files);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("ExtbkAssetsPlugin.list failed: " + e.getMessage(), e);
        }
    }

    /**
     * Read a single .extbk file from assets/extensions/ and return its
     * bytes as a base64 string.
     *
     * @param call.filename — must match /^[\w.-]+\.extbk$/ (path traversal guard)
     */
    @PluginMethod
    public void read(PluginCall call) {
        String filename = call.getString("filename", "");

        // Path traversal guard — only allow simple filenames, no slashes or dots that
        // could escape the extensions/ directory.
        if (filename == null || filename.isEmpty() || !filename.endsWith(".extbk")
                || !filename.matches("^[\\w.\\-]+\\.extbk$")) {
            call.reject("Invalid filename: " + filename);
            return;
        }

        try {
            AssetManager am = getContext().getAssets();
            InputStream is  = am.open(ASSETS_DIR + "/" + filename);

            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
            is.close();

            String base64 = Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);

            JSObject result = new JSObject();
            result.put("base64", base64);
            call.resolve(result);

        } catch (IOException e) {
            call.reject("ExtbkAssetsPlugin.read: file not found: " + filename, e);
        } catch (Exception e) {
            call.reject("ExtbkAssetsPlugin.read failed: " + e.getMessage(), e);
        }
    }
}

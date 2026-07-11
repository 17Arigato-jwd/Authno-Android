package com.aurorastudios.authno;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * AppShortcutsPlugin — long-press launcher-icon shortcuts.
 *
 * JS keeps the dynamic list fresh (the "Continue: <book>" label follows the
 * last-written book). Both shortcuts launch MainActivity with an
 * authnoAction extra, which MainActivity forwards to the web app as an
 * 'authno-launch-action' event — the same path the widget button uses.
 */
@CapacitorPlugin(name = "AppShortcuts")
public class AppShortcutsPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        if (Build.VERSION.SDK_INT < 25) { call.resolve(); return; }

        String lastBookId    = call.getString("lastBookId", "");
        String lastBookTitle = call.getString("lastBookTitle", "");

        Context ctx = getContext();
        ShortcutManager sm = ctx.getSystemService(ShortcutManager.class);
        if (sm == null) { call.resolve(); return; }

        List<ShortcutInfo> shortcuts = new ArrayList<>();

        if (lastBookId != null && !lastBookId.isEmpty()) {
            // ACTION_MAIN (not VIEW) so MainActivity's file-association
            // handlers never mistake this launch for a document open.
            Intent resume = new Intent(ctx, MainActivity.class);
            resume.setAction(Intent.ACTION_MAIN);
            resume.putExtra("authnoAction", "resume");
            resume.putExtra("authnoBookId", lastBookId);

            String label = (lastBookTitle == null || lastBookTitle.isEmpty())
                    ? "Continue writing"
                    : "Continue: " + lastBookTitle;
            if (label.length() > 25) label = label.substring(0, 24) + "…";

            shortcuts.add(new ShortcutInfo.Builder(ctx, "authno_resume")
                    .setShortLabel(label)
                    .setLongLabel(label)
                    .setIcon(Icon.createWithResource(ctx, R.drawable.ic_flame_gradient))
                    .setIntent(resume)
                    .build());
        }

        Intent newBook = new Intent(ctx, MainActivity.class);
        newBook.setAction(Intent.ACTION_MAIN);
        newBook.putExtra("authnoAction", "new-book");
        shortcuts.add(new ShortcutInfo.Builder(ctx, "authno_new_book")
                .setShortLabel("New book")
                .setLongLabel("Start a new book")
                .setIcon(Icon.createWithResource(ctx, R.drawable.ic_book_gradient))
                .setIntent(newBook)
                .build());

        try {
            sm.setDynamicShortcuts(shortcuts);
        } catch (Exception ignored) {
            // Launcher rate limits / disabled shortcuts — best-effort.
        }
        call.resolve();
    }
}

// linuxIconTheme.js — make the app-icon switcher reach the Linux launcher.
//
// The relaunch path in main.js already swaps the WINDOW/taskbar icon (the
// BrowserWindow `icon:` option). But the applications menu / dash / dock shows
// the icon named by the installed `.desktop` file's `Icon=` key, not the
// window icon — so on GNOME/KDE the launcher entry keeps the default icon.
//
// This module writes a PER-USER `.desktop` override (no root needed) at
// ~/.local/share/applications/<name>.desktop, copied from the system entry with
// only the `Icon=` line repointed at the chosen art. update-desktop-database /
// xdg-desktop-menu are nudged afterwards (best-effort). Picking "default" again
// removes the override so the packaged entry (and its icon) return.
//
// Caveats that are inherent to Linux, not bugs:
//   • A bare AppImage that was never integrated has no system .desktop to copy,
//     so there's nothing to override — we return {skipped:'no-system-desktop'}.
//   • GNOME Wayland reads the icon from this .desktop (good — that's exactly
//     what we rewrite); some environments cache aggressively and only refresh
//     the dash on next login.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function xdgDataHome() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

// The system-installed .desktop we base the override on, so Exec / Name /
// StartupWMClass stay correct. Searches XDG_DATA_DIRS (deb/rpm install into
// /usr/share/applications). Returns null when none is found.
function findSystemDesktop(desktopName) {
  const roots = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
  for (const root of roots) {
    if (!root) continue;
    const p = path.join(root, "applications", desktopName);
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return null;
}

// Replace (or insert) the Icon= line inside the [Desktop Entry] group only.
function rewriteIconLine(contents, iconValue) {
  const lines = contents.split(/\r?\n/);
  const out = [];
  let inEntry = false, wrote = false;
  for (const line of lines) {
    if (/^\[.*\]\s*$/.test(line)) {
      if (inEntry && !wrote) { out.push(`Icon=${iconValue}`); wrote = true; }
      inEntry = /^\[Desktop Entry\]\s*$/.test(line);
      out.push(line);
      continue;
    }
    if (inEntry && /^Icon\s*=/.test(line)) { out.push(`Icon=${iconValue}`); wrote = true; continue; }
    out.push(line);
  }
  if (inEntry && !wrote) out.push(`Icon=${iconValue}`);
  return out.join("\n");
}

function refreshCaches(appsDir) {
  // Never block on these — the tools may be absent, and desktops rescan anyway.
  const run = (cmd, args) => { try { execFile(cmd, args, () => {}); } catch { /* ignore */ } };
  run("update-desktop-database", [appsDir]);
  run("xdg-desktop-menu", ["forceupdate"]);
}

/**
 * Apply (id !== 'default') or clear (id === 'default') the per-user launcher
 * icon override. `iconSourcePath` is an absolute PNG for the chosen icon.
 * Returns a small status object; callers treat any non-ok as "best effort".
 */
function applyLinuxLauncherIcon({ id, iconSourcePath, desktopName }) {
  if (process.platform !== "linux") return { ok: false, skipped: "not-linux" };
  try {
    const dataHome = xdgDataHome();
    const appsDir = path.join(dataHome, "applications");
    const overridePath = path.join(appsDir, desktopName);

    // "default" → drop our override so the packaged entry + icon come back.
    if (!id || id === "default") {
      try { fs.rmSync(overridePath, { force: true }); } catch { /* ignore */ }
      refreshCaches(appsDir);
      return { ok: true, cleared: true };
    }

    const system = findSystemDesktop(desktopName);
    if (!system) return { ok: false, skipped: "no-system-desktop" };
    if (!iconSourcePath || !fs.existsSync(iconSourcePath)) {
      return { ok: false, skipped: "no-icon-source" };
    }

    const iconsDir = path.join(dataHome, "authno", "icons");
    fs.mkdirSync(appsDir, { recursive: true });
    fs.mkdirSync(iconsDir, { recursive: true });

    // Per-id filename so the launcher sees a genuinely new icon path (a stable
    // path with changed bytes is frequently served stale from the icon cache).
    const iconDest = path.join(iconsDir, `app-icon-${id}.png`);
    fs.copyFileSync(iconSourcePath, iconDest);

    const overridden = rewriteIconLine(fs.readFileSync(system, "utf8"), iconDest);
    fs.writeFileSync(overridePath, overridden);
    try { fs.chmodSync(overridePath, 0o755); } catch { /* not fatal */ }

    refreshCaches(appsDir);
    return { ok: true, desktop: overridePath, icon: iconDest };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

module.exports = { applyLinuxLauncherIcon };

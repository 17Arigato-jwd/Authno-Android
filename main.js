// main.js
const { app, BrowserWindow, Menu, ipcMain, nativeImage, Notification } = require("electron");

// Windows shows nothing at all for a notification from an app with no
// AppUserModelId — no error, no toast, no entry in the Action Center. It must
// match the installer's appId (package.json → build.appId) or the toast is
// attributed to an app the shell has never heard of and is dropped. Harmless
// on macOS and Linux, which ignore it.
if (process.platform === "win32") app.setAppUserModelId("com.aurorastudios.authno");
const path = require("path");
const fs = require("fs");
const { applyLinuxLauncherIcon } = require("./linuxIconTheme");
// Basename of the installed .desktop entry (see package.json > desktopName).
let DESKTOP_NAME = "authno.desktop";
try { DESKTOP_NAME = require("./package.json").desktopName || DESKTOP_NAME; } catch { /* keep default */ }

const { SCHEMES, deepLinkFromArgv, isAuthnoLink } = require("./deepLink");

let mainWindow;
let openFilePath = null;

// A deep link that arrived before there was a window to hand it to.
//
// This is the cold-start case and it is the common one: clicking "Open AuthNo?"
// in a browser when the app is not running LAUNCHES it, so the URL is in argv
// before `ready` has fired, let alone before the renderer has mounted a
// listener. Dropping it there would mean the flow that works when the app is
// already open silently fails when it is not — which is exactly the state
// somebody signing in for the first time is in.
let pendingDeepLink = null;   // { url, at }

const isLinux = process.platform === "linux";

// ── Process diet ─────────────────────────────────────────────────────────────
// The app is a single window with its own title bar and shortcut system, so
// the default application menu (and its accelerator table) is pure overhead.
Menu.setApplicationMenu(null);
//
// NOTE: beta.4 also forced `in-process-gpu` on Windows to shave a process.
// It caused a blank-screen hang on fresh Windows 11 machines (compositing
// stalls with certain default GPU drivers), so it's removed — a robust boot
// beats one fewer process. The dedicated GPU process (Chromium default) is
// back. If GPU compositing itself is broken on a machine, the environment
// variable AUTHNO_DISABLE_GPU=1 falls back to software rendering.
if (process.env.AUTHNO_DISABLE_GPU === "1") app.disableHardwareAcceleration();

// ── App icon switcher (desktop) ──────────────────────────────────────────────
// Maps the icon ids used by the renderer to the on-disk assets. Persisted in
// userData so the choice survives restarts (a desktop analogue of Android's
// activity-alias switcher).
const ICON_ASSETS = {
  default: "authno-512.png",
  light:   "app-icons/ic_launcher_light.png",
  retro:   "app-icons/ic_launcher_retro.png",
  gold:    "app-icons/ic_launcher_gold.png",
};
function iconPrefPath() {
  try { return path.join(app.getPath("userData"), "app-icon.json"); } catch { return null; }
}
function readIconPref() {
  try { return JSON.parse(fs.readFileSync(iconPrefPath(), "utf8")).icon || "default"; }
  catch { return "default"; }
}
function writeIconPref(id) {
  try { fs.writeFileSync(iconPrefPath(), JSON.stringify({ icon: id })); } catch { /* best-effort */ }
}

// ── Resolve a .authbook path from launch argv (Windows/Linux cold start) ──
// The old code never inspected process.argv on first launch, so double-clicking
// a .authbook while the app was closed opened an empty window (v1 A1). Skip the
// Electron flags and the app path; take the first real .authbook argument.
/**
 * Keep the app window showing the app, and keep the web on the web.
 *
 * Electron's defaults are the opposite of what an app wants, and both halves
 * were measured here rather than assumed:
 *
 *   - `window.open('https://…')` does not open a browser. It creates a second
 *     BrowserWindow loading that URL inside AuthNo — no address bar, no
 *     padlock, the app's own icon on it. The renderer calls window.open in
 *     three places, one of them the extension `openBrowser` capability that an
 *     OAuth flow depends on. Providers refuse embedded user agents (Google
 *     answers `disallowed_useragent`), and a `com.aurorastudios.authno://`
 *     redirect fired inside that window never reaches the app — so the promise
 *     waiting on it sits there for its full five-minute timeout and the writer
 *     is looking at a consent screen that cannot finish.
 *
 *   - `location.href = 'https://…'` navigates the app window away from the
 *     app. Measured: the window was left on the remote page, with no way back
 *     short of restarting, and no chrome to tell you where you are.
 *
 * So: deny both, and hand https to the real browser through the same
 * `shell.openExternal` policy the `open-external` IPC handler uses. Anything
 * that is not https is dropped — openExternal on a `file://` or a custom
 * scheme can launch a local program.
 *
 * Same-page navigation (the SPA's own routing, hash changes, reloads) is
 * untouched: `will-navigate` does not fire for those.
 */
function openInRealBrowser(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:") return false;
    const { shell } = require("electron");
    shell.openExternal(u.toString());
    return true;
  } catch {
    return false;
  }
}

/** True for the app's own document — the dev server, or the packaged bundle. */
function isAppUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === "file:") return true;
    return process.env.NODE_ENV === "development"
      && u.origin === "http://localhost:3000";
  } catch {
    return false;
  }
}

function guardNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    openInRealBrowser(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openInRealBrowser(url);
  });

  // Extension UI runs in an iframe, and a frame is a webContents of its own
  // the moment one is created. Without this the guards above cover the top
  // document only, which is the half that was never the risk.
  contents.on("did-attach-webview", (_e, attached) => guardNavigation(attached));
}

function authbookFromArgv(argv) {
  return (argv || []).find(
    (a) => typeof a === "string" && a.toLowerCase().endsWith(".authbook") && fs.existsSync(a)
  ) || null;
}
if (!openFilePath) openFilePath = authbookFromArgv(process.argv.slice(1));

// ── authno:// — the desktop half of Google sign-in ───────────────────────────
//
// The gate already ends that round trip by redirecting to
// authno://auth/google?google=<handoff>; that branch has been live since
// Android shipped and needs no change to serve desktop as well. All this side
// has to do is claim the scheme and find the URL again afterwards.
//
// Unpackaged, Electron must be told what to launch or it registers ITSELF as
// the handler — clicking the link then opens a bare Electron with no app in it,
// which looks like the scheme is broken rather than like a dev-mode quirk.
try {
  for (const scheme of SCHEMES) {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(scheme);
    }
  }
} catch (e) {
  // A locked-down machine can refuse the registry write. The flow degrades to
  // the paste-the-address fallback rather than failing at the moment of use.
  console.error("[deep link] could not register the authno:// scheme", e);
}

/**
 * Hand a deep link to the renderer, or hold it until there is one.
 *
 * `did-finish-load` is not enough on its own: the window can exist and have
 * loaded while React has not yet mounted the listener. The renderer asks for
 * anything outstanding once it is ready (see the deep-link-ready channel), so
 * a URL is delivered by whichever of the two happens second.
 */
function deliverDeepLink(url) {
  if (!isAuthnoLink(url)) return;
  pendingDeepLink = { url, at: Date.now() };
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("deep-link", url);
}

// Cold start: the URL is in our own argv.
{
  const initial = deepLinkFromArgv(process.argv.slice(1));
  if (initial) pendingDeepLink = { url: initial, at: Date.now() };
}

// macOS never uses argv for this. Harmless to register on the other two, and
// it is one line against the day a mac build exists.
app.on("open-url", (event, url) => {
  event.preventDefault();
  deliverDeepLink(url);
});

// The renderer asks once it is listening, which closes the cold-start race
// from the other end: whichever of the two arrives second delivers the URL.
ipcMain.handle("deep-link-ready", () => {
  const held = pendingDeepLink;
  pendingDeepLink = null;
  if (!held) return null;
  // Anything older than the handoff inside it is worse than nothing: a second
  // sign-in attempt would claim the FIRST attempt's URL, exchange a handoff
  // that is already spent, and fail instantly — while the link it was actually
  // waiting for was still on its way. Sixty seconds is the handoff's own life,
  // so a link this stale could not have worked anyway.
  if (Date.now() - held.at > 60 * 1000) return null;
  return held.url;
});

// Whether the OS actually accepted the registration.
//
// Worth knowing which half did the accepting, because the two platforms do it
// differently and the difference is not symmetric:
//
//   Linux    the .deb and .rpm write MimeType=x-scheme-handler/<scheme> into
//            the .desktop entry — electron-builder's `protocols` block does
//            this — AND setAsDefaultProtocolClient runs above. Belt and braces.
//   Windows  the installer does NOTHING. electron-builder has no NSIS path for
//            protocols at all; the schema even calls the option macOS-only.
//            The registry keys under HKCU\Software\Classes come from the
//            setAsDefaultProtocolClient call above and from nowhere else, so
//            deleting it as redundant would take Windows deep links with it.
//
// It can still fail: a managed machine can refuse the registry write, another
// program can already hold the scheme, and a binary run out of a checkout has
// no installed entry behind it. When it did not take, the sign-in screen
// offers "paste the address you were sent to" rather than waiting for a link
// that is never coming.
ipcMain.handle("deep-link-registered", () => {
  // The app's own scheme is the one sign-in needs. The OAuth scheme is asked
  // for separately, because an extension can want one without the other.
  try { return app.isDefaultProtocolClient(SCHEMES[0]); } catch { return false; }
});

// 🟢 Handle file open (macOS — fired before app is ready)
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  openFilePath = filePath;
  if (mainWindow) sendParsedFile(mainWindow, filePath);
});

// ── Read a .authbook and hand the renderer the RAW BYTES ──
// The .authbook format is binary (VCHS-ECS), NOT JSON. The old JSON.parse here
// failed on every real file — desktop open was broken (D2). We read bytes and
// let the renderer's decode path (which already handles the binary format,
// legacy JSON, and Reed-Solomon repair) do the parsing, exactly like Android.
function readAuthbookBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString("base64");
}
function sendParsedFile(win, filePath) {
  try {
    win.webContents.send("open-authbook-bytes", {
      base64: readAuthbookBase64(filePath),
      filePath,
    });
  } catch (err) {
    console.error("❌ Failed to read authbook:", err);
    win.webContents.send("open-authbook-error", { message: String(err && err.message || err) });
  }
}

// ── Renderer calls this on mount to pick up any file the app was launched with ──
ipcMain.handle("get-pending-file", () => {
  if (!openFilePath) return null;
  try {
    const result = { base64: readAuthbookBase64(openFilePath), filePath: openFilePath };
    openFilePath = null; // clear so it isn't delivered twice
    return result;
  } catch (err) {
    console.error("❌ get-pending-file failed:", err);
    return null;
  }
});

// 🟢 Ensure single instance (Windows/Linux)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, argv) => {
    // Warm start. Windows and Linux launch a second process holding the URL
    // and single-instance forwards its argv here; this is the same hook the
    // .authbook file association already uses, and one argv can carry both.
    const link = deepLinkFromArgv(argv);
    if (link) deliverDeepLink(link);

    const filePath = authbookFromArgv(argv);
    if (filePath && mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      sendParsedFile(mainWindow, filePath);
    }
  });

  // ── Custom title-bar window controls (frameless window) ───────────────────
  ipcMain.on("window-minimize", () => { mainWindow?.minimize(); });
  ipcMain.on("window-maximize-toggle", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => { mainWindow?.close(); });
  ipcMain.handle("window-is-maximized", () => !!(mainWindow && mainWindow.isMaximized()));

  // ── App icon switcher IPC ──────────────────────────────────────────────────
  // nativeImage.createFromPath can't read through an app.asar archive, so in a
  // packaged build it returned an EMPTY image and setIcon silently no-op'd
  // (the reported "PC fails to switch app icon"). Read the bytes via fs — which
  // Electron patches for asar — and build the image from the buffer instead.
  function iconImage(id) {
    const asset = ICON_ASSETS[id] || ICON_ASSETS.default;
    try {
      const buf = fs.readFileSync(resolveAsset(asset));
      const img = nativeImage.createFromBuffer(buf);
      return img.isEmpty() ? null : img;
    } catch { return null; }
  }
  // Icon to bake into the window at creation. A live setIcon() doesn't reliably
  // refresh the Windows taskbar / running icon, so the chosen icon is applied by
  // relaunching (see set-app-icon-relaunch) — and on that fresh launch the window
  // is created WITH the icon here, so it shows up everywhere from the start.
  function startupIconOption() {
    const id = readIconPref();
    if (id && id !== "default") {
      const img = iconImage(id);
      if (img) return img;
    }
    return resolveAsset("authno.ico");
  }
  // On Linux the window icon isn't what the app menu / dash shows — that's the
  // installed .desktop's Icon=. Mirror the pick into a per-user .desktop
  // override so the launcher icon changes too (best-effort; see linuxIconTheme).
  function syncLinuxLauncherIcon(id) {
    if (!isLinux) return;
    try {
      const res = applyLinuxLauncherIcon({
        id,
        iconSourcePath: resolveAsset(ICON_ASSETS[id] || ICON_ASSETS.default),
        desktopName: DESKTOP_NAME,
      });
      if (res && res.ok === false && res.error) console.error("[linux launcher icon]", res.error);
    } catch (e) { console.error("[linux launcher icon]", e); }
  }

  // Open a URL in the OS browser. Renderer-supplied URLs are untrusted, so this
  // hard-refuses anything that isn't https — shell.openExternal on a file:// or
  // custom-scheme URL can launch local programs.
  // ── Desktop notification ──────────────────────────────────────────────────
  // Windows needs an AppUserModelId set before a notification will show at
  // all (see app.setAppUserModelId near startup); Linux needs a running
  // notification daemon, which most desktops have and a bare WM may not.
  // isSupported() answers both, and answering "unsupported" honestly is more
  // use to the settings screen than a silent no-op.
  ipcMain.handle("notify", (_e, msg) => {
    try {
      if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
      const title = String(msg?.title || "AuthNo");
      const body = String(msg?.body || "");
      const n = new Notification({ title, body, silent: false });
      // Clicking it should bring the app back — a reminder you cannot act on
      // from the notification is a reminder that costs you the trip anyway.
      n.on("click", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      });
      n.show();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  });

  ipcMain.handle("open-external", async (_e, url) => {
    try {
      const u = new URL(String(url));
      if (u.protocol !== "https:") return { ok: false, error: "blocked-scheme" };
      const { shell } = require("electron");
      await shell.openExternal(u.toString());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle("get-app-icon", () => readIconPref());
  ipcMain.handle("set-app-icon", (_e, id) => {
    try {
      const norm = id in ICON_ASSETS ? id : "default";
      const img = iconImage(id);
      if (img && mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(img);
      writeIconPref(norm);
      syncLinuxLauncherIcon(norm);
      return { ok: !!img };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // Persist the pick and relaunch so the new icon takes effect everywhere
  // (window + taskbar + running icon). This is the desktop path the renderer
  // uses — a live swap looked flaky on Windows (reported). On Linux we also
  // rewrite the launcher .desktop icon before relaunching.
  ipcMain.handle("set-app-icon-relaunch", (_e, id) => {
    try {
      const norm = id in ICON_ASSETS ? id : "default";
      writeIconPref(norm);
      syncLinuxLauncherIcon(norm);
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  function resolveAsset(name) {
    // In a packaged build, public/ is unpacked next to the app resources; in
    // dev it's at the project root. Try both so splash + icon always resolve
    // (D2: previously public/ wasn't packaged and these silently 404'd).
    const candidates = [
      path.join(__dirname, "public", name),
      path.join(process.resourcesPath || "", "public", name),
      path.join(__dirname, "build", name),
    ];
    return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[0];
  }

  function createWindow() {
    // No splash window any more. It was a SECOND Chromium renderer process:
    // the reported "blank box -> white -> gradient -> late logo" staging was
    // that process spawning, painting pre-CSS, then fetching its logo <img> —
    // and the real app regularly finished booting before it did. Its job is
    // now done by the inline boot splash in index.html (zero extra requests,
    // paints with the renderer's first frame) plus the instant themed window
    // below.
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      // Show only once the renderer has painted its first frame (ready-to-show),
      // never before. beta.4 showed the Windows window immediately, which on a
      // fresh/slow machine surfaced a blank dark window that "hung" while the
      // renderer loaded. A watchdog below force-shows it if ready-to-show is
      // slow, so the app can never sit invisibly forever either.
      show: false,
      // Frameless — the app draws its own themed title bar (see TitleBar.jsx).
      // This is what makes the desktop app stop looking like "a website in a
      // window". Still resizable; dragging is handled via -webkit-app-region.
      frame: false,
      titleBarStyle: "hidden",
      // Bake the user's chosen icon in at creation so it shows in the taskbar
      // and window from the first frame (esp. after an icon-change relaunch).
      icon: startupIconOption(),
      // Linux: a transparent frameless window lets the renderer paint rounded
      // corners (the app root has border-radius). Windows 11 already rounds
      // frameless windows via DWM, and transparency there disables the drop
      // shadow, so it's Linux-only.
      transparent: isLinux,
      // Matches the app's dark background so the pre-renderer window is a
      // seamless part of the boot sequence, not a white/black flash.
      backgroundColor: isLinux ? "#00000000" : "#060606",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "Preload.js"), // safe — after handlers registered
      },
    });

    // (The chosen icon is baked in via the `icon` option above — no post-create
    // setIcon needed, which also avoids the flaky Windows taskbar refresh.)

    guardNavigation(mainWindow.webContents);

    // Notify the renderer's title bar when the maximise state changes so it can
    // swap the maximise/restore glyph.
    mainWindow.on("maximize",   () => { if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("window-maximized", true); });
    mainWindow.on("unmaximize", () => { if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("window-maximized", false); });

    if (process.env.NODE_ENV === "development") {
      mainWindow.loadURL("http://localhost:3000");
      mainWindow.webContents.openDevTools();
    } else {
      mainWindow.loadFile(path.join(__dirname, "build", "index.html"));
    }

    // Show once the renderer is ready to paint (the inline boot splash in
    // index.html appears the moment the window does — no blank window). A
    // watchdog guarantees the window surfaces even if ready-to-show never
    // fires (a hung/failed renderer), so the app is never invisible forever.
    let shown = false;
    const reveal = () => {
      if (shown || !mainWindow || mainWindow.isDestroyed()) return;
      shown = true;
      mainWindow.show();
    };
    mainWindow.once("ready-to-show", reveal);
    const watchdog = setTimeout(reveal, 10000);

    // Surface a hard load failure instead of hanging on a blank window.
    mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      if (code === -3) return; // ERR_ABORTED — a benign in-flight nav, ignore
      console.error(`[AuthNo] renderer failed to load (${code}): ${desc}`);
      reveal();
    });

    mainWindow.on("closed", () => { clearTimeout(watchdog); mainWindow = null; });
  }

  // ✅ Properly wait for app ready, THEN load fileManager, THEN create window
  app.whenReady().then(() => {
    console.log("🟢 App ready — loading fileManager...");
    require("./fileManager"); // register handlers now
    console.log("✅ FileManager registered handlers.");
    createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

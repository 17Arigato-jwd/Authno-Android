// main.js
const { app, BrowserWindow, Menu, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let openFilePath = null;

const isLinux = process.platform === "linux";

// ── Process diet ─────────────────────────────────────────────────────────────
// The app is a single window with its own title bar and shortcut system, so
// the default application menu (and its accelerator table) is pure overhead.
Menu.setApplicationMenu(null);
// Windows: run the GPU service inside the main process instead of spawning a
// dedicated GPU process — one fewer Chromium process (~50-80 MB). Kept off
// Linux where in-process GPU is flaky across drivers.
if (process.platform === "win32") app.commandLine.appendSwitch("in-process-gpu");

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
function authbookFromArgv(argv) {
  return (argv || []).find(
    (a) => typeof a === "string" && a.toLowerCase().endsWith(".authbook") && fs.existsSync(a)
  ) || null;
}
if (!openFilePath) openFilePath = authbookFromArgv(process.argv.slice(1));

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
  ipcMain.handle("get-app-icon", () => readIconPref());
  ipcMain.handle("set-app-icon", (_e, id) => {
    try {
      const img = iconImage(id);
      if (img && mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(img);
      writeIconPref(id in ICON_ASSETS ? id : "default");
      return { ok: !!img };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // Persist the pick and relaunch so the new icon takes effect everywhere
  // (window + taskbar + running icon). This is the desktop path the renderer
  // uses — a live swap looked flaky on Windows (reported).
  ipcMain.handle("set-app-icon-relaunch", (_e, id) => {
    try {
      writeIconPref(id in ICON_ASSETS ? id : "default");
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
      // Windows: show immediately — the window appears the instant the OS can
      // draw it, painted in the theme background colour until the renderer's
      // first frame (no white flash; backgroundColor below). Linux keeps
      // ready-to-show because its window is transparent for rounded corners,
      // and an unpainted transparent window is an invisible ghost.
      show: !isLinux,
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
        // Compile-and-cache eagerly: slower very first boot by a hair, faster
        // every boot after (V8 bytecode cache for the 1MB main bundle).
        v8CacheOptions: "bypassHeatCheck",
      },
    });

    // (The chosen icon is baked in via the `icon` option above — no post-create
    // setIcon needed, which also avoids the flaky Windows taskbar refresh.)

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

    // Linux only (transparent window) — Windows is already visible.
    // openFilePath is delivered via get-pending-file IPC on renderer mount.
    if (isLinux) mainWindow.once("ready-to-show", () => { mainWindow.show(); });

    mainWindow.on("closed", () => (mainWindow = null));
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

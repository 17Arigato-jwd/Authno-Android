// main.js
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let splash;
let openFilePath = null;

const isLinux = process.platform === "linux";

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
  ipcMain.handle("get-app-icon", () => readIconPref());
  ipcMain.handle("set-app-icon", (_e, id) => {
    const asset = ICON_ASSETS[id] || ICON_ASSETS.default;
    try {
      const img = nativeImage.createFromPath(resolveAsset(asset));
      if (!img.isEmpty() && mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(img);
      writeIconPref(id in ICON_ASSETS ? id : "default");
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
    splash = new BrowserWindow({
      width: 400,
      height: 300,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      resizable: false,
      icon: resolveAsset("authno.ico"),
    });

    splash.loadFile(resolveAsset("splash.html"));

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      // Frameless — the app draws its own themed title bar (see TitleBar.jsx).
      // This is what makes the desktop app stop looking like "a website in a
      // window". Still resizable; dragging is handled via -webkit-app-region.
      frame: false,
      titleBarStyle: "hidden",
      icon: resolveAsset("authno.ico"),
      // Linux: a transparent frameless window lets the renderer paint rounded
      // corners (the app root has border-radius). Windows 11 already rounds
      // frameless windows via DWM, and transparency there disables the drop
      // shadow, so it's Linux-only.
      transparent: isLinux,
      backgroundColor: isLinux ? "#00000000" : "#000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "Preload.js"), // safe — after handlers registered
      },
    });

    // Re-apply the user's chosen launcher icon at startup (desktop switcher).
    try {
      const savedIcon = readIconPref();
      if (savedIcon && savedIcon !== "default") {
        const img = nativeImage.createFromPath(resolveAsset(ICON_ASSETS[savedIcon] || ICON_ASSETS.default));
        if (!img.isEmpty()) mainWindow.setIcon(img);
      }
    } catch { /* icon best-effort */ }

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

    mainWindow.once("ready-to-show", () => {
      setTimeout(() => {
        if (splash && !splash.isDestroyed()) splash.close();
        mainWindow.show();

        // openFilePath is delivered via get-pending-file IPC on renderer mount
        // No need to send here — avoids double delivery
      }, 1500);
    });

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

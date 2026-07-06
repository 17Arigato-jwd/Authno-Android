// Preload.js — Electron context bridge
//
// Exposes the IPC bridge to the renderer process via contextBridge.
// Both old text-based handlers and new binary (base64) handlers are exposed
// so that storage.js can use the binary path while any legacy code still works.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // ── Generic IPC ───────────────────────────────────────────────────────────
  send:    (channel, data) => ipcRenderer.send(channel, data),
  receive: (channel, func) => ipcRenderer.on(channel, (_event, ...args) => func(...args)),

  // ── Binary file operations (VCHS-ECS, used by storage.js) ────────────────
  saveBookBytes:   (data) => ipcRenderer.invoke('save-book-bytes',    data),
  saveAsBytesBook: (data) => ipcRenderer.invoke('save-as-bytes-book', data),
  openBookBytes:   ()     => ipcRenderer.invoke('open-book-bytes'),

  // ── Legacy text-based operations (kept for backward compatibility) ─────────
  openBook:   ()     => ipcRenderer.invoke('open-book'),
  saveBook:   (data) => ipcRenderer.invoke('save-book',    data),
  saveAsBook: (data) => ipcRenderer.invoke('save-as-book', data),

  // ── Restore previously open books on startup ──────────────────────────────
  restoreBooks: async (books) => {
    const result = await ipcRenderer.invoke('restore-books', books);
    if (!result) return;
    const { validBooks, missingBooks } = result;
    // validBooks = [{ base64, filePath }] — storage.js decodes these
    window.postMessage({ type: 'restored-books', books: validBooks });
    if (missingBooks.length > 0)
      window.postMessage({ type: 'missing-books', messages: missingBooks });
  },

  // ── File association: .authbook double-clicked in OS ──────────────────────
  // Delivers RAW BYTES (base64) now — main.js no longer JSON-parses the binary
  // format. Returns an unsubscribe fn so the renderer can clean up (fixes the
  // duplicate-listener leak). A separate error channel replaces the alert().
  onOpenAuthBook: (callback) => {
    const bytesListener = (_event, fileData) => {
      if (!fileData || !fileData.base64) return;
      window.dispatchEvent(new CustomEvent('open-authbook-desktop-bytes', {
        detail: { base64: fileData.base64, uri: fileData.filePath },
      }));
    };
    const errListener = (_event, info) => {
      window.dispatchEvent(new CustomEvent('open-authbook-desktop-error', { detail: info }));
    };
    ipcRenderer.on('open-authbook-bytes', bytesListener);
    ipcRenderer.on('open-authbook-error', errListener);
    // callback kept for API compatibility; the app listens on the window events.
    if (typeof callback === 'function') callback({ _viaEvents: true });
    return () => {
      ipcRenderer.removeListener('open-authbook-bytes', bytesListener);
      ipcRenderer.removeListener('open-authbook-error', errListener);
    };
  },

  // ── Cold-launch file (app opened by double-clicking a file) ───────────────
  getInitialFile: () => ipcRenderer.invoke('get-pending-file'),
});

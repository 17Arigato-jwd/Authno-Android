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
  onOpenAuthBook: (callback) => {
    ipcRenderer.on('open-authbook', (_event, fileData) => {
      if (!fileData) { alert('⚠️ Book could not be opened.'); return; }
      callback(fileData);
    });
  },

  // ── Cold-launch file (app opened by double-clicking a file) ───────────────
  getInitialFile: () => ipcRenderer.invoke('get-pending-file'),
});

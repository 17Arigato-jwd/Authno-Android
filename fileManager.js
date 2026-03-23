// fileManager.js — Electron main-process IPC handlers
//
// All .authbook files are transferred as base64 strings over IPC because
// Electron's IPC channel is JSON-only and cannot carry raw Buffer objects
// directly without serialisation overhead.
//
// Handler summary
// ───────────────
//   save-book-bytes     { filePath, base64 }          → overwrites file on disk
//   save-as-bytes-book  { base64, defaultName }        → Save-As dialog → writes file
//   open-book-bytes     (no args)                      → Open dialog → { base64, filePath }
//   restore-books       [{ title, filePath }]          → { validBooks, missingBooks }
//                         validBooks = [{ base64, filePath }]
//
// BACKWARD COMPATIBILITY
// Both legacy JSON files and new VCHS-ECS binary files are read as raw bytes
// and returned as base64. storage.js handles format detection and migration
// transparently — fileManager.js never needs to know which format it holds.

const { ipcMain, dialog, app } = require('electron');
const fs   = require('fs');
const path = require('path');

console.log('✅ FileManager loaded — waiting for app readiness...');

if (!app.isReady()) {
  app.whenReady().then(registerHandlers);
} else {
  registerHandlers();
}

function registerHandlers() {
  console.log('🟢 Registering IPC handlers...');

  // ── Overwrite existing file ────────────────────────────────────────────────
  ipcMain.handle('save-book-bytes', async (_event, { filePath, base64 }) => {
    try {
      if (!filePath) throw new Error('No file path provided');
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      return { success: true };
    } catch (err) {
      console.error('❌ save-book-bytes failed:', err);
      return { success: false, error: err.message };
    }
  });

  // ── Save As dialog ─────────────────────────────────────────────────────────
  ipcMain.handle('save-as-bytes-book', async (_event, { base64, defaultName }) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title:       'Save Book As…',
      defaultPath: defaultName || 'Untitled.authbook',
      filters:     [{ name: 'AuthNo Book Files', extensions: ['authbook'] }],
    });
    if (canceled || !filePath) return { cancelled: true };
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { success: true, filePath };
  });

  // ── Open dialog ────────────────────────────────────────────────────────────
  ipcMain.handle('open-book-bytes', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title:      'Open Book',
      filters:    [{ name: 'AuthNo Book Files', extensions: ['authbook'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    const buf      = fs.readFileSync(filePath);   // works for both binary and JSON
    return { base64: buf.toString('base64'), filePath };
  });

  // ── Restore previously open books on startup ───────────────────────────────
  // Each entry in `books` needs only { title, filePath }.
  // Returns validBooks as [{ base64, filePath }] — storage.js decodes format.
  ipcMain.handle('restore-books', async (_event, books) => {
    const validBooks   = [];
    const missingBooks = [];

    for (const book of books) {
      try {
        if (book.filePath && fs.existsSync(book.filePath)) {
          const buf = fs.readFileSync(book.filePath);
          validBooks.push({ base64: buf.toString('base64'), filePath: book.filePath });
        } else {
          missingBooks.push(`⚠️ Book "${book.title}" was not found on your system.`);
        }
      } catch (err) {
        missingBooks.push(`⚠️ Could not open "${book.title}" (${err.message}).`);
      }
    }

    return { validBooks, missingBooks };
  });

  // ── Keep the old text-based handlers alive for safety ─────────────────────
  // These handle files saved by older versions of the app that the Preload
  // bridge may still reference during a transition period. They decode the
  // base64 bytes and return the raw file content as a string, which storage.js
  // will recognise as a legacy JSON format and migrate automatically.
  ipcMain.handle('open-book', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title:      'Open Book',
      filters:    [{ name: 'AuthNo Book Files', extensions: ['authbook'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    const raw      = fs.readFileSync(filePath, 'utf-8');
    try {
      return { ...JSON.parse(raw), filePath };
    } catch {
      return null;
    }
  });

  ipcMain.handle('save-book', async (_event, { filePath, content }) => {
    try {
      if (!filePath) throw new Error('No file path');
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('save-as-book', async (_event, { content }) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title:       'Save Book As…',
      defaultPath: 'Untitled.authbook',
      filters:     [{ name: 'AuthNo Book Files', extensions: ['authbook'] }],
    });
    if (canceled || !filePath) return { cancelled: true };
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
    return { success: true, filePath };
  });

  console.log('✅ IPC handlers registered successfully.');
}

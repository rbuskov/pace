import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, ipcMain } from 'electron';
import * as claudeResolver from './claude-resolver.js';
import { registerAll } from './ipc/index.js';
import * as persistence from './persistence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Single-instance lock: a second invocation focuses the existing window
// instead of opening a second one fighting over state.json.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [first] = BrowserWindow.getAllWindows();
    if (first) {
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });

  app.whenReady().then(() => {
    registerAll(ipcMain);
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  claudeResolver.setMainWindow(win);

  win.on('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    claudeResolver.setMainWindow(null);
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Fire off the claude --version check on startup using the stored binary
  // path, if any. The renderer reads the cached value via claude:status.
  const settings = persistence.getSettings();
  void claudeResolver.refresh(settings.claudeBinaryPath);
}

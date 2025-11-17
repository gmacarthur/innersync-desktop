import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron';
import { join } from 'node:path';
import { URL } from 'node:url';
import { SettingsStore } from './settings';
import { SyncController } from './syncController';
import { createTray } from './tray';
import { applyAutoLaunchSetting } from './autoLaunch';
import { appUpdater } from './updater';
import { appIcon } from './icons';

const APP_NAME = 'Innersync';
const APP_TITLE = 'Innersync Desktop';

app.setName(APP_NAME);

const isSingleInstance = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | null = null;
let tray: ReturnType<typeof createTray> | null = null;
let settingsStore: SettingsStore | null = null;
let controller: SyncController | null = null;

if (!isSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    settingsStore = new SettingsStore(app.getPath('userData'));
    controller = new SyncController(settingsStore, console, applyAutoLaunchSetting);
    await controller.init();
    appUpdater.setEnabled(controller.getSettings().autoUpdate);

    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(appIcon);
    }

    controller.on('status', (status) => {
      mainWindow?.webContents.send('sync:status', status);
    });
    controller.on('history', (history) => {
      mainWindow?.webContents.send('sync:history', history);
    });

    await createWindow();
    tray = createTray(controller, () => mainWindow);
    registerIpcHandlers();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    } else {
      mainWindow?.show();
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 760,
    minHeight: 560,
    resizable: false,
    maximizable: false,
    title: APP_TITLE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#fafafa',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    const url = process.env.ELECTRON_RENDERER_URL;
    if (!url) throw new Error('Missing renderer dev server URL');
    await mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadURL(
      new URL('../renderer/dist/index.html', 'file://' + __dirname + '/').toString()
    );
  }
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('sync:get-status', () => controller?.getStatus() ?? null);
  ipcMain.handle('sync:get-history', () => controller?.getHistory() ?? []);
  ipcMain.handle('sync:get-settings', () => settingsStore?.get() ?? null);
  ipcMain.handle('sync:update-settings', async (_event, patch) => {
    const updated = await controller?.updateSettings(patch);
    if (updated) {
      appUpdater.setEnabled(updated.autoUpdate);
    }
    return updated;
  });
  ipcMain.handle('sync:pause', () => controller?.pause());
  ipcMain.handle('sync:resume', () => controller?.resume());
  ipcMain.handle('sync:trigger', (_event, reason) => controller?.trigger(reason));
  ipcMain.handle('auth:login', (_event, credentials) => controller?.login(credentials));
  ipcMain.handle('auth:logout', () => controller?.logout());
  ipcMain.handle('dialog:pick-path', async (_event, options) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: options?.properties || ['openDirectory'],
      title: options?.title,
      defaultPath: options?.defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('update:check', () => appUpdater.checkForUpdates());
  ipcMain.handle('update:install', () => appUpdater.downloadAndInstall());

  appUpdater.on('update-status', (payload) => {
    mainWindow?.webContents.send('update:status', payload);
  });
}

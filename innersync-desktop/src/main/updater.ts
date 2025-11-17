import { app, dialog } from 'electron';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import { EventEmitter } from 'node:events';

const isDev = process.env.NODE_ENV === 'development';

class AppUpdater extends EventEmitter {
  private enabled = false;
  private checking = false;

  constructor() {
    super();
    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () => {
      this.checking = true;
      this.emit('update-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.checking = false;
      this.emit('update-status', { status: 'available', info });
    });

    autoUpdater.on('update-not-available', () => {
      this.checking = false;
      this.emit('update-status', { status: 'not-available' });
    });

    autoUpdater.on('error', (error) => {
      this.checking = false;
      this.emit('update-status', { status: 'error', message: error.message });
    });

    autoUpdater.on('update-downloaded', () => {
      this.emit('update-status', { status: 'downloaded' });
    });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!isDev && enabled) {
      this.checkForUpdates();
    }
  }

  async checkForUpdates() {
    if (!this.enabled || isDev || this.checking) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.emit('update-status', {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async downloadAndInstall() {
    if (isDev) {
      dialog.showMessageBox({
        type: 'info',
        message: 'Auto-update is disabled in development builds.',
      });
      return;
    }
    await autoUpdater.downloadUpdate();
    await autoUpdater.quitAndInstall();
  }
}

export const appUpdater = new AppUpdater();

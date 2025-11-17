import { BrowserWindow, Menu, Tray } from 'electron';
import type { SyncController } from './syncController';
import { trayIcon } from './icons';

export function createTray(controller: SyncController, getWindow: () => BrowserWindow | null) {
  const tray = new Tray(trayIcon);
  tray.setToolTip('Innersync Desktop');

  const buildMenu = () => {
    const status = controller.getStatus();
    const paused = status?.paused ?? false;
    const currentState = status?.state ?? 'idle';
    const lastRun = status?.lastRun
      ? new Date(status.lastRun).toLocaleTimeString()
      : 'Never';
    return Menu.buildFromTemplate([
      {
        label: `Status: ${currentState}${paused ? ' (paused)' : ''}`,
        enabled: false,
      },
      {
        label: `Last sync: ${lastRun}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => {
          const win = getWindow();
          if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
        },
      },
      {
        label: paused ? 'Resume Sync' : 'Pause Sync',
        click: () => {
          if (paused) {
            controller.resume();
          } else {
            controller.pause();
          }
        },
      },
      {
        label: 'Trigger Sync',
        click: () => controller.trigger('tray trigger'),
      },
      { type: 'separator' },
      {
        label: 'Quit Innersync',
        click: () => {
          const win = getWindow();
          win?.destroy();
          tray.destroy();
          process.exit(0);
        },
      },
    ]);
  };

  tray.setContextMenu(buildMenu());
  tray.on('click', () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  controller.on('status', () => {
    const status = controller.getStatus();
    const state = status?.state ?? 'idle';
    const lastRun = status?.lastRun
      ? new Date(status.lastRun).toLocaleString()
      : 'Never synced';
    tray.setToolTip(`Innersync Desktop\nState: ${state}${status?.paused ? ' (paused)' : ''}\nLast: ${lastRun}`);
    tray.setContextMenu(buildMenu());
  });

  return tray;
}

import { app } from 'electron';

export function applyAutoLaunchSetting(enabled: boolean) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
  });
}

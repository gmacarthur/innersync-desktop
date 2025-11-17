import { contextBridge, ipcRenderer } from 'electron';

const createListener = (channel: string) => (callback: (data: any) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('sync', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getStatus: () => ipcRenderer.invoke('sync:get-status'),
  getHistory: () => ipcRenderer.invoke('sync:get-history'),
  getSettings: () => ipcRenderer.invoke('sync:get-settings'),
  updateSettings: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke('sync:update-settings', patch),
  pause: () => ipcRenderer.invoke('sync:pause'),
  resume: () => ipcRenderer.invoke('sync:resume'),
  trigger: (reason?: string) => ipcRenderer.invoke('sync:trigger', reason),
  login: (credentials: Record<string, unknown>) =>
    ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  pickPath: (options: Record<string, unknown>) => ipcRenderer.invoke('dialog:pick-path', options),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: createListener('update:status'),
  onStatus: createListener('sync:status'),
  onHistory: createListener('sync:history'),
});

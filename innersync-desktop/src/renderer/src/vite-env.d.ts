/// <reference types="vite/client" />

declare global {
  interface Window {
    sync: {
      getVersion: () => Promise<string>;
      getStatus: () => Promise<any>;
      getHistory: () => Promise<any[]>;
      getSettings: () => Promise<any>;
      updateSettings: (patch: Record<string, unknown>) => Promise<any>;
      pause: () => Promise<void>;
      resume: () => Promise<void>;
      trigger: (reason?: string) => Promise<void>;
      login: (credentials: Record<string, unknown>) => Promise<any>;
      logout: () => Promise<any>;
      pickPath: (options: Record<string, unknown>) => Promise<string | null>;
      checkForUpdates: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (callback: (payload: any) => void) => () => void;
      onStatus: (callback: (status: any) => void) => () => void;
      onHistory: (callback: (history: any[]) => void) => () => void;
    };
  }
}

export {};

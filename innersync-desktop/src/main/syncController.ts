import { EventEmitter } from 'node:events';
import os from 'node:os';
import type { SyncSettings } from './settings';
import type { SettingsStore } from './settings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  SyncService: CoreSyncService,
  loginForToken,
  clearCachedToken,
} = require('innersync-core') as {
  SyncService: any;
  loginForToken: any;
  clearCachedToken: (tokenCachePath: string) => Promise<void>;
};

export type SyncStatus = {
  state: string;
  paused: boolean;
  running: boolean;
  lastRun?: string;
  lastResult?: Record<string, unknown>;
  history: HistoryEntry[];
};

export type HistoryEntry = {
  timestamp: string;
  status: string;
  reason: string;
  [key: string]: unknown;
};

export class SyncController extends EventEmitter {
  private service: any = null;
  private currentSettings: SyncSettings;
  private latestStatus: SyncStatus | null = null;
  private latestHistory: HistoryEntry[] = [];
  private readonly hostDeviceName = os.hostname?.() || 'innersync-desktop';

  constructor(
    private store: SettingsStore,
    private logger: Console,
    private applyAutoLaunch: (autoLaunch: boolean) => void
  ) {
    super();
    this.currentSettings = store.get();
  }

  async init() {
    this.currentSettings = await this.store.load();
    this.applyAutoLaunch(this.currentSettings.autoLaunch);
    await this.startService(this.currentSettings);
  }

  private async startService(settings: SyncSettings) {
    if (this.service) {
      await this.service.stop();
      this.service.removeAllListeners();
    }

    this.service = new CoreSyncService(settings, this.logger);
    this.service.on('status', (status) => {
      this.latestStatus = status;
      this.emit('status', status);
    });
    this.service.on('history', (history) => {
      this.latestHistory = history;
      this.emit('history', history);
    });

    await this.service.start();
    this.latestStatus = this.service.getStatus();
    this.latestHistory = this.latestStatus?.history ?? [];
  }

  getStatus(): SyncStatus | null {
    if (this.service) {
      return this.service.getStatus();
    }
    return this.latestStatus;
  }

  getHistory(): HistoryEntry[] {
    return this.latestHistory;
  }

  async pause() {
    await this.service?.pause();
  }

  async resume() {
    await this.service?.resume();
  }

  async trigger(reason?: string) {
    await this.service?.triggerSync(reason);
  }

  async updateSettings(patch: Partial<SyncSettings>) {
    if ('apiBaseUrl' in patch) {
      delete (patch as any).apiBaseUrl;
    }
    if (patch.watchFiles && patch.watchFiles.length === 0) {
      patch.watchFiles = undefined;
    }
    if (!patch.tfxFile && patch.watchFiles && patch.watchFiles.length > 0) {
      patch.tfxFile = patch.watchFiles[0];
    }
    this.currentSettings = await this.store.update(patch);
    this.applyAutoLaunch(this.currentSettings.autoLaunch);
    await this.startService(this.currentSettings);
    return this.currentSettings;
  }

  getSettings() {
    return this.currentSettings;
  }

  async login(credentials: {
    email: string;
    password: string;
    deviceName?: string;
    remember?: boolean;
    apiBaseUrl?: string;
  }) {
    if (!credentials.email?.trim() || !credentials.password?.trim()) {
      throw new Error('Email and password are required.');
    }

    const baseUrl =
      credentials.apiBaseUrl || this.currentSettings.apiBaseUrl || 'https://innersync.com.au';
    const deviceName =
      credentials.deviceName?.trim() ||
      this.currentSettings.login.device_name ||
      this.hostDeviceName;
    let token: string | null = null;
    try {
      token = await loginForToken(
        baseUrl,
        {
          email: credentials.email,
          password: credentials.password,
          device_name: deviceName,
          replace_existing: true,
        },
        this.currentSettings.tokenCachePath,
        this.logger
      );
    } catch (error: any) {
      const message = error?.message ?? '';
      if (message.includes('401')) {
        throw new Error('Invalid credentials. Please check your email and password.');
      }
      if (message.includes('422')) {
        throw new Error('Login request was rejected (HTTP 422). Please verify the device name.');
      }
      throw error;
    }

    if (!token) {
      throw new Error('Login failed: server did not return an access token.');
    }

    const remember = credentials.remember ?? false;
    const nextSettings = await this.updateSettings({
      apiBaseUrl: baseUrl,
      apiToken: token,
      login: {
        ...this.currentSettings.login,
        email: credentials.email,
        device_name: deviceName,
        replace_existing: true,
        remember,
        password: remember ? credentials.password : '',
      },
    });

    return { token, settings: nextSettings };
  }

  async logout() {
    if (this.service) {
      await this.service.stop();
      this.service.removeAllListeners();
      this.service = null;
    }

    if (this.currentSettings.tokenCachePath) {
      try {
        await clearCachedToken(this.currentSettings.tokenCachePath);
      } catch (error: any) {
        this.logger.warn('[sync] unable to clear cached token', error?.message ?? error);
      }
    }

    const nextSettings = await this.store.update({
      apiToken: null,
      login: {
        ...this.currentSettings.login,
        password: '',
        remember: false,
      },
    });
    this.currentSettings = nextSettings;

    this.latestStatus = {
      state: 'signed-out',
      paused: true,
      running: false,
      lastRun: this.latestStatus?.lastRun,
      lastResult: this.latestStatus?.lastResult,
      history: this.latestHistory,
    };
    this.emit('status', this.latestStatus);
    this.emit('history', this.latestHistory);
    return nextSettings;
  }
}

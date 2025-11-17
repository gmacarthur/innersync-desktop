import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type SyncSettings = {
  baseDir: string;
  tfxFile?: string;
  outputDir: string;
  watchFiles: string[];
  debounceMs: number;
  apiToken?: string | null;
  login: {
    email: string;
    password: string;
    device_name: string;
    replace_existing: boolean;
    remember: boolean;
  };
  tokenCachePath: string;
  historyPath: string;
  historyLimit: number;
  autoLaunch: boolean;
  autoUpdate: boolean;
};

const API_BASE_URL = 'https://innersync.com.au';
const DEFAULT_DEVICE_NAME = os.hostname() || 'innersync-desktop';

const LEGACY_WATCH_PLACEHOLDERS = new Set([
  'Timetable.tfx',
  'Year 7.sfx',
  'Year 8.sfx',
  'Year 9.sfx',
  'Year 10.sfx',
  'Year 11.sfx',
  'Year 12.sfx',
]);

function sanitizeWatchFiles(list?: string[]) {
  if (!Array.isArray(list)) return [];
  return list.filter((value) => value && !LEGACY_WATCH_PLACEHOLDERS.has(value));
}

export function getDefaultSettings(userDataDir: string): SyncSettings {
  return {
    baseDir: '',
    tfxFile: undefined,
    outputDir: path.join(userDataDir, 'generated'),
    watchFiles: [],
    debounceMs: 2000,
    apiToken: null,
    login: {
      email: '',
      password: '',
      device_name: DEFAULT_DEVICE_NAME,
      replace_existing: true,
      remember: false,
    },
    tokenCachePath: path.join(userDataDir, '.cache', 'token.json'),
    historyPath: path.join(userDataDir, 'history', 'sync-history.json'),
    historyLimit: 100,
    autoLaunch: false,
    autoUpdate: true,
  };
}

export class SettingsStore {
  private filePath: string;
  private settings: SyncSettings;

  constructor(private userDataDir: string) {
    this.filePath = path.join(userDataDir, 'settings.json');
    this.settings = getDefaultSettings(userDataDir);
    void this.clearLegacyHistory();
  }

  private async clearLegacyHistory() {
    const legacyHistory = path.join(this.userDataDir, 'history', 'sync-history.json');
    try {
      await fs.rm(legacyHistory, { force: true });
    } catch {}
  }

  async load(): Promise<SyncSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const defaults = getDefaultSettings(this.userDataDir);
      const { history, ...rest } = parsed;
      this.settings = { ...defaults, ...rest };
      if (!this.settings.login) {
        this.settings.login = { ...defaults.login };
      } else if (!this.settings.login.device_name) {
        this.settings.login.device_name = DEFAULT_DEVICE_NAME;
      }
      this.settings.apiBaseUrl = API_BASE_URL;
      this.settings.watchFiles = sanitizeWatchFiles(this.settings.watchFiles);
      if (!this.settings.tfxFile && this.settings.watchFiles.length > 0) {
        this.settings.tfxFile = this.settings.watchFiles[0];
      } else if (
        this.settings.tfxFile &&
        !this.settings.watchFiles.includes(this.settings.tfxFile)
      ) {
        this.settings.tfxFile = undefined;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn('[settings] unable to load config, using defaults', error.message);
      }
      await this.save(this.settings);
    }
    return this.settings;
  }

  get(): SyncSettings {
    return this.settings;
  }

  async save(next?: SyncSettings): Promise<SyncSettings> {
    if (next) {
      this.settings = next;
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const { apiBaseUrl, ...rest } = this.settings as any;
    await fs.writeFile(this.filePath, JSON.stringify(rest, null, 2), 'utf8');
    return this.settings;
  }

  async update(patch: Partial<SyncSettings>): Promise<SyncSettings> {
    const next = { ...this.settings, ...patch } as SyncSettings;
    next.watchFiles = sanitizeWatchFiles(next.watchFiles);
    if (next.watchFiles.length === 0) {
      next.tfxFile = undefined;
    } else if (!next.tfxFile || !next.watchFiles.includes(next.tfxFile)) {
      next.tfxFile = next.watchFiles[0];
    }
    next.apiBaseUrl = API_BASE_URL;
    return this.save(next as SyncSettings);
  }
}

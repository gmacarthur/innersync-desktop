const path = require('path');
const fs = require('fs/promises');
const { EventEmitter } = require('events');
const chokidar = require('chokidar');
const { generateTimetable } = require('./generate');
const { uploadTimetable } = require('./apiClient');

const DEFAULT_HISTORY_LIMIT = 50;

class SyncService extends EventEmitter {
  constructor(config = {}, logger = console) {
    super();
    this.logger = logger;
    this.config = config;
    this.baseDir = path.resolve(
      config.baseDir || path.join(__dirname, '..', '..')
    );

    this.paths = {
      tfxFile: resolveMaybe(this.baseDir, config.tfxFile, 'Timetable.tfx'),
      outputDir: resolveMaybe(this.baseDir, config.outputDir, 'generated'),
      watchFiles: (config.watchFiles || ['Timetable.tfx']).map((file) =>
        resolveMaybe(this.baseDir, file)
      ),
      history: resolveMaybe(this.baseDir, config.historyPath, 'sync-history.json'),
      tokenCache: config.tokenCachePath
        ? resolveMaybe(this.baseDir, config.tokenCachePath)
        : null,
    };

    this.debounceMs = Number(config.debounceMs || 2000);
    this.historyLimit = Number(config.historyLimit || DEFAULT_HISTORY_LIMIT);

    this.state = 'idle';
    this.running = false;
    this.paused = false;
    this.lastRun = null;
    this.lastResult = null;
    this.history = [];
    this.watcher = null;
    this.timer = null;
    this.pendingReason = null;
  }

  async start() {
    await this.loadHistory();
    await this.setupWatcher();
    await this.runSync('Startup Sync');
  }

  async stop() {
    await this.closeWatcher();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.state = 'stopped';
    this.emitStatus();
  }

  async pause() {
    this.paused = true;
    await this.closeWatcher();
    this.emitStatus();
  }

  async resume() {
    if (!this.paused) return;
    this.paused = false;
    await this.setupWatcher();
    this.emitStatus();
  }

  async triggerSync(reason = 'manual trigger') {
    if (this.paused) {
      this.logger.warn('[sync] ignored trigger while paused');
      return;
    }
    this.scheduleRun(reason, true);
  }

  getStatus() {
    return {
      state: this.state,
      paused: this.paused,
      running: this.running,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      history: this.history,
      watchFiles: this.paths.watchFiles,
    };
  }

  emitStatus() {
    this.emit('status', this.getStatus());
  }

  async setupWatcher() {
    if (this.watcher || this.paused) return;
    if (!this.paths.watchFiles.length) return;

    this.watcher = chokidar.watch(this.paths.watchFiles, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath) => {
      this.logger.log(`[watcher] file added ${filePath}`);
      this.scheduleRun(`file added: ${filePath}`);
    });

    this.watcher.on('change', (filePath) => {
      this.logger.log(`[watcher] file changed ${filePath}`);
      this.scheduleRun(`file changed: ${filePath}`);
    });

    this.watcher.on('unlink', (filePath) => {
      this.logger.log(`[watcher] file removed ${filePath}`);
    });
  }

  async closeWatcher() {
    if (!this.watcher) return;
    await this.watcher.close().catch(() => {});
    this.watcher = null;
  }

  scheduleRun(reason, immediate = false) {
    if (this.paused) return;
    this.pendingReason = reason;
    if (immediate) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      void this.processQueue();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.processQueue(), this.debounceMs);
  }

  async processQueue() {
    if (this.running || this.paused) {
      this.timer = setTimeout(() => this.processQueue(), this.debounceMs);
      return;
    }
    const reason = this.pendingReason || 'change detected';
    this.pendingReason = null;
    this.timer = null;
    await this.runSync(reason);
  }

  async runSync(reason) {
    this.running = true;
    this.state = 'syncing';
    this.emitStatus();
    const timestamp = new Date().toISOString();
    try {
      const { studentCoursePath, studentTimetablePath, timetablePath, outputDir } =
        await generateTimetable({
          baseDir: this.baseDir,
          tfxFile: this.paths.tfxFile,
          outputDir: this.paths.outputDir,
          logger: this.logger,
        });

      const uploadResult = await uploadTimetable({
        apiBaseUrl: this.config.apiBaseUrl || this.config.apiUrl,
        apiToken: this.config.apiToken,
        login: this.config.login,
        tokenCachePath: this.paths.tokenCache,
        files: {
          student_course: studentCoursePath,
          student_timetable: studentTimetablePath,
          timetable: timetablePath,
        },
        logger: this.logger,
      });

      const resultStatus = uploadResult?.skipped ? 'skipped' : 'success';
      const uploadMessage =
        uploadResult?.message || uploadResult?.reason || uploadResult?.body?.message;
      this.lastRun = timestamp;
      this.lastResult = {
        status: resultStatus,
        payloadHash: uploadResult?.payloadHash,
        response: uploadResult?.body,
        reason: uploadResult?.reason || reason,
        message: uploadMessage,
        outputDir,
      };
      this.state = 'idle';
      this.pushHistory({
        timestamp,
        status: resultStatus,
        reason: capitalizeReason(reason),
        payloadHash: uploadResult?.payloadHash,
        response: uploadResult?.body,
        skippedReason: uploadResult?.skipped ? uploadMessage : undefined,
        message: uploadMessage,
      });
      if (resultStatus === 'skipped') {
        this.logger.log('[sync] skipped (duplicate payload or missing config)');
      } else {
        this.logger.log(`[sync] completed output -> ${outputDir}`);
      }
    } catch (error) {
      this.lastRun = timestamp;
      this.lastResult = {
        status: 'error',
        message: error.message,
      };
      this.state = 'error';
      this.pushHistory({
        timestamp,
        status: 'error',
        reason: capitalizeReason(reason),
        message: error.message,
      });
      this.logger.error('[sync] failed', error);
    } finally {
      this.running = false;
      this.emitStatus();
    }
  }

  async loadHistory() {
    if (!this.paths.history) return;
    try {
      const raw = await fs.readFile(this.paths.history, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.history = parsed.slice(-this.historyLimit);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn('[sync] unable to load history', error.message);
      }
      this.history = [];
    }
  }

  async saveHistory() {
    if (!this.paths.history) return;
    try {
      await fs.mkdir(path.dirname(this.paths.history), { recursive: true });
      await fs.writeFile(
        this.paths.history,
        JSON.stringify(this.history, null, 2),
        'utf8'
      );
    } catch (error) {
      this.logger.warn('[sync] unable to persist history', error.message);
    }
  }

  pushHistory(entry) {
    this.history.push(entry);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
    void this.saveHistory();
    this.emit('history', this.history);
  }
}

function resolveMaybe(baseDir, value, fallback) {
  if (value) {
    return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
  }
  if (fallback) {
    return path.resolve(baseDir, fallback);
  }
  return null;
}

function capitalizeReason(text = '') {
  if (!text) return '';
  return text
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

module.exports = {
  SyncService,
};

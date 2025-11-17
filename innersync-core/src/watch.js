#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { SyncService } = require('./service');

const CONFIG_NAME = 'config.json';
const EXAMPLE_CONFIG = 'config.example.json';

async function main() {
  const { config, configPath } = loadConfig();
  log(`Using config ${configPath}`);

  const service = new SyncService(config, console);

  service.on('status', (status) => {
    log(
      `[status] state=${status.state} paused=${status.paused} running=${status.running}`
    );
  });

  service.on('history', (history) => {
    const last = history[history.length - 1];
    if (!last) return;
    log(
      `[history] ${last.status} (${last.reason}) ${
        last.payloadHash ? last.payloadHash.slice(0, 8) : ''
      }`
    );
  });

  await service.start();

  process.on('SIGINT', async () => {
    log('Stopping watcher...');
    await service.stop();
    process.exit(0);
  });
}

function loadConfig() {
  const rootDir = path.join(__dirname, '..');
  const configPath = fs.existsSync(path.join(rootDir, CONFIG_NAME))
    ? path.join(rootDir, CONFIG_NAME)
    : path.join(rootDir, EXAMPLE_CONFIG);
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  return { config, configPath };
}

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

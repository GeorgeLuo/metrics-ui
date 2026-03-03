#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function printUsage() {
  console.log('metrics-ui');
  console.log('Usage:');
  console.log('  metrics-ui serve [options]');
  console.log('');
  console.log('Options:');
  console.log('  --host <host>                      Bind host (default: 127.0.0.1)');
  console.log('  --port <port>                      Bind port (default: 5050)');
  console.log('  --data-root <path>                 METRICS_UI_DATA_ROOT');
  console.log('  --upload-root <path>               METRICS_UI_UPLOAD_ROOT');
  console.log('  --capture-sources-file <path>      METRICS_UI_CAPTURE_SOURCES_FILE');
  console.log('  --dashboard-state-file <path>      METRICS_UI_DASHBOARD_STATE_FILE');
  console.log('  --help                             Show help');
}

const argv = process.argv.slice(2);
let command = 'serve';
let index = 0;
if (argv.length > 0 && !argv[0].startsWith('-')) {
  command = argv[0];
  index = 1;
}

if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

if (command !== 'serve') {
  console.error(`[metrics-ui] Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: 'production' };
const options = argv.slice(index);

for (let i = 0; i < options.length; i += 1) {
  const flag = options[i];
  const next = options[i + 1];
  const consumeValue = () => {
    if (!next || next.startsWith('-')) {
      console.error(`[metrics-ui] Missing value for ${flag}`);
      process.exit(1);
    }
    i += 1;
    return next;
  };

  if (flag === '--host') {
    env.HOST = consumeValue();
    continue;
  }
  if (flag === '--port') {
    env.PORT = consumeValue();
    continue;
  }
  if (flag === '--data-root') {
    env.METRICS_UI_DATA_ROOT = consumeValue();
    continue;
  }
  if (flag === '--upload-root') {
    env.METRICS_UI_UPLOAD_ROOT = consumeValue();
    continue;
  }
  if (flag === '--capture-sources-file') {
    env.METRICS_UI_CAPTURE_SOURCES_FILE = consumeValue();
    continue;
  }
  if (flag === '--dashboard-state-file') {
    env.METRICS_UI_DASHBOARD_STATE_FILE = consumeValue();
    continue;
  }
  if (flag === '--help' || flag === '-h') {
    printUsage();
    process.exit(0);
  }

  console.error(`[metrics-ui] Unknown option: ${flag}`);
  printUsage();
  process.exit(1);
}

const entry = path.resolve(__dirname, '..', 'dist', 'index.cjs');
if (!fs.existsSync(entry)) {
  console.error('[metrics-ui] dist/index.cjs not found. Reinstall package or run `npm run build`.');
  process.exit(1);
}

const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
  env,
});

child.on('error', (error) => {
  console.error(`[metrics-ui] Failed to start: ${error.message || String(error)}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

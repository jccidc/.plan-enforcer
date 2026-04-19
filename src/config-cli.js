#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { applyConfigUpdates, formatConfig, readConfig, writeConfig } = require('./config');

function printUsage() {
  console.error('Usage: plan-enforcer-config [config-path] [--tier VALUE] [--reconcile-interval N] [--stale-threshold N] [--completion-gate soft|hard|audit] [--check-cmd CMD]');
}

function parseArgs(argv) {
  const updates = {};
  let configPath = '.plan-enforcer/config.md';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--') && index === 0) {
      configPath = arg;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (arg) {
      case '--tier':
        updates.tier = value;
        break;
      case '--reconcile-interval':
        updates.reconcile_interval = value;
        break;
      case '--stale-threshold':
        updates.stale_threshold = value;
        break;
      case '--completion-gate':
        updates.completion_gate = value;
        break;
      case '--check-cmd':
        updates.check_cmd = value;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }

  return { configPath, updates };
}

function main() {
  try {
    const { configPath, updates } = parseArgs(process.argv.slice(2));
    const resolvedPath = path.resolve(process.cwd(), configPath);
    const current = readConfig(resolvedPath);

    if (Object.keys(updates).length === 0) {
      process.stdout.write(`${formatConfig(current)}\n`);
      return;
    }

    const next = applyConfigUpdates(current, updates);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    writeConfig(resolvedPath, next);
    process.stdout.write(`${formatConfig(next)}\n`);
  } catch (error) {
    printUsage();
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs
};

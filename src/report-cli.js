#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { formatArchiveReport } = require('./archive');
const { formatActiveReport } = require('./runtime-summary');

function printUsage() {
  console.error('Usage: plan-enforcer-report [archive-path] [--active] [--ledger <path>]');
}

function parseArgs(argv = []) {
  const args = {
    target: null,
    active: false,
    ledger: path.resolve(process.cwd(), '.plan-enforcer', 'ledger.md'),
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') args.help = true;
    else if (arg === '--active') args.active = true;
    else if (arg === '--ledger') args.ledger = path.resolve(process.cwd(), argv[++i]);
    else if (!args.target) args.target = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function resolveTarget(targetArg) {
  return path.resolve(process.cwd(), targetArg || '.plan-enforcer/archive');
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    printUsage();
    console.error(error.message);
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  if (parsed.active) {
    if (!fs.existsSync(parsed.ledger)) {
      console.error(`Active ledger not found: ${parsed.ledger}`);
      process.exit(1);
    }
    process.stdout.write(`${formatActiveReport(parsed.ledger)}\n`);
    return;
  }

  const targetPath = resolveTarget(parsed.target);
  if (!fs.existsSync(targetPath)) {
    if (!parsed.target && fs.existsSync(parsed.ledger)) {
      process.stdout.write(`${formatActiveReport(parsed.ledger)}\n`);
      return;
    }
    console.error(`Archive path not found: ${targetPath}`);
    process.exit(1);
  }

  process.stdout.write(`${formatArchiveReport(targetPath)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs,
  resolveTarget
};

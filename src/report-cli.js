#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { formatArchiveReport } = require('./archive');

function printUsage() {
  console.error('Usage: plan-enforcer-report [archive-path]');
}

function resolveTarget(targetArg) {
  if (!targetArg) {
    return path.resolve(process.cwd(), '.plan-enforcer', 'archive');
  }
  return path.resolve(process.cwd(), targetArg);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const targetPath = resolveTarget(argv[0]);
  if (!fs.existsSync(targetPath)) {
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
  resolveTarget
};

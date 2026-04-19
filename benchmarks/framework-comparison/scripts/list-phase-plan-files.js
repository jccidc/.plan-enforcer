#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parsePhaseNumber(fileName) {
  const match = /^phase-(\d+)\.md$/i.exec(fileName);
  return match ? Number(match[1]) : null;
}

function listPhasePlanFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      phaseNumber: parsePhaseNumber(entry.name)
    }))
    .filter((entry) => entry.phaseNumber !== null)
    .sort((a, b) => a.phaseNumber - b.phaseNumber || a.name.localeCompare(b.name))
    .map((entry) => path.join(dirPath, entry.name));
}

function main() {
  const dirPath = process.argv[2];
  if (!dirPath) {
    console.error('usage: list-phase-plan-files.js <phase-plan-dir>');
    process.exit(2);
  }
  const files = listPhasePlanFiles(dirPath);
  if (process.argv.includes('--plain')) {
    process.stdout.write(`${files.join('\n')}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { listPhasePlanFiles, parsePhaseNumber, main };

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listPhaseVerdicts(cellDir) {
  return fs.readdirSync(cellDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(cellDir, entry.name, 'phase-verdict.json'))
    .filter((filePath) => isFile(filePath))
    .sort()
    .map((filePath) => readJson(filePath));
}

function buildOutcome(verdicts) {
  const perTask = [];
  const judges = new Set();
  let total = 0;
  let verified = 0;

  for (const verdict of verdicts) {
    judges.add(verdict.judge || 'unknown');
    for (const task of verdict.tasks || []) {
      total += 1;
      const shipped = Boolean(task.shipped);
      if (shipped) verified += 1;
      perTask.push({
        id: task.id,
        shipped,
        status: task.status,
        evidence: task.evidence || '',
        archive: verdict.archive || '',
        judge: verdict.judge || 'unknown'
      });
    }
  }

  return {
    judge: judges.size === 1 ? [...judges][0] : [...judges].join(','),
    total_tasks: total,
    verified,
    per_task: perTask
  };
}

function main(argv) {
  const cellDir = argv[0];
  if (!cellDir) {
    console.error('Usage: aggregate-phase-verdicts.js <cell-dir>');
    return 2;
  }
  const verdicts = listPhaseVerdicts(cellDir);
  if (verdicts.length === 0) {
    console.error(`No phase-verdict.json files found under ${cellDir}`);
    return 1;
  }
  const outcome = buildOutcome(verdicts);
  process.stdout.write(JSON.stringify(outcome, null, 2) + '\n');
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  buildOutcome,
  listPhaseVerdicts,
  main
};

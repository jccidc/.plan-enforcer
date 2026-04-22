#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const { parseTaskRows } = require(path.join(REPO_ROOT, 'src', 'ledger-parser.js'));

const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);

function main() {
  const workDir = process.argv[2];
  const outputPath = process.argv[3];

  if (!workDir || !outputPath) {
    console.error('Usage: enforce-native-completion.js <work_dir> <output_path>');
    process.exit(1);
  }

  const ledgerPath = path.join(workDir, '.plan-enforcer', 'ledger.md');
  if (!fs.existsSync(ledgerPath) || !fs.existsSync(outputPath)) {
    process.exit(0);
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const rows = parseTaskRows(ledger);
  if (rows.length === 0) process.exit(0);

  const unfinished = rows.filter((row) => !TERMINAL_STATUSES.has(row.status));
  if (unfinished.length === 0) process.exit(0);

  let output = fs.readFileSync(outputPath, 'utf8');
  if (!output.includes('BENCHMARK_COMPLETE')) process.exit(0);

  output = output.replace(/BENCHMARK_COMPLETE/g, 'BENCHMARK_COMPLETE_BLOCKED_OPEN_LEDGER');
  output = output.replace(/\s*$/, '');
  output += `\nPLAN_ENFORCER_BLOCKED_COMPLETION: ${unfinished.length} unfinished ledger row(s) remain: ${unfinished.map((row) => row.id).join(', ')}\n`;
  fs.writeFileSync(outputPath, output, 'utf8');
}

main();

module.exports = { TERMINAL_STATUSES };

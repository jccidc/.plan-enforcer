#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const { parseTaskRows } = require(path.join(REPO_ROOT, 'src', 'ledger-parser.js'));

const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);

function main() {
  const workDir = process.argv[2];
  if (!workDir) {
    console.error('Usage: read-native-open-rows.js <work_dir>');
    process.exit(1);
  }

  const ledgerPath = path.join(workDir, '.plan-enforcer', 'ledger.md');
  if (!fs.existsSync(ledgerPath)) {
    process.stdout.write('[]');
    return;
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const openRows = parseTaskRows(ledger)
    .filter((row) => !TERMINAL_STATUSES.has(row.status))
    .map((row) => ({ id: row.id, name: row.name, status: row.status }));

  process.stdout.write(JSON.stringify(openRows));
}

main();

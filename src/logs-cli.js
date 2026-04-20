#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { formatLogsReport } = require('./ledger-parser');
const {
  buildAwarenessSummary,
  buildExecutedVerificationSummary,
  formatAwarenessLogs,
  formatExecutedVerificationLogs
} = require('./runtime-summary');

function main() {
  const ledgerArg = process.argv[2] || '.plan-enforcer/ledger.md';
  const ledgerPath = path.resolve(process.cwd(), ledgerArg);

  if (!fs.existsSync(ledgerPath)) {
    console.error('No active Plan Enforcer session.');
    process.exit(1);
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const awareness = formatAwarenessLogs(buildAwarenessSummary(ledgerPath));
  const checks = formatExecutedVerificationLogs(buildExecutedVerificationSummary(ledgerPath));
  process.stdout.write(`${formatLogsReport(ledger)}${checks}${awareness}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main };

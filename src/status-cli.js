#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { formatStatusReport } = require('./ledger-parser');
const {
  buildAwarenessSummary,
  buildExecutedVerificationSummary,
  formatAwarenessSummary,
  formatExecutedVerificationStatus,
  summarizeGitStatus,
  summarizePhaseReport
} = require('./runtime-summary');

function resolveLedgerPath(ledgerArg) {
  return path.resolve(process.cwd(), ledgerArg || '.plan-enforcer/ledger.md');
}

function main(argv = process.argv.slice(2)) {
  const ledgerArg = argv[0] || '.plan-enforcer/ledger.md';
  const ledgerPath = resolveLedgerPath(ledgerArg);

  if (!fs.existsSync(ledgerPath)) {
    console.error('No active Plan Enforcer session. Activate with `/plan-enforcer <plan-file>`');
    process.exit(1);
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const enforcerDir = path.dirname(ledgerPath);
  const git = summarizeGitStatus(ledgerPath);
  const checks = formatExecutedVerificationStatus(buildExecutedVerificationSummary(ledgerPath));
  const phaseReport = summarizePhaseReport(path.join(enforcerDir, 'phase-report.md'));
  const awareness = formatAwarenessSummary(buildAwarenessSummary(ledgerPath));
  process.stdout.write(`${formatStatusReport(ledger)}${git}${awareness}${checks}${phaseReport}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main, resolveLedgerPath };

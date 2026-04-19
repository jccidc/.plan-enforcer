#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const { summarizeAwareness } = require('./awareness');
const { formatLogsReport } = require('./ledger-parser');

function resolveStateRoot(ledgerPath) {
  const stateDir = path.dirname(ledgerPath);
  const projectRoot = path.basename(stateDir) === '.plan-enforcer'
    ? path.dirname(stateDir)
    : stateDir;
  return { stateDir, projectRoot };
}

function summarizeAwarenessLogs(ledgerPath) {
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  const summary = summarizeAwareness({
    cwd: projectRoot,
    projectRoot,
    ledgerPath,
    awarenessPath: path.join(stateDir, 'awareness.md'),
    config: readConfig(path.join(stateDir, 'config.md'))
  });
  if (!summary.initialized) return '';

  const lines = [
    '',
    'AWARENESS:',
    `  live=${summary.liveIntents.length}  linked=${summary.linkedCount}  orphan=${summary.orphanRows.length}  quote_issues=${summary.quoteIssues.length}`
  ];
  if (summary.orphanRows.length > 0) {
    lines.push('  orphan intents:');
    summary.orphanRows.slice(0, 8).forEach((row) => lines.push(`    ${row.id}  ${row.quote}`));
  }
  if (summary.quoteIssues.length > 0) {
    lines.push('  quote issues:');
    summary.quoteIssues.slice(0, 8).forEach((issue) => lines.push(`    ${issue.row}  ${issue.message}`));
  }
  return lines.join('\n');
}

function main() {
  const ledgerArg = process.argv[2] || '.plan-enforcer/ledger.md';
  const ledgerPath = path.resolve(process.cwd(), ledgerArg);

  if (!fs.existsSync(ledgerPath)) {
    console.error('No active Plan Enforcer session.');
    process.exit(1);
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const awareness = summarizeAwarenessLogs(ledgerPath);
  process.stdout.write(`${formatLogsReport(ledger)}${awareness}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main, resolveStateRoot, summarizeAwarenessLogs };

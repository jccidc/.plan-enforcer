#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const { summarizeAwareness } = require('./awareness');
const { assessExecutedVerification } = require('./executed-verification');
const { formatLogsReport, parseMetadata, parseTaskRows } = require('./ledger-parser');
const { summarizeExecutedVerificationActions, NO_ACTIVE_SESSION_MESSAGE } = require('./status-cli');

function resolveStateRoot(ledgerPath) {
  const stateDir = path.dirname(ledgerPath);
  const projectRoot = path.basename(stateDir) === '.plan-enforcer'
    ? path.dirname(stateDir)
    : stateDir;
  return { stateDir, projectRoot };
}

function summarizeAwarenessLogs(ledgerPath, ledger) {
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  const metadata = parseMetadata(ledger || fs.readFileSync(ledgerPath, 'utf8'));
  const summary = summarizeAwareness({
    cwd: projectRoot,
    projectRoot,
    ledgerPath,
    awarenessPath: path.join(stateDir, 'awareness.md'),
    config: readConfig(path.join(stateDir, 'config.md')),
    minCapturedDate: metadata.created
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

function summarizeExecutedVerificationLogs(ledgerPath, ledger) {
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  const config = readConfig(path.join(stateDir, 'config.md'));
  const rows = parseTaskRows(ledger).filter((row) => row.status === 'verified' && row.evidence && row.evidence.trim());
  const gaps = [];

  for (const row of rows) {
    const executed = assessExecutedVerification({
      projectRoot,
      enforcerDir: stateDir,
      taskId: row.id,
      evidenceText: row.evidence,
      config
    });
    if (executed.state === 'ok' || executed.state === 'not_required') continue;
    gaps.push({ row, executed });
  }

  if (gaps.length === 0) return '';
  const lines = [
    '',
    'EXECUTED VERIFICATION:'
  ];
  gaps.forEach(({ row, executed }) => {
    if (executed.state === 'undetected') {
      lines.push(`  ${row.id}  undetected  action=cite exact command or set check_cmd`);
    } else if (executed.state === 'missing') {
      lines.push(`  ${row.id}  missing  expected=${executed.command}`);
    } else if (executed.state === 'failed') {
      lines.push(`  ${row.id}  failed  latest=${executed.latest.command}`);
    } else if (executed.state === 'stale') {
      lines.push(`  ${row.id}  stale  expected=${executed.command}  latest=${executed.latest.command}`);
    }
  });
  lines.push(...summarizeExecutedVerificationActions(gaps));
  return lines.join('\n');
}

function main() {
  const ledgerArg = process.argv[2] || '.plan-enforcer/ledger.md';
  const ledgerPath = path.resolve(process.cwd(), ledgerArg);

  if (!fs.existsSync(ledgerPath)) {
    console.error(NO_ACTIVE_SESSION_MESSAGE);
    process.exit(1);
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const awareness = summarizeAwarenessLogs(ledgerPath, ledger);
  const executed = summarizeExecutedVerificationLogs(ledgerPath, ledger);
  process.stdout.write(`${formatLogsReport(ledger)}${executed}${awareness}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main, resolveStateRoot, summarizeAwarenessLogs, summarizeExecutedVerificationLogs };

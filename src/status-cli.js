#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const { summarizeAwareness } = require('./awareness');
const { assessExecutedVerification } = require('./executed-verification');
const { formatGitWorktreeSummary, summarizeGitWorktree } = require('./git-worktree');
const { formatStatusReport, parseMetadata, parseTaskRows } = require('./ledger-parser');

function buildNoActiveSessionMessage() {
  return [
    'No active Plan Enforcer session.',
    'Start with `/plan-enforcer <plan-file>` or import an existing plan with `plan-enforcer import <plan-file>`.',
    'Then inspect live progress with `plan-enforcer status` or `plan-enforcer report --active`.'
  ].join('\n');
}

const NO_ACTIVE_SESSION_MESSAGE = buildNoActiveSessionMessage();

function resolveLedgerPath(ledgerArg) {
  return path.resolve(process.cwd(), ledgerArg || '.plan-enforcer/ledger.md');
}

function summarizePhaseReport(phaseReportPath) {
  if (!phaseReportPath || !fs.existsSync(phaseReportPath)) return '';
  const raw = fs.readFileSync(phaseReportPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const keep = [];
  for (const line of lines) {
    if (/^- (Archive|Result|Verified rows|Unfinished rows|Focus files|Verification):/.test(line)) {
      keep.push(`  ${line.slice(2)}`);
    }
  }
  if (keep.length === 0) return '';
  return ['',
    'Recent Phase Verify:',
    ...keep
  ].join('\n');
}

function resolveStateRoot(ledgerPath) {
  const stateDir = path.dirname(ledgerPath);
  const projectRoot = path.basename(stateDir) === '.plan-enforcer'
    ? path.dirname(stateDir)
    : stateDir;
  return { stateDir, projectRoot };
}

function hasProjectSurface(projectRoot) {
  try {
    return fs.readdirSync(projectRoot).some((entry) => entry !== '.plan-enforcer');
  } catch {
    return false;
  }
}

function summarizeAwarenessStatus(ledgerPath, ledger) {
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
    `Awareness: ${summary.liveIntents.length} live  |  ${summary.linkedCount} linked  |  ${summary.orphanRows.length} orphan  |  ${summary.quoteIssues.length} quote issue${summary.quoteIssues.length === 1 ? '' : 's'}`
  ];
  if (summary.orphanRows.length > 0) {
    lines.push(`  orphans: ${summary.orphanRows.slice(0, 4).map((row) => row.id).join(', ')}`);
  }
  if (summary.quoteIssues.length > 0) {
    lines.push(`  quote issues: ${summary.quoteIssues.slice(0, 4).map((issue) => issue.row).join(', ')}`);
  }
  return lines.join('\n');
}

function summarizeGitStatus(ledgerPath) {
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  const managedSession = path.basename(stateDir) === '.plan-enforcer' && hasProjectSurface(projectRoot);
  return formatGitWorktreeSummary(summarizeGitWorktree(projectRoot, {
    searchParents: managedSession
  }));
}

function collectExecutedVerificationGaps(ledgerPath, ledger) {
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

  return gaps;
}

function describeExecutedVerificationAction({ row, executed }) {
  if (executed.state === 'undetected') {
    return `fix ${row.id}: cite exact command or set check_cmd before verified`;
  }
  if (executed.state === 'failed') {
    return `fix + rerun ${row.id}: ${executed.latest && executed.latest.command ? executed.latest.command : executed.command}`;
  }
  return `rerun ${row.id}: ${executed.command}`;
}

function summarizeExecutedVerificationActions(gaps) {
  if (!Array.isArray(gaps) || gaps.length === 0) return [];
  const lines = ['  next:'];
  gaps.slice(0, 3).forEach((gap) => lines.push(`    ${describeExecutedVerificationAction(gap)}`));
  if (gaps.some(({ executed }) => executed.source !== 'config:check_cmd')) {
    lines.push('    auto-detect wrong? plan-enforcer-config --check-cmd "<cmd>"');
  }
  return lines;
}

function summarizeExecutedVerificationStatus(ledgerPath, ledger) {
  const gaps = collectExecutedVerificationGaps(ledgerPath, ledger);

  if (gaps.length === 0) return '';
  const lines = [
    '',
    `Executed Verification: ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`
  ];
  gaps.slice(0, 4).forEach(({ row, executed }) => {
    if (executed.state === 'undetected') {
      lines.push(`  ${row.id} undetected cite exact command or set check_cmd`);
    } else if (executed.state === 'missing') {
      lines.push(`  ${row.id} missing ${executed.command}`);
    } else if (executed.state === 'failed') {
      lines.push(`  ${row.id} failed ${executed.latest.command}`);
    } else if (executed.state === 'stale') {
      lines.push(`  ${row.id} stale expected ${executed.command} latest ${executed.latest.command}`);
    }
  });
  if (gaps.length > 4) {
    lines.push(`  ... ${gaps.length - 4} more`);
  }
  lines.push(...summarizeExecutedVerificationActions(gaps));
  return lines.join('\n');
}

function summarizeOperatorNextSteps(ledgerPath, ledger, opts = {}) {
  const rows = parseTaskRows(ledger);
  const current = rows.find((row) => row.status === 'in-progress' || row.status === 'pending') || null;
  const blocked = rows.filter((row) => row.status === 'blocked');
  const unverified = rows.filter((row) => row.status === 'done' && !row.evidence);
  const actions = [];

  if (current) {
    actions.push(`  continue ${current.id}: ${current.name}`);
  }
  if (unverified.length > 0) {
    actions.push(`  verify ${unverified[0].id}: add evidence for "${unverified[0].name}"`);
  }
  if (opts.includeExecuted !== false) {
    const gaps = collectExecutedVerificationGaps(ledgerPath, ledger);
    if (gaps.length > 0) {
      actions.push(`  ${describeExecutedVerificationAction(gaps[0])}`);
    }
  }
  if (blocked.length > 0) {
    actions.push(`  unblock ${blocked[0].id}: ${blocked[0].notes || blocked[0].name}`);
  }
  if (actions.length === 0) return '';
  actions.push('  inspect details: plan-enforcer-logs');
  return ['', 'Operator Next:', ...actions.slice(0, 4)].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const ledgerArg = argv[0] || '.plan-enforcer/ledger.md';
  const ledgerPath = resolveLedgerPath(ledgerArg);

  if (!fs.existsSync(ledgerPath)) {
    console.error(NO_ACTIVE_SESSION_MESSAGE);
    process.exit(1);
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const enforcerDir = path.dirname(ledgerPath);
  const git = summarizeGitStatus(ledgerPath);
  const phaseReport = summarizePhaseReport(path.join(enforcerDir, 'phase-report.md'));
  const awareness = summarizeAwarenessStatus(ledgerPath, ledger);
  const executed = summarizeExecutedVerificationStatus(ledgerPath, ledger);
  const next = summarizeOperatorNextSteps(ledgerPath, ledger, { includeExecuted: false });
  process.stdout.write(`${formatStatusReport(ledger)}${next}${executed}${git}${awareness}${phaseReport}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  hasProjectSurface,
  resolveLedgerPath,
  resolveStateRoot,
  summarizeAwarenessStatus,
  summarizeOperatorNextSteps,
  collectExecutedVerificationGaps,
  describeExecutedVerificationAction,
  summarizeExecutedVerificationActions,
  summarizeExecutedVerificationStatus,
  summarizeGitStatus,
  summarizePhaseReport,
  NO_ACTIVE_SESSION_MESSAGE
};

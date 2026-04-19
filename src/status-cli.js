#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const { summarizeAwareness } = require('./awareness');
const { formatGitWorktreeSummary, summarizeGitWorktree } = require('./git-worktree');
const { formatStatusReport } = require('./ledger-parser');

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

function summarizeAwarenessStatus(ledgerPath) {
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
  const phaseReport = summarizePhaseReport(path.join(enforcerDir, 'phase-report.md'));
  const awareness = summarizeAwarenessStatus(ledgerPath);
  process.stdout.write(`${formatStatusReport(ledger)}${git}${awareness}${phaseReport}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main, hasProjectSurface, resolveLedgerPath, resolveStateRoot, summarizeAwarenessStatus, summarizeGitStatus, summarizePhaseReport };

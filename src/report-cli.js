#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parseLedger, parseMetadata, parseTaskRows } = require('./ledger-parser');
const { NO_ACTIVE_SESSION_MESSAGE, summarizeAwarenessStatus, summarizeExecutedVerificationStatus, summarizeGitStatus, summarizeOperatorNextSteps, summarizePhaseReport } = require('./status-cli');
const { formatArchiveReport } = require('./archive');

function printUsage() {
  console.error('Usage: plan-enforcer-report [archive-path] [--active]');
}

function isActiveLedgerPath(targetPath) {
  return path.basename(targetPath) === 'ledger.md' && path.basename(path.dirname(targetPath)) === '.plan-enforcer';
}

function formatDisplayPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const rel = path.relative(process.cwd(), resolved).replace(/\\/g, '/');
  if (!rel || rel === '') return '.';
  if (!rel.startsWith('..')) return rel;
  return resolved.replace(/\\/g, '/');
}

function resolveTarget(targetArg, opts) {
  opts = opts || {};
  const activePath = path.resolve(process.cwd(), '.plan-enforcer', 'ledger.md');
  if (opts.active) {
    return { targetPath: activePath, mode: 'active' };
  }
  if (!targetArg) {
    if (fs.existsSync(activePath)) {
      return { targetPath: activePath, mode: 'active' };
    }
    return { targetPath: path.resolve(process.cwd(), '.plan-enforcer', 'archive'), mode: 'archive' };
  }
  const targetPath = path.resolve(process.cwd(), targetArg);
  return {
    targetPath,
    mode: isActiveLedgerPath(targetPath) ? 'active' : 'archive'
  };
}

function formatActiveReport(ledgerPath) {
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const meta = parseMetadata(ledger);
  const stats = parseLedger(ledger);
  const rows = parseTaskRows(ledger);
  const current = rows.find((row) => row.status === 'in-progress' || row.status === 'pending') || null;
  const blocked = rows.filter((row) => row.status === 'blocked');
  const unverified = rows.filter((row) => row.status === 'done' && !row.evidence);
  const enforcerDir = path.dirname(ledgerPath);
  const lines = [
    '---🛡 Plan Enforcer Active Report --------------------',
    ` Source: ${meta.source}`,
    ` Tier: ${meta.tier}  |  Started: ${meta.created}`,
    ` Tasks: ${stats.doneCount}/${stats.total} done  |  Verified: ${stats.counts.verified}  |  Remaining: ${stats.remaining}`,
    ` Current: ${current ? `${current.id} - ${current.name}` : 'none'}  |  Drift: ${stats.drift}`,
    '-----------------------------------------------------'
  ];

  if (unverified.length > 0) {
    lines.push('', 'Done but unverified:');
    unverified.forEach((row) => lines.push(`  ${row.id} - ${row.name}`));
  }

  if (blocked.length > 0) {
    lines.push('', 'Blocked:');
    blocked.forEach((row) => lines.push(`  ${row.id} - ${row.name}${row.notes ? ` (${row.notes})` : ''}`));
  }

  const next = summarizeOperatorNextSteps(ledgerPath, ledger);
  const executed = summarizeExecutedVerificationStatus(ledgerPath, ledger);
  const git = summarizeGitStatus(ledgerPath);
  const awareness = summarizeAwarenessStatus(ledgerPath, ledger);
  const phaseReportPath = path.join(enforcerDir, 'phase-report.md');
  const phaseReport = summarizePhaseReport(phaseReportPath);
  const awarenessPath = path.join(enforcerDir, 'awareness.md');
  const discussPath = path.join(enforcerDir, 'discuss.md');
  const checksDir = path.join(enforcerDir, 'checks');
  const archiveDir = path.join(enforcerDir, 'archive');
  const truth = [
    '',
    'Truth surfaces:',
    `  ledger: ${formatDisplayPath(ledgerPath)}`,
    `  phase report: ${formatDisplayPath(phaseReportPath)}${fs.existsSync(phaseReportPath) ? '' : ' (not written yet)'}`,
    `  checks root: ${formatDisplayPath(checksDir)}${fs.existsSync(checksDir) ? '' : ' (none yet)'}`,
    `  archive root: ${formatDisplayPath(archiveDir)}`,
    '',
    'Lineage roots:',
    `  source plan: ${meta.source}`,
    `  discuss packet: ${formatDisplayPath(discussPath)}${fs.existsSync(discussPath) ? '' : ' (missing)'}`,
    `  awareness: ${formatDisplayPath(awarenessPath)}${fs.existsSync(awarenessPath) ? '' : ' (missing)'}`
  ].join('\n');
  return `${lines.join('\n')}${truth}${next}${executed}${git}${awareness}${phaseReport}\n-----------------------------------------------------`;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const active = argv.includes('--active');
  const positionals = argv.filter((arg) => arg !== '--active');
  const { targetPath, mode } = resolveTarget(positionals[0], { active });
  if (!fs.existsSync(targetPath)) {
    if (!positionals[0] && !active && mode === 'archive') {
      console.error(`${NO_ACTIVE_SESSION_MESSAGE} No archive reports found yet.`);
      process.exit(1);
    }
    console.error(`Archive path not found: ${targetPath}`);
    process.exit(1);
  }

  process.stdout.write(mode === 'active'
    ? `${formatActiveReport(targetPath)}\n`
    : `${formatArchiveReport(targetPath)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  formatActiveReport,
  isActiveLedgerPath,
  main,
  resolveTarget
};

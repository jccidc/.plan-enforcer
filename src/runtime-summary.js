const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const { summarizeAwareness } = require('./awareness');
const { formatGitWorktreeSummary, summarizeGitWorktree } = require('./git-worktree');
const { parseMetadata, parseTaskRows, parseLedger } = require('./ledger-parser');
const { assessExecutedVerification } = require('./executed-verification');

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

function buildAwarenessSummary(ledgerPath) {
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  return summarizeAwareness({
    cwd: projectRoot,
    projectRoot,
    ledgerPath,
    awarenessPath: path.join(stateDir, 'awareness.md'),
    config: readConfig(path.join(stateDir, 'config.md'))
  });
}

function formatAwarenessSummary(summary) {
  if (!summary || !summary.initialized) return '';
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

function formatAwarenessLogs(summary) {
  if (!summary || !summary.initialized) return '';
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

function summarizeGitStatus(ledgerPath) {
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  const managedSession = path.basename(stateDir) === '.plan-enforcer' && hasProjectSurface(projectRoot);
  return formatGitWorktreeSummary(summarizeGitWorktree(projectRoot, {
    searchParents: managedSession
  }));
}

function buildExecutedVerificationSummary(ledgerPath) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return null;
  const { stateDir, projectRoot } = resolveStateRoot(ledgerPath);
  const config = readConfig(path.join(stateDir, 'config.md'));
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const rows = parseTaskRows(ledger).filter((row) => row.status === 'verified');
  const summary = {
    initialized: rows.length > 0,
    totalVerified: rows.length,
    ok: 0,
    missing: 0,
    failed: 0,
    stale: 0,
    noCommand: 0,
    issues: [],
    latestByTask: []
  };

  for (const row of rows) {
    const assessment = assessExecutedVerification({
      projectRoot,
      enforcerDir: stateDir,
      taskId: row.id,
      evidenceText: row.evidence,
      config
    });
    summary.latestByTask.push({ taskId: row.id, name: row.name, ...assessment });
    if (assessment.state === 'ok') {
      summary.ok += 1;
    } else if (assessment.state === 'missing') {
      summary.missing += 1;
      summary.issues.push(`${row.id} missing (${assessment.command})`);
    } else if (assessment.state === 'failed') {
      summary.failed += 1;
      summary.issues.push(`${row.id} failed (${assessment.latest.command})`);
    } else if (assessment.state === 'stale') {
      summary.stale += 1;
      summary.issues.push(`${row.id} stale (${assessment.latest.command} != ${assessment.command})`);
    } else {
      summary.noCommand += 1;
      summary.issues.push(`${row.id} no command source`);
    }
  }

  return summary;
}

function formatExecutedVerificationStatus(summary) {
  if (!summary || !summary.initialized) return '';
  const lines = [
    '',
    `Checks: ${summary.ok} ok  |  ${summary.failed} failed  |  ${summary.stale} stale  |  ${summary.missing} missing  |  ${summary.noCommand} no command`
  ];
  if (summary.issues.length > 0) {
    lines.push(`  check issues: ${summary.issues.slice(0, 4).join(', ')}`);
  }
  if (summary.noCommand > 0) {
    lines.push('  next: set `plan-enforcer-config --check-cmd "<command>"` or cite the verification command in Evidence.');
  }
  return lines.join('\n');
}

function formatExecutedVerificationLogs(summary) {
  if (!summary || !summary.initialized) return '';
  const lines = [
    '',
    'EXECUTED CHECKS:',
    `  ok=${summary.ok}  failed=${summary.failed}  stale=${summary.stale}  missing=${summary.missing}  no_command=${summary.noCommand}`
  ];
  if (summary.issues.length > 0) {
    summary.issues.slice(0, 8).forEach((issue) => lines.push(`  ${issue}`));
  }
  return lines.join('\n');
}

function formatActiveReport(ledgerPath) {
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const stats = parseLedger(ledger);
  const meta = parseMetadata(ledger);
  const rows = parseTaskRows(ledger);
  const current = rows.find((row) => row.status === 'in-progress' || row.status === 'pending') || null;
  const unverified = rows.filter((row) => row.status === 'done' && !row.evidence);
  const blocked = rows.filter((row) => row.status === 'blocked');
  const awareness = buildAwarenessSummary(ledgerPath);
  const checks = buildExecutedVerificationSummary(ledgerPath);
  const phase = summarizePhaseReport(path.join(path.dirname(ledgerPath), 'phase-report.md'));
  const git = summarizeGitStatus(ledgerPath);
  const lines = [
    '---Plan Enforcer Active Report ----------------------',
    ` Source: ${meta.source}`,
    ` Tier: ${meta.tier}  |  Tasks: ${stats.doneCount}/${stats.total} done  |  Verified: ${stats.counts.verified}  |  Drift: ${stats.drift}`,
    ` Current: ${current ? `${current.id} - ${current.name}` : 'none'}`,
    '-----------------------------------------------------'
  ];

  if (git) lines.push(git);
  const awarenessText = formatAwarenessSummary(awareness);
  if (awarenessText) lines.push(awarenessText);
  const checkText = formatExecutedVerificationStatus(checks);
  if (checkText) lines.push(checkText);
  if (phase) lines.push(phase);

  const needsAttention = [];
  unverified.forEach((row) => needsAttention.push(`${row.id} done without evidence`));
  blocked.forEach((row) => needsAttention.push(`${row.id} blocked`));
  if (checks) {
    needsAttention.push(...checks.issues);
  }
  if (awareness && awareness.initialized) {
    awareness.orphanRows.slice(0, 4).forEach((row) => needsAttention.push(`${row.id} orphan intent`));
    awareness.quoteIssues.slice(0, 4).forEach((issue) => needsAttention.push(`${issue.row} quote unverified`));
  }

  if (needsAttention.length > 0) {
    lines.push('', 'Needs attention:');
    needsAttention.slice(0, 10).forEach((item) => lines.push(`  ${item}`));
  } else {
    lines.push('', 'Clean active session. No open proof issues detected.');
  }

  lines.push('-----------------------------------------------------');
  return lines.join('\n');
}

module.exports = {
  buildAwarenessSummary,
  buildExecutedVerificationSummary,
  formatActiveReport,
  formatAwarenessLogs,
  formatAwarenessSummary,
  formatExecutedVerificationLogs,
  formatExecutedVerificationStatus,
  hasProjectSurface,
  resolveStateRoot,
  summarizeGitStatus,
  summarizePhaseReport
};

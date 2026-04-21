// Plan Enforcer - Archive
// Archives completed ledgers with YAML frontmatter and cleans up working files.

const fs = require('fs');
const path = require('path');
const {
  parseDecisionLog,
  parseLedger,
  parseMetadata,
  parseReconciliationHistory,
  parseTaskRows
} = require('./ledger-parser');

/**
 * Build archive filename from plan source and current date.
 * @param {string} planSource - Original plan file path
 * @param {Date} [now] - Date to use (defaults to new Date())
 * @returns {string} - Filename like "2026-04-11-my-plan.md"
 */
function buildArchiveFilename(planSource, now) {
  now = now || new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const slug = path.basename(planSource, '.md').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return `${dateStr}-${slug}.md`;
}

/**
 * Build YAML frontmatter for an archived ledger.
 * @param {object} opts
 * @param {string} opts.planSource
 * @param {string} opts.tier
 * @param {number} opts.totalTasks
 * @param {number} opts.verified
 * @param {number} opts.doneUnverified
 * @param {number} opts.skipped
 * @param {number} opts.blocked
 * @param {number} opts.decisions
 * @param {number} opts.reconciliations
 * @param {string} opts.createdAt
 * @param {string} opts.completedAt
 * @returns {string}
 */
function buildFrontmatter(opts) {
  const result = opts.doneUnverified === 0 ? 'clean' : 'has_unverified';
  return `---
plan: ${opts.planSource}
tier: ${opts.tier}
tasks: ${opts.totalTasks}
verified: ${opts.verified}
done_unverified: ${opts.doneUnverified}
skipped: ${opts.skipped}
blocked: ${opts.blocked}
decisions: ${opts.decisions}
reconciliations: ${opts.reconciliations}
started: ${opts.createdAt}
completed: ${opts.completedAt}
result: ${result}
---

`;
}

/**
 * Archive a completed ledger to .plan-enforcer/archive/ and clean up working files.
 * @param {string} enforcerDir - Absolute path to .plan-enforcer/
 * @param {string} ledgerContent - Raw ledger markdown
 * @param {object} stats - Parsed stats from parseLedger()
 * @param {string} tier - Current tier
 * @param {Date} [now] - Date override for testing
 * @returns {{ archiveName: string, archivePath: string }}
 */
function archiveLedger(enforcerDir, ledgerContent, stats, tier, now) {
  now = now || new Date();
  const archiveDir = path.join(enforcerDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });

  const meta = parseMetadata(ledgerContent);
  const archiveName = buildArchiveFilename(meta.source, now);
  const archivePath = path.join(archiveDir, archiveName);

  const skippedCount = (ledgerContent.match(/\|\s*(skipped|superseded)\s*\|/gi) || []).length;
  const blockedCount = (ledgerContent.match(/\|\s*blocked\s*\|/gi) || []).length;
  const decisionCount = (ledgerContent.match(/^\|\s*D\d+/gm) || []).length;
  const reconCount = (ledgerContent.match(/^\|\s*R\d+/gm) || []).length;
  const completedAt = now.toISOString().replace(/\.\d+Z$/, 'Z');

  const frontmatter = buildFrontmatter({
    planSource: meta.source,
    tier,
    totalTasks: stats.total,
    verified: stats.counts.verified,
    doneUnverified: stats.counts.done,
    skipped: skippedCount,
    blocked: blockedCount,
    decisions: decisionCount,
    reconciliations: reconCount,
    createdAt: meta.created,
    completedAt
  });

  fs.writeFileSync(archivePath, frontmatter + ledgerContent);
  return { archiveName, archivePath };
}

/**
 * Clean up working files after archival.
 * @param {string} enforcerDir - Absolute path to .plan-enforcer/
 */
function cleanupWorkingFiles(enforcerDir) {
  const files = ['ledger.md', '.tool-count', '.stale-count', '.ledger-mtime', '.activated', 'statusline-state.json'];
  for (const fileName of files) {
    try {
      fs.unlinkSync(path.join(enforcerDir, fileName));
    } catch (e) {}
  }
}

function parseArchiveFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { metadata: {}, body: content };

  const metadata = {};
  match[1].split('\n').forEach((line) => {
    const parts = line.split(':');
    if (parts.length < 2) return;
    const key = parts.shift().trim();
    metadata[key] = parts.join(':').trim();
  });

  return {
    metadata,
    body: content.slice(match[0].length)
  };
}

function parseArchiveFile(archivePath) {
  const content = fs.readFileSync(archivePath, 'utf8');
  const { metadata, body } = parseArchiveFrontmatter(content);
  const ledger = parseLedger(body);
  const tasks = parseTaskRows(body);
  const decisions = parseDecisionLog(body);
  const reconciliations = parseReconciliationHistory(body);
  const sourceMeta = parseMetadata(body);
  const verdictJsonPath = `${archivePath}.verdict.json`;
  const verdictReportPath = `${archivePath}.verdict.md`;
  let phaseVerdict = null;
  if (fs.existsSync(verdictJsonPath)) {
    try {
      phaseVerdict = JSON.parse(fs.readFileSync(verdictJsonPath, 'utf8'));
    } catch (_e) {}
  }
  const expectedTruthManifestPath = `${archivePath}.final-truth.json`;
  let truthManifest = null;
  if (fs.existsSync(expectedTruthManifestPath)) {
    try {
      truthManifest = JSON.parse(fs.readFileSync(expectedTruthManifestPath, 'utf8'));
    } catch (_e) {}
  }

  return {
    path: archivePath,
    name: path.basename(archivePath),
    metadata,
    ledger,
    tasks,
    decisions,
    reconciliations,
    source: metadata.plan || sourceMeta.source || 'unknown',
    tier: metadata.tier || sourceMeta.tier || 'unknown',
    result: metadata.result || 'unknown',
    completed: metadata.completed || 'unknown',
    phaseVerdict,
    truthManifest,
    expectedTruthManifestPath,
    truthManifestPath: fs.existsSync(expectedTruthManifestPath) ? expectedTruthManifestPath : null,
    verdictJsonPath: fs.existsSync(verdictJsonPath) ? verdictJsonPath : null,
    verdictReportPath: fs.existsSync(verdictReportPath) ? verdictReportPath : null
  };
}

function listArchiveReports(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir)
    .filter((name) => name.endsWith('.md') && !name.endsWith('.verdict.md'))
    .sort()
    .reverse()
    .map((name) => parseArchiveFile(path.join(archiveDir, name)));
}

function summarizeArchiveReports(reports) {
  return reports.reduce((summary, report) => {
    summary.total += 1;
    if (report.result === 'clean') summary.clean += 1;
    if (report.result === 'has_unverified') summary.hasUnverified += 1;
    summary.decisions += report.decisions.length;
    summary.reconciliations += report.reconciliations.length;
    summary.drift += report.ledger.drift;
    return summary;
  }, { total: 0, clean: 0, hasUnverified: 0, decisions: 0, reconciliations: 0, drift: 0 });
}

function formatDisplayPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const rel = path.relative(process.cwd(), resolved).replace(/\\/g, '/');
  if (!rel || rel === '') return '.';
  if (!rel.startsWith('..')) return rel;
  return resolved.replace(/\\/g, '/');
}

function resolveEnforcerDirFromArchiveTarget(targetPath) {
  const resolved = path.resolve(targetPath);
  const stats = fs.statSync(resolved);
  const dir = stats.isDirectory() ? resolved : path.dirname(resolved);
  if (path.basename(dir) !== 'archive') return null;
  const parent = path.dirname(dir);
  return path.basename(parent) === '.plan-enforcer' ? parent : null;
}

function toProjectRelativeRef(targetPath, enforcerDir) {
  if (!targetPath || !enforcerDir) return null;
  const projectRoot = path.dirname(enforcerDir);
  return path.relative(projectRoot, targetPath).replace(/\\/g, '/');
}

function buildArchiveTruthManifest(archivePath) {
  const report = parseArchiveFile(archivePath);
  const enforcerDir = resolveEnforcerDirFromArchiveTarget(archivePath);
  const checksRoot = enforcerDir ? path.join(enforcerDir, 'checks') : null;
  const awarenessPath = enforcerDir ? path.join(enforcerDir, 'awareness.md') : null;
  const discussPath = enforcerDir ? path.join(enforcerDir, 'discuss.md') : null;
  const manifestPath = `${archivePath}.final-truth.json`;
  const archiveRef = enforcerDir ? toProjectRelativeRef(report.path, enforcerDir) : report.name;
  const manifestRef = enforcerDir ? toProjectRelativeRef(manifestPath, enforcerDir) : path.basename(manifestPath);
  const verdictJsonRef = report.verdictJsonPath
    ? (enforcerDir ? toProjectRelativeRef(report.verdictJsonPath, enforcerDir) : path.basename(report.verdictJsonPath))
    : null;
  const verdictReportRef = report.verdictReportPath
    ? (enforcerDir ? toProjectRelativeRef(report.verdictReportPath, enforcerDir) : path.basename(report.verdictReportPath))
    : null;
  const checksRootRef = checksRoot ? toProjectRelativeRef(checksRoot, enforcerDir) : null;
  const awarenessRef = awarenessPath ? toProjectRelativeRef(awarenessPath, enforcerDir) : null;
  const discussRef = discussPath ? toProjectRelativeRef(discussPath, enforcerDir) : null;

  return {
    schema: 'v2',
    archived_at: report.completed,
    source_plan: report.source,
    tier: report.tier,
    result: report.result,
    counts: {
      total_tasks: report.ledger.total,
      verified: report.ledger.counts.verified,
      done_unverified: report.ledger.counts.done,
      remaining: report.ledger.remaining,
      drift: report.ledger.drift,
      decisions: report.decisions.length,
      reconciliations: report.reconciliations.length
    },
    truth_surfaces: {
      archive_markdown: archiveRef,
      final_truth_manifest: manifestRef,
      phase_verdict_json: verdictJsonRef,
      phase_verdict_report: verdictReportRef,
      checks_root: checksRootRef
    },
    lineage_roots: {
      source_plan: report.source,
      discuss_packet: discussRef,
      awareness: awarenessRef
    },
    dossier_bundle: {
      source_plan: report.source,
      discuss_packet: discussRef,
      awareness: awarenessRef,
      archive_markdown: archiveRef,
      final_truth_manifest: manifestRef,
      phase_verdict_report: verdictReportRef,
      phase_verdict_json: verdictJsonRef,
      checks_root: checksRootRef
    },
    closure_snapshot: {
      tasks: report.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        evidence: task.evidence,
        chain: task.chain,
        notes: task.notes
      })),
      decision_log: report.decisions.map((entry) => ({
        id: entry.id,
        type: entry.type,
        scope: entry.scope,
        reason: entry.reason,
        evidence: entry.evidence
      })),
      reconciliations: report.reconciliations.map((entry) => ({
        id: entry.id,
        tasks_checked: (entry.cols[1] || '').trim(),
        gaps_found: (entry.cols[2] || '').trim(),
        action_taken: (entry.cols[3] || '').trim()
      }))
    }
  };
}

function writeArchiveTruthManifest(archivePath) {
  const manifestPath = `${archivePath}.final-truth.json`;
  const manifest = buildArchiveTruthManifest(archivePath);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifestPath, manifest };
}

function formatStoredRef(ref) {
  return String(ref || '').replace(/\\/g, '/');
}

function buildArchiveTruthSections(targetPath, focusReport) {
  if (!focusReport) return [];

  const enforcerDir = resolveEnforcerDirFromArchiveTarget(targetPath);
  const truthSurfaces = focusReport.truthManifest && focusReport.truthManifest.truth_surfaces
    ? focusReport.truthManifest.truth_surfaces
    : {};
  const lineageRoots = focusReport.truthManifest && focusReport.truthManifest.lineage_roots
    ? focusReport.truthManifest.lineage_roots
    : {};
  const dossierBundle = focusReport.truthManifest && focusReport.truthManifest.dossier_bundle
    ? focusReport.truthManifest.dossier_bundle
    : {};
  const closureSnapshot = focusReport.truthManifest && focusReport.truthManifest.closure_snapshot
    ? focusReport.truthManifest.closure_snapshot
    : null;
  const lines = ['', 'Final truth:'];
  lines.push(`  archive: ${formatDisplayPath(focusReport.path)}`);
  const truthManifestPath = focusReport.truthManifestPath || focusReport.expectedTruthManifestPath;
  const storedManifestRef = truthSurfaces.final_truth_manifest || null;
  lines.push(`  final truth manifest: ${storedManifestRef ? formatStoredRef(storedManifestRef) : formatDisplayPath(truthManifestPath)}${focusReport.truthManifestPath ? '' : ' (not written yet)'}`);
  lines.push(`  phase verify report: ${focusReport.verdictReportPath ? formatDisplayPath(focusReport.verdictReportPath) : 'none yet'}`);
  const checksRoot = truthSurfaces.checks_root || null;
  if (enforcerDir) {
    const checksDir = path.join(enforcerDir, 'checks');
    lines.push(`  checks root: ${checksRoot ? formatStoredRef(checksRoot) : `${formatDisplayPath(checksDir)}${fs.existsSync(checksDir) ? '' : ' (none yet)'}`}`);
  }

  lines.push('', 'Lineage roots:');
  const sourcePlan = lineageRoots.source_plan || focusReport.source;
  lines.push(`  source plan: ${sourcePlan}`);
  const discussRef = lineageRoots.discuss_packet || dossierBundle.discuss_packet || null;
  if (enforcerDir) {
    const discussPath = path.join(enforcerDir, 'discuss.md');
    lines.push(`  discuss packet: ${discussRef ? formatStoredRef(discussRef) : `${formatDisplayPath(discussPath)}${fs.existsSync(discussPath) ? '' : ' (missing)'}`}`);
  } else if (discussRef) {
    lines.push(`  discuss packet: ${formatStoredRef(discussRef)}`);
  }
  const awarenessRef = lineageRoots.awareness || dossierBundle.awareness || null;
  if (enforcerDir) {
    const awarenessPath = path.join(enforcerDir, 'awareness.md');
    lines.push(`  awareness: ${awarenessRef ? formatStoredRef(awarenessRef) : `${formatDisplayPath(awarenessPath)}${fs.existsSync(awarenessPath) ? '' : ' (missing)'}`}`);
  } else if (awarenessRef) {
    lines.push(`  awareness: ${formatStoredRef(awarenessRef)}`);
  }

  lines.push('', 'Dossier bundle:');
  lines.push(`  final truth manifest: ${storedManifestRef ? formatStoredRef(storedManifestRef) : formatDisplayPath(truthManifestPath)}`);
  lines.push(`  archive: ${dossierBundle.archive_markdown ? formatStoredRef(dossierBundle.archive_markdown) : formatDisplayPath(focusReport.path)}`);
  lines.push(`  source plan: ${dossierBundle.source_plan || sourcePlan}`);
  if (discussRef) {
    lines.push(`  discuss packet: ${formatStoredRef(discussRef)}`);
  }
  if (awarenessRef) {
    lines.push(`  awareness: ${formatStoredRef(awarenessRef)}`);
  }
  if (dossierBundle.phase_verdict_report || focusReport.verdictReportPath) {
    lines.push(`  phase verify report: ${dossierBundle.phase_verdict_report ? formatStoredRef(dossierBundle.phase_verdict_report) : formatDisplayPath(focusReport.verdictReportPath)}`);
  }
  if (checksRoot) {
    lines.push(`  checks root: ${formatStoredRef(checksRoot)}`);
  }
  if (closureSnapshot) {
    lines.push(`  closure snapshot: tasks=${closureSnapshot.tasks.length} decisions=${closureSnapshot.decision_log.length} reconciliations=${closureSnapshot.reconciliations.length}`);
  }
  return lines;
}

function parseCompletedTime(report) {
  const ms = Date.parse(report && report.completed ? report.completed : '');
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function pickFocusReport(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  const candidates = reports.filter((report) => report.result === 'clean');
  const pool = candidates.length > 0 ? candidates : reports;
  return pool.reduce((best, report) => {
    if (!best) return report;
    return parseCompletedTime(report) > parseCompletedTime(best) ? report : best;
  }, null);
}

function formatArchiveReport(targetPath) {
  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) {
    const reports = listArchiveReports(targetPath);
    const summary = summarizeArchiveReports(reports);
    const focusReport = pickFocusReport(reports);
    const lines = [
      '---Plan Enforcer Report ------------------------------',
      ` Runs: ${summary.total}  |  Clean: ${summary.clean}  |  Needs verification: ${summary.hasUnverified}`,
      ` Drift events: ${summary.drift}  |  Decisions: ${summary.decisions}  |  Reconciliations: ${summary.reconciliations}`,
      '-----------------------------------------------------'
    ];

    if (reports.length === 0) {
      lines.push('', 'No archived runs found.');
    } else {
      lines.push(...buildArchiveTruthSections(targetPath, focusReport));
      lines.push('', 'Archived runs:');
      reports.forEach((report) => {
      lines.push(`  ${report.name}  ${report.result}  ${report.ledger.doneCount}/${report.ledger.total} done  drift=${report.ledger.drift}  source=${report.source}`);
      if (report.phaseVerdict) {
        lines[lines.length - 1] += `  phase=${report.phaseVerdict.totals.verified}/${report.phaseVerdict.totals.total_tasks}`;
      }
    });
    }

    lines.push('-----------------------------------------------------');
    return lines.join('\n');
  }

  const report = parseArchiveFile(targetPath);
  const unverified = report.tasks.filter((task) => task.status === 'done' && !task.evidence);
  const skipped = report.tasks.filter((task) => task.status === 'skipped' || task.status === 'superseded');
  const lines = [
    '---Plan Enforcer Archive -----------------------------',
    ` File: ${report.name}`,
    ` Source: ${report.source}`,
    ` Tier: ${report.tier}  |  Result: ${report.result}  |  Completed: ${report.completed}`,
    ` Tasks: ${report.ledger.doneCount}/${report.ledger.total} done  |  Drift: ${report.ledger.drift}  |  Decisions: ${report.decisions.length}`,
    '-----------------------------------------------------'
  ];
  lines.push(...buildArchiveTruthSections(targetPath, report));

  if (report.phaseVerdict) {
    lines.push('', 'Phase verify:');
    lines.push(`  ${report.phaseVerdict.pass ? 'pass' : 'fail'}  verified=${report.phaseVerdict.totals.verified}/${report.phaseVerdict.totals.total_tasks}  unfinished=${report.phaseVerdict.totals.unfinished}`);
    if (report.phaseVerdict.warnings && report.phaseVerdict.warnings.length > 0) {
      report.phaseVerdict.warnings.slice(0, 4).forEach((warning) => lines.push(`  warning: ${warning}`));
    }
    if (report.verdictReportPath) {
      lines.push(`  report: ${report.verdictReportPath}`);
    }
  }

  if (skipped.length > 0) {
    lines.push('', 'Skipped/superseded:');
    skipped.forEach((task) => lines.push(`  ${task.id} - ${task.name}${task.notes ? ` (${task.notes})` : ''}`));
  }

  if (unverified.length > 0) {
    lines.push('', 'Done but unverified:');
    unverified.forEach((task) => lines.push(`  ${task.id} - ${task.name}`));
  }

  if (report.decisions.length > 0) {
    lines.push('', 'Decision log:');
    report.decisions.forEach((entry) => {
      lines.push(`  ${entry.id}  ${(entry.cols[1] || '').trim()} ${(entry.cols[2] || '').trim()} - ${(entry.cols[3] || '').trim()}`);
    });
  }

  lines.push('-----------------------------------------------------');
  return lines.join('\n');
}

module.exports = {
  buildArchiveTruthManifest,
  buildArchiveFilename,
  buildFrontmatter,
  archiveLedger,
  cleanupWorkingFiles,
  formatArchiveReport,
  listArchiveReports,
  parseArchiveFile,
  parseArchiveFrontmatter,
  writeArchiveTruthManifest,
  summarizeArchiveReports,
  pickFocusReport
};

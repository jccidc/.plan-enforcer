#!/usr/bin/env node
// plan-enforcer-phase-verify — phase-end archive/context verifier.
//
// Reads the latest archived ledger plus optional phase-context.md and emits a
// structured phase verdict from disk artifacts. This is intentionally lighter
// than a full benchmark judge: it does not semantically prove the feature, but
// it does convert the phase archive into machine-readable truth/evidence
// surfaces that a later phase-end verifier can build on.

const fs = require('fs');
const path = require('path');
const { parseArchiveFile } = require('./archive');
const { extractTasksFromContent } = require('./plan-detector');

function parseArgs(argv) {
  const args = { json: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--archive') args.archive = argv[++i];
    else if (a === '--context') args.context = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--write') args.write = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer phase-verify [--archive <path>] [--context <path>] [--json] [--write]',
    '',
    'Reads the latest archived phase ledger plus .plan-enforcer/phase-context.md',
    'and emits a structured phase verdict from disk.',
    '',
    'Exit codes:',
    '  0  phase archive is structurally complete',
    '  1  archive exists but has unfinished rows',
    '  2  config / file resolution error'
  ].join('\n');
}

function latestArchivePath(archiveDir) {
  if (!fs.existsSync(archiveDir)) return null;
  const files = fs.readdirSync(archiveDir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  if (files.length === 0) return null;
  return path.join(archiveDir, files[files.length - 1]);
}

function resolveDefaults(args) {
  const cwd = process.cwd();
  const enforcerDir = path.join(cwd, '.plan-enforcer');
  const archive = args.archive || latestArchivePath(path.join(enforcerDir, 'archive'));
  if (!archive || !fs.existsSync(archive)) {
    return { error: 'No phase archive found. Pass --archive <path> or run from a project root with .plan-enforcer/archive/.' };
  }
  const context = args.context || path.join(enforcerDir, 'phase-context.md');
  return { archive, context, enforcerDir, projectRoot: cwd };
}

function parsePhaseContext(contextPath) {
  if (!contextPath || !fs.existsSync(contextPath)) return null;
  const raw = fs.readFileSync(contextPath, 'utf8');
  function extract(label) {
    const match = raw.match(new RegExp(`^- ${label}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : '';
  }
  const focusFiles = extract('Focus files');
  const verification = extract('Verification');
  const decisions = extract('Decisions');
  return {
    path: contextPath,
    source: extract('Source'),
    tier: extract('Tier'),
    archive: extract('Archive'),
    completed_rows: Number(extract('Completed rows') || 0),
    focus_files: focusFiles && focusFiles !== 'none recorded'
      ? focusFiles.split(/\s*;\s*/).filter(Boolean)
      : [],
    verification: verification && verification !== 'none recorded'
      ? verification.split(/\s*;\s*/).filter(Boolean)
      : [],
    decisions: decisions
      ? decisions.split(/\s*;\s*/).filter(Boolean)
      : []
  };
}

function resolveReplayRoots(projectRoot, context) {
  const roots = [projectRoot];
  if (context && context.path) {
    const phaseDir = path.dirname(context.path);
    const cellDir = path.dirname(phaseDir);
    const artifactRoot = path.join(cellDir, 'worktree-artifacts');
    if (fs.existsSync(artifactRoot)) roots.push(artifactRoot);
  }
  return [...new Set(roots)];
}

function resolveExistingPath(relPath, projectRoot, context) {
  for (const root of resolveReplayRoots(projectRoot, context)) {
    const candidate = path.join(root, relPath);
    if (fs.existsSync(candidate)) return { path: candidate, root };
  }
  return null;
}

function resolvePlanPath(planSource, projectRoot, context) {
  const candidates = [];
  if (planSource && planSource !== 'unknown') {
    candidates.push(path.isAbsolute(planSource) ? planSource : path.join(projectRoot, planSource));
    if (!path.isAbsolute(planSource)) {
      for (const root of resolveReplayRoots(projectRoot, context).slice(1)) {
        candidates.push(path.join(root, planSource));
      }
    }
  }
  if (context && context.path) {
    candidates.push(path.join(path.dirname(context.path), 'plan.md'));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function extractSectionItems(content, heading) {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const items = [];
  let inSection = false;
  const headerRe = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
  for (const line of lines) {
    if (headerRe.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet && bullet[1].trim()) items.push(bullet[1].trim());
  }
  return items;
}

function extractPhasePlanFromPrompt(promptPath) {
  if (!promptPath || !fs.existsSync(promptPath)) return null;
  const raw = fs.readFileSync(promptPath, 'utf8');
  const match = raw.match(/---PHASE PLAN START---\r?\n([\s\S]*?)\r?\n---PHASE PLAN END---/);
  return match ? match[1].trim() : null;
}

function extractCodeSpans(text) {
  const spans = [];
  for (const m of String(text || '').matchAll(/`([^`]+)`/g)) {
    spans.push(m[1].trim());
  }
  return spans;
}

function extractCandidatePaths(text) {
  if (!text) return [];
  const matches = text.match(/\b(?:README\.md|package\.json|[\w.-]+\/[\w./-]+\.[A-Za-z0-9_-]+)\b/g) || [];
  return [...new Set(matches)];
}

function buildTaskVerdict(task, projectRoot, context) {
  const evidenceRefs = extractCandidatePaths(`${task.evidence || ''} ${task.notes || ''}`);
  const evidenceFiles = evidenceRefs.map((relPath) => {
    const hit = resolveExistingPath(relPath, projectRoot, context);
    return {
      path: relPath,
      exists: Boolean(hit),
      resolved_from: hit ? hit.root : null
    };
  });
  const terminal = new Set(['verified', 'done', 'skipped', 'blocked', 'superseded']).has(task.status);
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    shipped: terminal,
    evidence: task.evidence || '',
    chain: task.chain || [],
    evidence_files: evidenceFiles
  };
}

function buildPlanSignals(planPath, planContent, report, projectRoot, context) {
  if (!planPath && !planContent) {
    return {
      plan_path: null,
      plan_source: 'missing',
      task_name_matches: [],
      outputs: [],
      verification: [],
      warnings: ['phase plan file not found on disk during verification']
    };
  }

  const content = planContent || fs.readFileSync(planPath, 'utf8');
  const taskNames = extractTasksFromContent(content).tasks;
  const outputItems = extractSectionItems(content, 'Outputs');
  const verificationItems = extractSectionItems(content, 'Verification');
  const contextVerification = new Set((context && context.verification) || []);

  const taskNameMatches = report.tasks.map((task, index) => ({
    id: task.id,
    archived_name: task.name,
    planned_name: taskNames[index] || null,
    matches: (taskNames[index] || '').trim() === task.name.trim()
  }));

  const outputs = outputItems.map((item) => {
    const refs = extractCodeSpans(item).flatMap((span) => extractCandidatePaths(span));
    const uniqueRefs = [...new Set(refs)];
    return {
      text: item,
      artifacts: uniqueRefs.map((relPath) => {
        const hit = resolveExistingPath(relPath, projectRoot, context);
        return {
          path: relPath,
          exists: Boolean(hit),
          resolved_from: hit ? hit.root : null
        };
      })
    };
  });

  const verification = verificationItems.map((item) => {
    const commands = extractCodeSpans(item);
    const labels = commands.map((command) => ({
      command,
      seen_in_context: contextVerification.has(command)
    }));
    return { text: item, commands: labels };
  });

  const warnings = [];
  if (taskNameMatches.some((entry) => !entry.matches)) {
    warnings.push('archived task names diverge from the current phase plan');
  }
  if (outputs.some((entry) => entry.artifacts.length > 0 && entry.artifacts.some((artifact) => !artifact.exists))) {
    warnings.push('one or more coded output artifacts from the phase plan are missing on disk');
  }
  if (verification.some((entry) => entry.commands.some((cmd) => !cmd.seen_in_context))) {
    warnings.push('one or more coded verification commands were not captured in phase-context.md');
  }

  return {
    plan_path: planPath,
    plan_source: planPath ? 'file' : 'prompt.txt',
    task_name_matches: taskNameMatches,
    outputs,
    verification,
    warnings
  };
}

function buildVerdict(archivePath, projectRoot, context) {
  const report = parseArchiveFile(archivePath);
  const planPath = resolvePlanPath(report.source, projectRoot, context);
  const promptPlan = context && context.path
    ? extractPhasePlanFromPrompt(path.join(path.dirname(context.path), 'prompt.txt'))
    : null;
  const taskVerdicts = report.tasks.map((task) => buildTaskVerdict(task, projectRoot, context));
  const unfinished = taskVerdicts.filter((task) => !task.shipped);
  const focusFiles = (context && context.focus_files) ? context.focus_files.map((relPath) => {
    const hit = resolveExistingPath(relPath, projectRoot, context);
    return {
      path: relPath,
      exists: Boolean(hit),
      resolved_from: hit ? hit.root : null
    };
  }) : [];
  const planSignals = buildPlanSignals(planPath, promptPlan, report, projectRoot, context);
  const warnings = [];
  if (focusFiles.some((file) => !file.exists)) {
    warnings.push('one or more focus files from phase-context.md are missing on disk');
  }
  warnings.push(...planSignals.warnings);

  return {
    judge: 'phase-verify-cli@v1',
    archive: archivePath,
    source: report.source,
    tier: report.tier,
    completed_at: report.completed,
    result: report.result,
    pass: unfinished.length === 0,
    totals: {
      total_tasks: report.tasks.length,
      verified: report.tasks.filter((task) => task.status === 'verified').length,
      done: report.tasks.filter((task) => task.status === 'done').length,
      skipped: report.tasks.filter((task) => task.status === 'skipped' || task.status === 'superseded').length,
      blocked: report.tasks.filter((task) => task.status === 'blocked').length,
      unfinished: unfinished.length
    },
    tasks: taskVerdicts,
    decisions: report.decisions.map((entry) => ({
      id: entry.id,
      type: entry.type,
      scope: entry.scope,
      reason: entry.reason,
      evidence: entry.evidence
    })),
    context: context ? {
      path: context.path,
      focus_files: focusFiles,
      verification: context.verification,
      decisions: context.decisions
    } : null,
    plan: planSignals,
    warnings
  };
}

function formatVerdictReport(verdict) {
  const lines = [
    '# Phase Verify Report',
    '',
    `- Archive: ${verdict.archive}`,
    `- Source: ${verdict.source}`,
    `- Tier: ${verdict.tier}`,
    `- Result: ${verdict.pass ? 'pass' : 'fail'}`,
    `- Verified rows: ${verdict.totals.verified}/${verdict.totals.total_tasks}`,
    `- Unfinished rows: ${verdict.totals.unfinished}`
  ];

  if (verdict.context && verdict.context.focus_files.length > 0) {
    lines.push(`- Focus files: ${verdict.context.focus_files.map((file) => `${file.path}${file.exists ? '' : ' (missing)'}`).join('; ')}`);
  }
  if (verdict.context && verdict.context.verification.length > 0) {
    lines.push(`- Verification: ${verdict.context.verification.join('; ')}`);
  }

  const unfinished = verdict.tasks.filter((task) => !task.shipped);
  if (unfinished.length > 0) {
    lines.push('', '## Unfinished Rows', '');
    unfinished.forEach((task) => {
      lines.push(`- ${task.id} ${task.name} [${task.status}]`);
    });
  }

  const planWarnings = verdict.warnings || [];
  if (planWarnings.length > 0) {
    lines.push('', '## Warnings', '');
    planWarnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  if (verdict.decisions && verdict.decisions.length > 0) {
    lines.push('', '## Decisions', '');
    verdict.decisions.slice(0, 8).forEach((entry) => {
      lines.push(`- ${entry.id} [${entry.type}] ${entry.scope}: ${entry.reason}`);
    });
  }

  return lines.join('\n') + '\n';
}

function writeVerdict(enforcerDir, verdict) {
  const jsonPath = path.join(enforcerDir, 'phase-verdict.json');
  const reportPath = path.join(enforcerDir, 'phase-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(verdict, null, 2) + '\n', 'utf8');
  fs.writeFileSync(reportPath, formatVerdictReport(verdict), 'utf8');
  return { jsonPath, reportPath };
}

function writeArchiveVerdict(archivePath, verdict) {
  const jsonPath = `${archivePath}.verdict.json`;
  const reportPath = `${archivePath}.verdict.md`;
  fs.writeFileSync(jsonPath, JSON.stringify(verdict, null, 2) + '\n', 'utf8');
  fs.writeFileSync(reportPath, formatVerdictReport(verdict), 'utf8');
  return { jsonPath, reportPath };
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const resolved = resolveDefaults(args);
  if (resolved.error) {
    console.error(resolved.error);
    return 2;
  }

  const context = parsePhaseContext(resolved.context);
  const verdict = buildVerdict(resolved.archive, resolved.projectRoot, context);
  let written = null;
  if (args.write) {
    written = writeVerdict(resolved.enforcerDir, verdict);
  }

  if (args.json) {
    const payload = written ? { ...verdict, written } : verdict;
    console.log(JSON.stringify(payload, null, 2));
    return verdict.pass ? 0 : 1;
  }

  console.log(`Plan Enforcer Phase Verify — ${path.basename(resolved.archive)}`);
  console.log(`Source: ${verdict.source}`);
  console.log(`Tier: ${verdict.tier}`);
  console.log('');
  console.log(`${verdict.totals.verified}/${verdict.totals.total_tasks} rows verified; ${verdict.totals.unfinished} unfinished.`);
  if (verdict.context && verdict.context.focus_files.length > 0) {
    console.log(`Focus files: ${verdict.context.focus_files.map((file) => `${file.path}${file.exists ? '' : ' (missing)'}`).join(', ')}`);
  }
  if (verdict.context && verdict.context.verification.length > 0) {
    console.log(`Verification: ${verdict.context.verification.join(', ')}`);
  }
  if (written) {
    console.log(`Wrote: ${written.jsonPath}`);
    console.log(`Report: ${written.reportPath}`);
  }
  if (verdict.warnings.length > 0) {
    console.log('');
    verdict.warnings.forEach((warning) => console.log(`Warning: ${warning}`));
  }
  return verdict.pass ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  buildPlanSignals,
  buildTaskVerdict,
  buildVerdict,
  extractCodeSpans,
  extractPhasePlanFromPrompt,
  extractSectionItems,
  formatVerdictReport,
  latestArchivePath,
  main,
  resolvePlanPath,
  parseArgs,
  parsePhaseContext,
  resolveDefaults,
  usage,
  writeArchiveVerdict,
  writeVerdict
};

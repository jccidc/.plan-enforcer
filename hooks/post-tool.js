#!/usr/bin/env node
// Plan Enforcer - Unified PostToolUse Hook

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { archiveLedger, cleanupWorkingFiles, writeArchiveTruthManifest } = require('../src/archive');
const { readConfig } = require('../src/config');
const {
  parseDecisionLog,
  parseMetadata,
  parseTaskRows
} = require('../src/ledger-parser');
const {
  extractTasksFromContent,
  generateLedger,
  isPlanContent
} = require('../src/plan-detector');
const { detectPartialLedgerEdit } = require('../src/partial-ledger-edit');
const { buildVerdict, parsePhaseContext, writeArchiveVerdict, writeVerdict } = require('../src/phase-verify-cli');
const { clearStatuslineState, writeTaskStatuslineState } = require('../src/statusline-state');

function ledgerHash(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 8);
}

const cwd = process.cwd();
const cwdEnforcerDir = path.join(cwd, '.plan-enforcer');
const activeRootPath = path.join(cwdEnforcerDir, '.active-root');

let toolContext = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw) toolContext = JSON.parse(raw);
} catch (e) {}

// Find-up: walk parent dirs for an existing .plan-enforcer with a ledger or archive.
// Needed when agent cds into a subdir created by the plan (e.g., "url-shortener-cli").
// Only return a hit if the enclosing dir is an actual project root (.git or package.json).
// Prevents matching a stale ~/.plan-enforcer/ etc.
function findUpEnforcerDir(startDir) {
  let dir = startDir;
  const rootPath = path.parse(dir).root;
  for (let depth = 0; depth < 3 && dir && dir !== rootPath; depth++) {
    const candidate = path.join(dir, '.plan-enforcer');
    const hasLedger = fs.existsSync(path.join(candidate, 'ledger.md')) || fs.existsSync(path.join(candidate, 'archive'));
    const isProjectRoot = fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
    if (hasLedger && isProjectRoot) {
      return dir;
    }
    if (isProjectRoot || fs.existsSync(path.join(dir, '.plan-enforcer-stop'))) {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Find-down (shallow): catches case where the agent put the ledger in a nested project dir.
function findDownEnforcerDir(startDir, maxDepth) {
  maxDepth = maxDepth || 3;
  const stack = [{ dir: startDir, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.shift();
    if (depth > maxDepth) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.name === '.plan-enforcer') {
          if (fs.existsSync(path.join(full, 'ledger.md')) || fs.existsSync(path.join(full, 'archive'))) {
            return dir;
          }
        }
        stack.push({ dir: full, depth: depth + 1 });
      }
    } catch (e) {}
  }
  return null;
}

let projectRoot = cwd;
// Priority 1: .active-root redirect
try {
  const storedRoot = fs.readFileSync(activeRootPath, 'utf8').trim();
  if (storedRoot && fs.existsSync(path.join(storedRoot, '.plan-enforcer'))) {
    projectRoot = storedRoot;
  }
} catch (e) {}

// Priority 2: if cwd doesn't have a ledger/archive, search up then down
if (projectRoot === cwd && !fs.existsSync(path.join(cwdEnforcerDir, 'ledger.md')) && !fs.existsSync(path.join(cwdEnforcerDir, 'archive'))) {
  const upFound = findUpEnforcerDir(cwd);
  if (upFound) {
    projectRoot = upFound;
  } else {
    const downFound = findDownEnforcerDir(cwd, 3);
    if (downFound) projectRoot = downFound;
  }
}

const enforcerDir = path.join(projectRoot, '.plan-enforcer');
const ledgerPath = path.join(enforcerDir, 'ledger.md');
const configPath = path.join(enforcerDir, 'config.md');
const toolCountPath = path.join(enforcerDir, '.tool-count');
const staleCountPath = path.join(enforcerDir, '.stale-count');
const ledgerMtimePath = path.join(enforcerDir, '.ledger-mtime');
const markerPath = path.join(enforcerDir, '.activated');
const sessionLogPath = path.join(enforcerDir, '.session-log.jsonl');

// Cap on session-log file size. If exceeded we rotate the oldest half out
// by keeping the tail. 5 MB is generous for a single session; rare
// rotations only. Defensive against runaway sessions.
const SESSION_LOG_MAX_BYTES = 5 * 1024 * 1024;

// Append a tool-call record to the session log. Feeds the P2 evidence
// matcher — callers of evidence validation need access to 'what tool
// calls happened this session and what did they return' without
// depending on Claude Code exposing session history directly.
function appendSessionLog(toolContext) {
  if (!toolContext || !toolContext.tool_name) return;
  if (!fs.existsSync(enforcerDir)) return;
  try {
    if (fs.existsSync(sessionLogPath)) {
      const stat = fs.statSync(sessionLogPath);
      if (stat.size > SESSION_LOG_MAX_BYTES) {
        // Keep the tail half — retains recent history, drops oldest.
        const raw = fs.readFileSync(sessionLogPath, 'utf8');
        const lines = raw.split('\n');
        fs.writeFileSync(sessionLogPath, lines.slice(Math.floor(lines.length / 2)).join('\n'));
      }
    }
    const record = {
      ts: new Date().toISOString(),
      tool: toolContext.tool_name,
      input: toolContext.tool_input || null,
      response: toolContext.tool_response || null
    };
    fs.appendFileSync(sessionLogPath, JSON.stringify(record) + '\n');
  } catch (e) {
    // Non-fatal. Session log is best-effort.
  }
}

// Fire the append immediately. No guard — we want EVERY tool call in
// the log, including the Read that triggered auto-activation.
appendSessionLog(toolContext);

function readCounter(filePath) {
  try {
    return parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function writeCounter(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(value));
  } catch (e) {}
}

function findProjectRoot(filePath) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function getLedgerStats(ledger) {
  const pendingCount = (ledger.match(/\|\s*pending\s*\|/gi) || []).length;
  const inProgressCount = (ledger.match(/\|\s*in-progress\s*\|/gi) || []).length;
  const doneCount = (ledger.match(/\|\s*done\s*\|/gi) || []).length;
  const verifiedCount = (ledger.match(/\|\s*verified\s*\|/gi) || []).length;
  const skippedCount = (ledger.match(/\|\s*(skipped|superseded)\s*\|/gi) || []).length;
  const blockedCount = (ledger.match(/\|\s*blocked\s*\|/gi) || []).length;
  const remaining = pendingCount + inProgressCount;
  const totalTasks = (ledger.match(/^\|\s*T\d+/gm) || []).length;
  return { pendingCount, inProgressCount, doneCount, verifiedCount, skippedCount, blockedCount, remaining, totalTasks };
}

// Extract in-progress task IDs so we can flag stuck ones
function getInProgressTaskIds(ledger) {
  const matches = [...ledger.matchAll(/^\|\s*(T\d+)\s*\|[^|]+\|\s*in-progress\s*\|/gim)];
  return matches.map((m) => m[1]);
}

function getNextTaskSummary(ledger) {
  const match = ledger.match(/^\|\s*(T\d+)\s*\|\s*([^|]+?)\s*\|\s*(pending|in-progress)\s*\|/im);
  if (!match) return null;
  return { id: match[1], name: match[2].trim(), status: match[3].trim().toLowerCase() };
}

function readSessionRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function collectTouchedFiles(records, projectRoot) {
  const seen = new Set();
  const out = [];
  for (const record of records) {
    if (!['Edit', 'Write', 'MultiEdit'].includes(record.tool)) continue;
    const input = record.input || {};
    const rawPath = input.file_path || input.path;
    if (!rawPath || typeof rawPath !== 'string') continue;
    const absPath = path.isAbsolute(rawPath) ? rawPath : path.join(projectRoot, rawPath);
    const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
    if (!relPath || relPath.startsWith('..') || relPath.startsWith('.plan-enforcer/')) continue;
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    out.push(relPath);
    if (out.length >= 5) break;
  }
  return out;
}

function summarizeVerificationCommand(command) {
  const parts = String(command || '')
    .split(/&&|;|\|\|/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const labels = [];
  const seen = new Set();
  for (const part of parts) {
    let label = null;
    const npmRun = part.match(/\bnpm run ([\w:-]+)/i);
    const pnpmRun = part.match(/\bpnpm run ([\w:-]+)/i);
    const yarnRun = part.match(/\byarn ([\w:-]+)/i);
    if (/\bnpm test\b/i.test(part)) label = 'npm test';
    else if (npmRun) label = `npm run ${npmRun[1]}`;
    else if (/\bnode --test\b/i.test(part)) label = 'node --test';
    else if (/\bpytest\b/i.test(part)) label = 'pytest';
    else if (/\bcargo test\b/i.test(part)) label = 'cargo test';
    else if (/\bgo test\b/i.test(part)) label = 'go test';
    else if (pnpmRun) label = `pnpm run ${pnpmRun[1]}`;
    else if (yarnRun) label = `yarn ${yarnRun[1]}`;
    else if (/\bcurl\b/i.test(part) && /\/health\b/i.test(part)) label = 'curl /health';
    else if (/\bcurl\b/i.test(part)) label = 'curl';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function collectVerificationCommands(records) {
  const keep = [];
  const seen = new Set();
  for (const record of records) {
    if (record.tool !== 'Bash') continue;
    const command = record.input && record.input.command;
    if (!command || typeof command !== 'string') continue;
    if (!/\b(npm test|npm run|node --test|pytest|cargo test|go test|pnpm test|yarn test|curl)\b/i.test(command)) {
      continue;
    }
    for (const label of summarizeVerificationCommand(command)) {
      if (seen.has(label)) continue;
      seen.add(label);
      keep.push(label);
      if (keep.length >= 4) break;
    }
    if (keep.length >= 4) break;
  }
  return keep;
}

function writePhaseContext(enforcerDir, ledger, archiveName) {
  try {
    const projectRoot = path.dirname(enforcerDir);
    const tasks = parseTaskRows(ledger).filter((row) => row.status === 'verified' || row.status === 'done');
    const decisions = parseDecisionLog(ledger).slice(0, 6);
    const metadata = parseMetadata(ledger);
    const records = readSessionRecords(sessionLogPath);
    const touchedFiles = collectTouchedFiles(records, projectRoot);
    const verificationCommands = collectVerificationCommands(records);
    const contextPath = path.join(enforcerDir, 'phase-context.md');
    const lines = [
      '# Phase Context',
      '',
      `- Source: ${metadata.source}`,
      `- Tier: ${metadata.tier}`,
      `- Archive: archive/${archiveName}`,
      `- Completed rows: ${tasks.length}`,
      `- Focus files: ${touchedFiles.length > 0 ? touchedFiles.join('; ') : 'none recorded'}`,
      `- Verification: ${verificationCommands.length > 0 ? verificationCommands.join(' ; ') : 'none recorded'}`
    ];
    if (decisions.length > 0) {
      lines.push(`- Decisions: ${decisions.map((entry) => `${entry.id} [${entry.type}] ${entry.scope}`).join('; ')}`);
    }
    fs.writeFileSync(contextPath, lines.join('\n') + '\n', 'utf8');
  } catch (e) {
    // Non-fatal. Phase context is best-effort.
  }
}

function writePhaseVerdict(enforcerDir, archivePath) {
  try {
    const projectRoot = path.dirname(enforcerDir);
    const contextPath = path.join(enforcerDir, 'phase-context.md');
    const context = parsePhaseContext(contextPath);
    const verdict = buildVerdict(archivePath, projectRoot, context);
    writeVerdict(enforcerDir, verdict);
    writeArchiveVerdict(archivePath, verdict);
  } catch (e) {
    // Non-fatal. Phase verdict is best-effort until the verifier path is
    // fully load-bearing.
  }
}

function emitOutput(lines, shouldBlock) {
  if (lines.length === 0) return;
  // Piggyback the current ledger hash on any real output. Silent when nothing
  // else needs saying, so it adds no per-call noise. Emitted hash lets the
  // model skip redundant re-reads when the ledger has not changed since last
  // seen. Guard: currentLedgerHash is set only on the main path (after ledger
  // read); defensive fallback emits without the prefix.
  const hashLine = config && config.tier === 'enforced' && typeof currentLedgerHash === 'string' && currentLedgerHash
    ? `Plan Enforcer [state]: ledger hash ${currentLedgerHash}. If this matches what you last read, skip the re-read before the next task.`
    : null;
  const finalLines = hashLine ? [hashLine, ...lines] : lines;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: finalLines.join('\n')
    }
  }));
  if (shouldBlock) {
    process.stderr.write(finalLines.join('\n') + '\n');
    process.exit(2);
  }
}

function emitActivationOutput(lines) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: lines.join('\n')
    }
  }));
}

function isLedgerMutation(ctx) {
  if (!ctx) return false;
  if (!['Edit', 'Write', 'MultiEdit'].includes(ctx.tool_name)) return false;
  const filePath = ctx.tool_input && ctx.tool_input.file_path;
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.endsWith('/.plan-enforcer/ledger.md') || normalized === '.plan-enforcer/ledger.md';
}

function isWorkspaceMutation(ctx) {
  if (!ctx) return false;
  if (ctx.tool_name === 'Bash') return true;
  if (!['Edit', 'Write', 'MultiEdit'].includes(ctx.tool_name)) return false;
  return !isLedgerMutation(ctx);
}

function tryAutoActivate() {
  if (!toolContext || toolContext.tool_name !== 'Read') return false;
  const filePath = toolContext.tool_input && toolContext.tool_input.file_path;
  if (!filePath || !filePath.endsWith('.md')) return false;

  const normalizedFilePath = filePath.replace(/\\/g, '/');
  if (normalizedFilePath.includes('/benchmarks/') || normalizedFilePath.includes('/benchmark') || normalizedFilePath.includes('/skills/')) {
    return false;
  }
  // Reading an archived ledger is inspection, not activation. P4
  // self-enforcement caught this: opening an archive file generated a stub
  // ledger pointing at the archive as source, which the operator then
  // had to overwrite. The archive path is unambiguous — if the read
  // is under .plan-enforcer/archive/, do not auto-seed.
  if (normalizedFilePath.includes('/.plan-enforcer/archive/')) {
    return false;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!isPlanContent(content)) return false;

    const detectedRoot = findProjectRoot(filePath);
    if (!detectedRoot) return false;

    const rootEnforcerDir = path.join(detectedRoot, '.plan-enforcer');
    const rootLedgerPath = path.join(rootEnforcerDir, 'ledger.md');
    const rootConfigPath = path.join(rootEnforcerDir, 'config.md');
    if (fs.existsSync(rootLedgerPath)) return false;

    const config = readConfig(rootConfigPath);
    const relativePlan = path.relative(detectedRoot, filePath).replace(/\\/g, '/');

    // Skip if this plan was already completed and archived
    const archiveDir = path.join(rootEnforcerDir, 'archive');
    if (fs.existsSync(archiveDir)) {
      try {
        const archives = fs.readdirSync(archiveDir);
        for (const archiveFile of archives) {
          const archiveContent = fs.readFileSync(path.join(archiveDir, archiveFile), 'utf8');
          if (archiveContent.includes(`plan: ${relativePlan}`) || archiveContent.includes(`source: ${relativePlan}`)) {
            return false; // Already completed — don't re-activate
          }
        }
      } catch (e) {}
    }

    const { tasks, format } = extractTasksFromContent(content);
    if (tasks.length === 0) return false;

    fs.mkdirSync(rootEnforcerDir, { recursive: true });
    const freshLedger = generateLedger(relativePlan, tasks, config.tier);
    fs.writeFileSync(rootLedgerPath, freshLedger);
    writeTaskStatuslineState(freshLedger, {
      cwd: detectedRoot,
      source: 'post-tool:auto-activate'
    });

    if (!fs.existsSync(rootConfigPath)) {
      fs.writeFileSync(rootConfigPath, `---\ntier: ${config.tier}\nreconcile_interval: 25\nstale_threshold: 10\ncompletion_gate: soft\nledger_path: .plan-enforcer/ledger.md\n---\n`);
    }

    if (detectedRoot !== cwd) {
      fs.mkdirSync(cwdEnforcerDir, { recursive: true });
      fs.writeFileSync(activeRootPath, detectedRoot);
    }

    emitActivationOutput([
      `PLAN ENFORCER ACTIVATED (Read-trigger). Detected plan in ${relativePlan}.`,
      '--- Plan Enforcer -----------------------------------',
      ` Source: ${relativePlan}`,
      ` Format: ${format} (${tasks.length} tasks detected)`,
      ` Ledger: ${path.relative(cwd, rootLedgerPath).replace(/\\/g, '/')}`,
      ` Tier:   ${config.tier}`,
      '-----------------------------------------------------',
      'Protocol:',
      '  1. Work in row-sized chunks.',
      '  2. When a row is actually complete, use ONE atomic Edit to the ledger updating status + evidence + scoreboard in a single diff.',
      'REQUIRED: Mark VERIFIED (not done) when you have evidence.',
      'REQUIRED: Any deviation from the plan goes in Decision Log.',
      'RECOMMENDED: In the final stretch, keep one clearly active row at a time. No separate claim edit is required before planned workspace work.',
      'Commands: /plan-enforcer:status  /plan-enforcer:logs  /plan-enforcer:config',
      '-----------------------------------------------------'
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

if (!fs.existsSync(ledgerPath)) {
  if (tryAutoActivate()) process.exit(0);
  process.exit(0);
}

const config = readConfig(configPath);
let ledger;
try {
  ledger = fs.readFileSync(ledgerPath, 'utf8');
} catch (e) {
  process.exit(0);
}

const output = [];
const { pendingCount, inProgressCount, doneCount, verifiedCount, skippedCount, blockedCount, remaining, totalTasks } = getLedgerStats(ledger);
const currentLedgerHash = ledgerHash(ledger);

let toolCount = readCounter(toolCountPath) + 1;
if (toolCount >= config.reconcile_interval) {
  writeCounter(toolCountPath, 0);
  const issues = [];
  if (inProgressCount > 0) issues.push(`${inProgressCount} task(s) stuck in-progress`);
  if (doneCount > 0) issues.push(`${doneCount} task(s) marked done without verification -- mark verified if evidence exists`);
  if (pendingCount > 0) issues.push(`${pendingCount} task(s) still pending`);
  if (issues.length > 0) {
    const nextTask = getNextTaskSummary(ledger);
    output.push(`Plan Enforcer [reconcile]: Check after ${config.reconcile_interval} tool calls:`);
    issues.forEach((issue) => output.push(`  - ${issue}`));
    if (nextTask) {
      output.push(`  - Next unfinished row: ${nextTask.id} [${nextTask.status}] ${nextTask.name}`);
    }
    output.push('  MANDATORY: Do a reconciliation sweep now. Re-read ledger, check all rows, add Reconciliation History entry.');
  }
} else {
  writeCounter(toolCountPath, toolCount);
  if (config.tier === 'enforced' && remaining > 0 && toolCount % 5 === 0) {
    const done = totalTasks - remaining;
    const inProgressIds = getInProgressTaskIds(ledger);
    const nextTask = getNextTaskSummary(ledger);
    if (inProgressIds.length > 0) {
      // Stuck in-progress tasks are the priority warning
      output.push(`Plan Enforcer [${done}/${totalTasks}]: ${inProgressIds.join(', ')} stuck in-progress. Finish or mark blocked.`);
    } else {
      output.push(`Plan Enforcer [${done}/${totalTasks}]: ${remaining} tasks remain. Update the ledger.`);
    }
    if (nextTask) {
      output.push(`Plan Enforcer [next]: ${nextTask.id} [${nextTask.status}] ${nextTask.name}`);
    }
  }
}

// Always alert if any task has been in-progress for 10+ calls since last status change
// (simple heuristic: if in-progress tasks exist and tool count is at or past reconcile, flag them)
if (inProgressCount > 0 && toolCount >= 10 && toolCount % 10 === 0) {
  const inProgressIds = getInProgressTaskIds(ledger);
  if (inProgressIds.length > 0) {
    output.push(`Plan Enforcer [stuck]: ${inProgressIds.join(', ')} have been in-progress for a while. Finish, block, or skip with Decision.`);
  }
}

// Skip pattern detection + mid-plan revision prompt
// If >25% of the plan is skipped/blocked OR 3+ stuck in-progress tasks, the plan may be broken.
// Fire once per reconciliation cycle (when toolCount resets) to avoid spam.
if (totalTasks > 0 && toolCount % 10 === 0) {
  const disposed = skippedCount + blockedCount;
  const disposedPct = (disposed / totalTasks) * 100;
  const planRisk = disposedPct >= 25 || inProgressCount >= 3;
  if (planRisk) {
    output.push('');
    output.push('Plan Enforcer [REVISION SUGGESTED] ------------------');
    if (disposedPct >= 25) {
      output.push(` ${disposed}/${totalTasks} tasks skipped or blocked (${Math.round(disposedPct)}%).`);
    }
    if (inProgressCount >= 3) {
      output.push(` ${inProgressCount} tasks stuck in-progress simultaneously.`);
    }
    output.push(' This plan may be broken. Consider:');
    output.push('   - Pausing to revise the plan');
    output.push('   - Running plan-enforcer-review on the source file');
    output.push('   - Asking the user if the plan should be revised');
    output.push('-----------------------------------------------------');
  }
}

if (remaining === 0 && totalTasks > 0) {
  output.push('');
  output.push('--- Plan Enforcer (COMPLETE) -------------------------');
  output.push(` ${totalTasks}/${totalTasks} tasks  |  ${verifiedCount} verified  |  ${doneCount} done (unverified)`);
  output.push(` Tier: ${config.tier}`);
  output.push('------------------------------------------------------');
  if (doneCount > 0) {
    output.push(` WARNING: ${doneCount} task(s) marked done but NOT verified.`);
    output.push(' If you have evidence (tests, curl, output), mark them verified.');
  }

  const decisionLines = ledger.match(/^\|\s*D\d+\s*\|.+$/gm);
  if (decisionLines && decisionLines.length > 0) {
    output.push('');
    output.push(' DECISION LOG:');
    decisionLines.forEach((line) => {
      const cols = line.split('|').map((col) => col.trim()).filter(Boolean);
      output.push(`   ${cols[0]}  ${cols.slice(1).join(' -- ')}`);
    });
  }

  const skippedLines = ledger.match(/^\|\s*T\d+\s*\|[^|]*\|\s*(skipped|superseded)\s*\|.+$/gm);
  if (skippedLines && skippedLines.length > 0) {
    output.push('');
    output.push(' SKIPPED/SUPERSEDED:');
    skippedLines.forEach((line) => {
      const cols = line.split('|').map((col) => col.trim()).filter(Boolean);
      output.push(`   ${cols[0]}  ${cols[1]} -- ${cols[2]}`);
    });
  }

  const reconLines = ledger.match(/^\|\s*R\d+\s*\|.+$/gm);
  if (reconLines && reconLines.length > 0) {
    output.push('');
    output.push(' RECONCILIATION HISTORY:');
    reconLines.forEach((line) => {
      const cols = line.split('|').map((col) => col.trim()).filter(Boolean);
      output.push(`   ${cols[0]}  ${cols.slice(1).join(' -- ')}`);
    });
  }

  const unverifiedLines = ledger.match(/^\|\s*T\d+\s*\|[^|]*\|\s*done\s*\|.+$/gm);
  if (unverifiedLines && unverifiedLines.length > 0) {
    output.push('');
    output.push(' UNVERIFIED (done without evidence):');
    unverifiedLines.forEach((line) => {
      const cols = line.split('|').map((col) => col.trim()).filter(Boolean);
      output.push(`   ${cols[0]}  ${cols[1]} -- needs verification`);
    });
  }

  output.push('------------------------------------------------------');
  try {
    const result = archiveLedger(enforcerDir, ledger, {
      counts: {
        pending: pendingCount,
        'in-progress': inProgressCount,
        done: doneCount,
        verified: verifiedCount,
        skipped: 0,
        blocked: 0,
        superseded: 0
      },
      total: totalTasks
    }, config.tier);
    writePhaseContext(enforcerDir, ledger, result.archiveName);
    writePhaseVerdict(enforcerDir, result.archivePath);
    writeArchiveTruthManifest(result.archivePath);
    cleanupWorkingFiles(enforcerDir);
    clearStatuslineState({ cwd: projectRoot });
    try { fs.unlinkSync(activeRootPath); } catch (e) {}
    output.push(` Archived: .plan-enforcer/archive/${result.archiveName}`);
    output.push('------------------------------------------------------');
  } catch (e) {
    output.push(` Archive failed: ${e.message}`);
  }
}

if (remaining > 0) {
  writeTaskStatuslineState(ledger, {
    cwd: projectRoot,
    source: 'post-tool'
  });
  try {
    const currentMtime = fs.statSync(ledgerPath).mtimeMs;
    let prevMtime = 0;
    try {
      prevMtime = parseFloat(fs.readFileSync(ledgerMtimePath, 'utf8').trim());
    } catch (e) {}

    if (currentMtime !== prevMtime) {
      writeCounter(staleCountPath, 0);
      fs.writeFileSync(ledgerMtimePath, String(currentMtime));
    } else {
      const staleCount = readCounter(staleCountPath) + 1;
      if (staleCount >= config.stale_threshold) {
        output.push(`Plan Enforcer [stale]: Ledger unchanged for ${staleCount} tool calls while ${remaining} task(s) remain. Re-read the ledger and reconcile now.`);
        if (config.tier === 'enforced' && isWorkspaceMutation(toolContext)) {
          output.push('Plan Enforcer [block]: workspace changed without a ledger update. Update the ledger before continuing.');
          writeCounter(staleCountPath, 0);
          emitOutput(output, true);
        }
        writeCounter(staleCountPath, 0);
      } else {
        writeCounter(staleCountPath, staleCount);
      }
    }
  } catch (e) {}
}

if (isLedgerMutation(toolContext)) {
  const partial = detectPartialLedgerEdit(toolContext);
  if (partial.partial) {
    output.push(`Plan Enforcer [consolidate]: ${partial.reason}. Next time, carry status + evidence + scoreboard in one Edit (see SessionStart protocol). Saves turns and keeps the audit trail atomic.`);
    try {
      const nudgeLogPath = path.join(enforcerDir, '.nudge-log');
      fs.appendFileSync(nudgeLogPath, JSON.stringify({
        ts: new Date().toISOString(),
        kind: 'consolidate',
        reason: partial.reason,
        tool: toolContext.tool_name
      }) + '\n');
    } catch (e) {}
  }
}

if (remaining > 0 && toolContext) {
  const driftTools = ['Write', 'Edit'];
  if (driftTools.includes(toolContext.tool_name)) {
    const filePath = toolContext.tool_input &&
      (toolContext.tool_input.file_path || toolContext.tool_input.path || '');
    if (filePath) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (!normalizedPath.includes('.plan-enforcer/')) {
        const basename = path.basename(normalizedPath);
        const inLedger = ledger.includes(basename) || ledger.includes(normalizedPath);
        if (!inLedger) {
          output.push(`Plan Enforcer [drift]: '${basename}' modified but not referenced in any task.`);
          output.push('  Intentional? Log a decision in the ledger.');
        }
      }
    }
  }
}

if (config.tier === 'enforced' && remaining > 0 && totalTasks > 0 && remaining <= 5 && (isWorkspaceMutation(toolContext) || isLedgerMutation(toolContext))) {
  const nextTask = getNextTaskSummary(ledger);
  if (nextTask) {
    output.push(`Plan Enforcer [closeout-next]: ${nextTask.id} [${nextTask.status}] ${nextTask.name}`);
  }
  if (isLedgerMutation(toolContext) && nextTask && nextTask.status === 'pending') {
    output.push(`Plan Enforcer [closeout-focus]: final stretch active. ${nextTask.id} is next; keep work aligned and fold the row update into the next real ledger edit.`);
  }
  if (config.tier === 'enforced' && isWorkspaceMutation(toolContext) && inProgressCount >= 2) {
    output.push(`Plan Enforcer [block]: ${inProgressCount} rows are simultaneously in-progress in the final stretch. Collapse back to one active row, reconcile finished work, and update the ledger before continuing.`);
    emitOutput(output, true);
  }
}

emitOutput(output);

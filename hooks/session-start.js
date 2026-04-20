#!/usr/bin/env node
// Plan Enforcer - SessionStart Hook

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseLedger, parseMetadata, parseTaskRows } = require('../src/ledger-parser');
const { extractTasks, findPlanFile, generateLedger } = require('../src/plan-detector');
const { readConfig } = require('../src/config');
const { clearStatuslineState, hasDiscussPacket, writeNamedStatuslineStage, writeTaskStatuslineState } = require('../src/statusline-state');

function ledgerHash(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 8);
}

const cwd = process.cwd();
const enforcerDir = path.join(cwd, '.plan-enforcer');
const ledgerPath = path.join(enforcerDir, 'ledger.md');
const configPath = path.join(enforcerDir, 'config.md');
const activeRootPath = path.join(enforcerDir, '.active-root');

function readTier(filePath, fallback) {
  try {
    const config = fs.readFileSync(filePath, 'utf8');
    const match = config.match(/^tier:\s*(\w+)/m);
    return match ? match[1] : fallback;
  } catch (e) {
    return fallback;
  }
}

// Walk upward from cwd looking for an existing .plan-enforcer/ledger.md OR archive/.
// This lets the enforcer survive when the agent cds into a subdirectory (e.g.,
// plan Task 1 says "create a fresh directory called url-shortener-cli").
// Only return a hit if it's at an actual project root (has .git or package.json).
// Prevents matching a stale ~/.plan-enforcer/ or any enforcer dir not at a project.
// Shallow find-up: only walks up a few levels. Subdir case only needs 1-2.
// Must stop at first project root. Prevents matching ~/.plan-enforcer/.
function findUpEnforcerDir(startDir) {
  let dir = startDir;
  const rootPath = path.parse(dir).root;
  for (let depth = 0; depth < 3 && dir && dir !== rootPath; depth++) {
    const candidate = path.join(dir, '.plan-enforcer');
    const hasLedger = fs.existsSync(path.join(candidate, 'ledger.md')) || fs.existsSync(path.join(candidate, 'archive'));
    const isProjectRoot = fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
    if (hasLedger && isProjectRoot) {
      return candidate;
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

// Also search downward (shallow, 3 levels) for a ledger created in a subdirectory.
// Needed when agent has already run and dropped its ledger in a nested project dir.
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
            return full;
          }
        }
        stack.push({ dir: full, depth: depth + 1 });
      }
    } catch (e) {}
  }
  return null;
}

function resolvePaths() {
  let resolvedEnforcerDir = enforcerDir;
  let resolvedLedgerPath = ledgerPath;
  let resolvedConfigPath = configPath;

  // Priority 1: honor .active-root redirect if set by post-tool hook
  try {
    const storedRoot = fs.readFileSync(activeRootPath, 'utf8').trim();
    const storedEnforcerDir = path.join(storedRoot, '.plan-enforcer');
    if (storedRoot && fs.existsSync(storedEnforcerDir)) {
      return {
        resolvedEnforcerDir: storedEnforcerDir,
        resolvedLedgerPath: path.join(storedEnforcerDir, 'ledger.md'),
        resolvedConfigPath: path.join(storedEnforcerDir, 'config.md')
      };
    }
  } catch (e) {}

  // Priority 2: cwd already has an enforcer dir with a ledger or archive
  if (fs.existsSync(ledgerPath) || fs.existsSync(path.join(enforcerDir, 'archive'))) {
    return { resolvedEnforcerDir, resolvedLedgerPath, resolvedConfigPath };
  }

  // Priority 3: walk up — handles agent cd'ing into a subdirectory
  const foundUp = findUpEnforcerDir(cwd);
  if (foundUp) {
    return {
      resolvedEnforcerDir: foundUp,
      resolvedLedgerPath: path.join(foundUp, 'ledger.md'),
      resolvedConfigPath: path.join(foundUp, 'config.md')
    };
  }

  // Priority 4: walk down — handles plans that create nested project dirs
  const foundDown = findDownEnforcerDir(cwd, 3);
  if (foundDown) {
    return {
      resolvedEnforcerDir: foundDown,
      resolvedLedgerPath: path.join(foundDown, 'ledger.md'),
      resolvedConfigPath: path.join(foundDown, 'config.md')
    };
  }

  return { resolvedEnforcerDir, resolvedLedgerPath, resolvedConfigPath };
}

function buildProtocolGuidance(tier, completionGate) {
  const lines = [];
  if (tier === 'enforced') {
    lines.push('Protocol: work in row-sized chunks. When a row is actually complete, use ONE atomic Edit to the ledger updating status + evidence + scoreboard in a single diff.');
    lines.push('REQUIRED: Mark VERIFIED (not done) when you have evidence. ALL deviations go in Decision Log.');
    lines.push('REQUIRED: Reconcile at meaningful checkpoints and whenever the hook asks. Completion still means 0 remaining rows and archive-ready ledger state.');
    lines.push('RECOMMENDED: In final stretch, keep one clearly active row at a time. Use closeout-next as focus guidance; no separate claim edit is required before planned workspace work.');
    lines.push('RECOMMENDED: Keep completion summaries terse. Report shipped work, verification result, and deviation refs only.');
    return lines;
  }

  lines.push('Protocol: execute in meaningful chunks. Update the ledger at checkpoints or phase boundaries.');
  if (tier === 'structural') {
    lines.push('RECOMMENDED: Mark VERIFIED when evidence exists and log deviations when scope changes.');
    lines.push('RECOMMENDED: Use focused reads/searches once you know the target files. Avoid chained shell probe commands.');
    lines.push('RECOMMENDED: Keep phase/session completion summaries terse: shipped work, verification result, deviation refs.');
  }
  if (completionGate === 'hard') {
    lines.push('GATE: session close still expects 0 remaining rows because completion_gate=hard.');
  } else if (completionGate === 'audit') {
    lines.push('GATE: session may close with open rows, but unfinished work will be logged for audit.');
  } else {
    lines.push('GATE: soft close allowed, but leave the ledger/resume state honest before ending the session.');
  }
  if (tier === 'structural') {
    lines.push('RECOMMENDED: In the final stretch, keep one clearly active work item at a time.');
  }
  return lines;
}

function parsePhaseContext(resolvedEnforcerDir) {
  const contextPath = path.join(resolvedEnforcerDir, 'phase-context.md');
  if (!fs.existsSync(contextPath)) return null;
  try {
    const raw = fs.readFileSync(contextPath, 'utf8');
    const focus = (raw.match(/^- Focus files:\s*(.+)$/m) || [])[1] || '';
    const verification = (raw.match(/^- Verification:\s*(.+)$/m) || [])[1] || '';
    const archive = (raw.match(/^- Archive:\s*(.+)$/m) || [])[1] || '';
    return { focus, verification, archive };
  } catch (e) {
    return null;
  }
}

function buildActiveOutput(ledger, tier, resolvedLedgerPath, completionGate) {
  const { counts, total, doneCount, remaining, drift, source } = parseLedger(ledger);
  const currentHash = ledgerHash(ledger);
  const phaseContext = parsePhaseContext(path.dirname(resolvedLedgerPath));

  let out = '';
  if (remaining === 0 && total > 0) {
    out += `PLAN ENFORCER: Plan complete. ${total} tasks finished.\n`;
    out += '--- Plan Enforcer (COMPLETE) -------------------------\n';
    out += ` ${doneCount}/${total} tasks  |  ${counts.verified} verified  |  ${counts.skipped} skipped  |  ${counts.blocked} blocked\n`;
    out += ` Tier: ${tier}  |  Drift: ${drift}  |  Source: ${source}\n`;
    out += '-----------------------------------------------------\n';
    if (counts.done > 0) {
      out += ` ${counts.done} task(s) done but NOT verified -- need evidence.\n`;
    }
    out += 'Run /plan-enforcer:logs for the full audit trail.\n';
    return out;
  }

  const relLedger = path.relative(cwd, resolvedLedgerPath).replace(/\\/g, '/');
  out += `PLAN ENFORCER ACTIVE. Tier: ${tier}. Ledger: ${relLedger}\n`;
  out += '--- Plan Enforcer -----------------------------------\n';
  out += ` ${doneCount}/${total} tasks  |  ${counts.verified} verified  |  ${counts.skipped} skipped  |  ${counts.blocked} blocked\n`;
  out += ` Tier: ${tier}  |  Drift: ${drift}  |  Remaining: ${remaining}\n`;
  out += '-----------------------------------------------------\n';
  if (tier === 'enforced') {
    out += `Ledger hash: ${currentHash}. If the post-tool hook reports the same hash next turn, skip the re-read and go straight to work.\n`;
  }
  if (phaseContext) {
    out += 'Recent phase context: .plan-enforcer/phase-context.md\n';
    if (phaseContext.focus && phaseContext.focus !== 'none recorded') {
      out += `  Focus files: ${phaseContext.focus}\n`;
    }
    if (phaseContext.verification && phaseContext.verification !== 'none recorded') {
      out += `  Verification: ${phaseContext.verification}\n`;
    }
    if (phaseContext.archive) {
      out += `  Prior archive: .plan-enforcer/${phaseContext.archive}\n`;
    }
  }
  for (const line of buildProtocolGuidance(tier, completionGate)) {
    out += `${line}\n`;
  }
  if (tier === 'enforced') {
    out += 'Commands: /plan-enforcer:status  /plan-enforcer:logs  /plan-enforcer:config\n';
  }
  return out;
}

function buildActivationOutput(planFile, format, tasks, tier, ledgerContent, completionGate) {
  let out = '';
  out += 'PLAN ENFORCER ACTIVATED. Auto-detected plan file.\n';
  out += '--- Plan Enforcer -----------------------------------\n';
  out += ` Source: ${planFile}\n`;
  out += ` Format: ${format} (${tasks.length} tasks detected)\n`;
  out += ' Ledger: .plan-enforcer/ledger.md\n';
  out += ` Tier:   ${tier}\n`;
  out += '-----------------------------------------------------\n';
  if (ledgerContent && tier === 'enforced') {
    out += `Ledger hash: ${ledgerHash(ledgerContent)}. If the post-tool hook reports the same hash next turn, skip the re-read and go straight to work.\n`;
  }
  for (const line of buildProtocolGuidance(tier, completionGate)) {
    out += `${line}\n`;
  }
  if (tier === 'enforced') {
    out += 'Commands: /plan-enforcer:status  /plan-enforcer:logs  /plan-enforcer:config\n';
  }
  out += '-----------------------------------------------------\n';
  return out;
}

function parseResumeSnapshot(resumeText) {
  const nextMatch = resumeText.match(/^- Next row:\s*(T\d+)\s*\[([^\]]+)\]\s*(.+)$/m);
  const openMatch = resumeText.match(/^- Open rows:\s*(.+)$/m);
  const openRows = openMatch
    ? openMatch[1].split(/\s*;\s*/).map((row) => row.trim()).filter(Boolean)
    : [];
  return {
    nextId: nextMatch ? nextMatch[1] : null,
    nextStatus: nextMatch ? nextMatch[2] : null,
    nextName: nextMatch ? nextMatch[3] : null,
    openRows
  };
}

function normalizePlanRef(ref) {
  return String(ref || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function archiveMatchesPlan(archiveContent, planFile) {
  const expected = normalizePlanRef(planFile);
  if (!expected) return false;
  const candidates = [];
  const planMatch = archiveContent.match(/^plan:\s*(.+)$/m);
  const sourceMatch = archiveContent.match(/^<!-- source:\s*(.+?)\s*-->$/m);
  if (planMatch) candidates.push(planMatch[1]);
  if (sourceMatch) candidates.push(sourceMatch[1]);
  return candidates.some((candidate) => normalizePlanRef(candidate) === expected);
}

function buildResumeOrderPacket(resolvedEnforcerDir, tier, isBenchmarkLinear) {
  const resumePath = path.join(resolvedEnforcerDir, 'resume.md');
  if (!fs.existsSync(resumePath)) return '';
  let raw;
  try {
    raw = fs.readFileSync(resumePath, 'utf8');
  } catch (e) {
    return '';
  }
  const parsed = parseResumeSnapshot(raw);
  if (!parsed.nextId || parsed.openRows.length === 0) return '';

  let out = '';
  if (tier === 'enforced' && isBenchmarkLinear) {
    out += 'ORDER TO EXECUTE (from .plan-enforcer/resume.md):\n';
    parsed.openRows.slice(0, 5).forEach((row, index) => {
      const thenPrefix = index === 0 ? 'Finish' : 'Then';
      out += `  ${index + 1}. ${thenPrefix} ${row}\n`;
    });
    out += `  Start with ${parsed.nextId}. Keep one active row at a time; no separate claim edit is required before planned workspace work.\n`;
    return out;
  }

  out += 'SUGGESTED RESUME ORDER (from .plan-enforcer/resume.md):\n';
  parsed.openRows.slice(0, 5).forEach((row, index) => {
    out += `  ${index + 1}. ${row}\n`;
  });
  out += `  If you deviate, log a D-row before changing scope or order.\n`;
  return out;
}

const { resolvedEnforcerDir, resolvedLedgerPath, resolvedConfigPath } = resolvePaths();
const defaultTier = readTier(configPath, 'structural');
const tier = fs.existsSync(resolvedLedgerPath)
  ? readTier(resolvedConfigPath, defaultTier)
  : defaultTier;

// Truncate the session log on every SessionStart. Fresh session = fresh
// record of tool calls. The log feeds P2's evidence matcher (the "fresh
// evidence in this message" gate), so prior-session entries would
// pollute new-session evidence checks.
if (fs.existsSync(resolvedEnforcerDir)) {
  try {
    fs.writeFileSync(path.join(resolvedEnforcerDir, '.session-log.jsonl'), '');
  } catch (e) { /* non-fatal */ }
}

// Hook staleness check. The running hook file lives at __dirname; compare
// its SHA to the repo copy if discoverable. On mismatch, warn — caught us
// during P0 self-enforce where installed hooks predated weeks of repo work.
// Silent when repo copy isn't discoverable (user may not be the developer).
try {
  const installedFrom = path.join(__dirname, '..', '.installed-from');
  if (fs.existsSync(installedFrom)) {
    const installedSha = fs.readFileSync(installedFrom, 'utf8').trim();
    // Look for a repo copy: walk up from cwd for a .git + hooks/<this-file-name>
    let probe = cwd;
    const rootPath = path.parse(probe).root;
    let repoHooks = null;
    while (probe && probe !== rootPath) {
      if (fs.existsSync(path.join(probe, '.git')) && fs.existsSync(path.join(probe, 'hooks', 'session-start.js'))) {
        repoHooks = path.join(probe, 'hooks');
        break;
      }
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (repoHooks) {
      const { execSync } = require('child_process');
      const repoRoot = path.dirname(repoHooks);
      const currentSha = execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim();
      if (currentSha && currentSha !== installedSha) {
        process.stdout.write(`Plan Enforcer: installed hooks are from repo commit ${installedSha}; current repo HEAD is ${currentSha}. Re-run install.sh to sync.\n`);
      }
    }
  }
} catch (e) { /* non-fatal */ }

// Stale ledger detector. On SessionStart, compare the ledger mtime to
// the newest src file in the work tree. If the ledger is significantly
// older than live code AND there are still non-verified rows, the
// previous agent likely did work and never updated the ledger — the
// exact failure mode that cost us small/crash and large/crash native
// cells in the 2026-04-12 benchmark. Warn so the current session can
// reconcile before continuing.
try {
  if (fs.existsSync(resolvedLedgerPath)) {
    const config = readConfig(resolvedConfigPath);
    const ledgerMtimeMs = fs.statSync(resolvedLedgerPath).mtimeMs;
    const projectRoot = path.dirname(resolvedEnforcerDir);
    const ledgerContent = fs.readFileSync(resolvedLedgerPath, 'utf8');
    const stats = parseLedger(ledgerContent);
    const meta = parseMetadata(ledgerContent);
    const isBenchmarkLinear = tier === 'enforced' && /shared-execution-plan\.md/i.test(ledgerContent);

    if (stats.remaining > 0 && stats.doneCount > 0 && meta.schema === 'v2') {
      const openRows = parseTaskRows(ledgerContent)
        .filter((row) => row.status === 'pending' || row.status === 'in-progress');
      const nextTask = openRows[0];
      process.stdout.write(`\nPlan Enforcer: RESUME CHECK\n`);
      process.stdout.write(`  Found partial ledger with ${stats.doneCount}/${stats.total} task(s) completed and ${stats.remaining} still open.\n`);
      if (nextTask) {
        process.stdout.write(`  Resume at ${nextTask.id}: ${nextTask.name}.\n`);
      }
      if (openRows.length > 0) {
        process.stdout.write(`  Open rows: ${openRows.slice(0, 6).map((row) => `${row.id} [${row.status}] ${row.name}`).join('; ')}.\n`);
      }
      if (fs.existsSync(path.join(resolvedEnforcerDir, 'resume.md'))) {
        process.stdout.write(`  Resume snapshot: .plan-enforcer/resume.md\n`);
      }
      process.stdout.write(`  Before continuing: read the ledger, reconcile any finished rows with evidence, then resume at the next unfinished task.\n\n`);
      process.stdout.write(buildResumeOrderPacket(resolvedEnforcerDir, tier, isBenchmarkLinear));
      if (isBenchmarkLinear) {
        process.stdout.write('\n');
      }
    }

    // Find the newest source file under common dirs — bounded scan.
    const candidateDirs = ['src', 'hooks', 'lib', 'tests', 'test', '__tests__', 'app', 'pages'];
    let newestMs = 0;
    let newestRel = null;
    for (const d of candidateDirs) {
      const abs = path.join(projectRoot, d);
      if (!fs.existsSync(abs)) continue;
      const stack = [abs];
      let scanned = 0;
      while (stack.length > 0 && scanned < 500) {
        const dir = stack.shift();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { stack.push(full); continue; }
          if (!/\.(js|ts|jsx|tsx|mjs|cjs|py|go|rb|java|rs)$/i.test(e.name)) continue;
          try {
            const mtime = fs.statSync(full).mtimeMs;
            if (mtime > newestMs) {
              newestMs = mtime;
              newestRel = path.relative(projectRoot, full).replace(/\\/g, '/');
              scanned++;
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    // Fire if newest src file is newer than the configured threshold AND
    // the ledger has non-verified rows. Native benchmark cells can seed
    // stale_threshold=0 so crash/resume sessions get an immediate
    // warning instead of waiting 10 minutes.
    const staleThresholdMinutes = Number.isFinite(config.stale_threshold) ? config.stale_threshold : 10;
    const staleThresholdMs = Math.max(0, staleThresholdMinutes) * 60 * 1000;
    if (newestMs > 0 && newestMs - ledgerMtimeMs > staleThresholdMs) {
      if (stats.remaining > 0 && meta.schema === 'v2') {
        const ledgerAgeMin = Math.round((newestMs - ledgerMtimeMs) / 60000);
        process.stdout.write(`\nPlan Enforcer: STALE LEDGER WARNING\n`);
        process.stdout.write(`  Ledger last updated ${ledgerAgeMin} min before newest source file (${newestRel}).\n`);
        process.stdout.write(`  ${stats.remaining} row(s) still non-verified. Prior work may be unrecorded.\n`);
        process.stdout.write(`  Reconcile: read the ledger, flip completed rows to verified with evidence,\n`);
        process.stdout.write(`  or add Decision Log entries for work that went off-plan.\n\n`);
      }
    }
  }
} catch (e) { /* non-fatal */ }

if (fs.existsSync(resolvedLedgerPath)) {
  const activeLedger = fs.readFileSync(resolvedLedgerPath, 'utf8');
  const config = readConfig(resolvedConfigPath);
  writeTaskStatuslineState(activeLedger, {
    cwd: path.dirname(resolvedEnforcerDir),
    source: 'session-start'
  });
  process.stdout.write(buildActiveOutput(
    activeLedger,
    tier,
    resolvedLedgerPath,
    config.completion_gate || 'soft'
  ));
  process.exit(0);
}

const planFile = findPlanFile(cwd);
if (!planFile) {
  if (hasDiscussPacket({ cwd: path.dirname(resolvedEnforcerDir) })) {
    writeNamedStatuslineStage('discuss', {
      cwd: path.dirname(resolvedEnforcerDir),
      label: '1-DISCUSS',
      source: 'session-start'
    });
  } else {
    clearStatuslineState({ cwd });
  }
  process.exit(0);
}

// Skip if this plan was already completed and archived
const archiveDir = path.join(resolvedEnforcerDir, 'archive');
if (fs.existsSync(archiveDir)) {
  try {
    const archives = fs.readdirSync(archiveDir).filter((name) => name.endsWith('.md') && !name.endsWith('.verdict.md'));
    for (const af of archives) {
      const ac = fs.readFileSync(path.join(archiveDir, af), 'utf8');
      if (archiveMatchesPlan(ac, planFile)) {
        clearStatuslineState({ cwd });
        process.exit(0); // Already completed — don't re-activate
      }
    }
  } catch (e) {}
}

const planPath = path.join(cwd, planFile);
const { tasks, format } = extractTasks(planPath);
if (tasks.length === 0) {
  process.stdout.write(`Plan Enforcer: Found ${planFile} but could not extract tasks. Run /plan-enforcer ${planFile} to activate manually.\n`);
  process.exit(0);
}

fs.mkdirSync(resolvedEnforcerDir, { recursive: true });
const freshLedger = generateLedger(planFile, tasks, tier);
fs.writeFileSync(path.join(resolvedEnforcerDir, 'ledger.md'), freshLedger);
writeTaskStatuslineState(freshLedger, {
  cwd: path.dirname(resolvedEnforcerDir),
  source: 'session-start'
});

if (!fs.existsSync(resolvedConfigPath)) {
  fs.writeFileSync(resolvedConfigPath, `---\ntier: ${tier}\nreconcile_interval: 25\nstale_threshold: 10\ncompletion_gate: soft\nledger_path: .plan-enforcer/ledger.md\n---\n`);
}

const activationConfig = readConfig(resolvedConfigPath);
process.stdout.write(buildActivationOutput(
  planFile,
  format,
  tasks,
  tier,
  freshLedger,
  activationConfig.completion_gate || 'soft'
));

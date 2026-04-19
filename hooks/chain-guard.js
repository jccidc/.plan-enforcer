#!/usr/bin/env node
// Plan Enforcer — PreToolUse Chain Guard
//
// Blocks Edit/Write/MultiEdit/NotebookEdit against files that are neither
// in the current phase's planned set nor referenced by a Decision Log row.
// Tier-aware: advisory audits, structural warns, enforced blocks.
//
// Silent pass-through when:
//   - no enforcer dir is discoverable (user not using Plan Enforcer here)
//   - target is inside .plan-enforcer/ (enforcer's own control files)
//   - no planned files can be extracted from the source plan (falls back
//     to audit-only per P1 design option #3)

const fs = require('fs');
const path = require('path');
const { parseDecisionLog, parseMetadata } = require('../src/ledger-parser');
const { decide, readTier, shouldBlock } = require('../src/tier');
const { extractFromFile, isCovered, normalizePath } = require('../src/planned-files');

const GUARDED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function readContext() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Mirror of find-up/find-down from post-tool.js — no enforcer dir means
// chain-guard is a no-op.
function findUpEnforcerDir(startDir) {
  let dir = startDir;
  const rootPath = path.parse(dir).root;
  for (let depth = 0; depth < 3 && dir && dir !== rootPath; depth++) {
    const candidate = path.join(dir, '.plan-enforcer');
    const hasLedger = fs.existsSync(path.join(candidate, 'ledger.md')) || fs.existsSync(path.join(candidate, 'archive'));
    const isProjectRoot = fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
    if (hasLedger && isProjectRoot) return dir;
    if (isProjectRoot || fs.existsSync(path.join(dir, '.plan-enforcer-stop'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

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

function resolveProjectRoot(cwd) {
  const cwdEnforcer = path.join(cwd, '.plan-enforcer');
  if (fs.existsSync(path.join(cwdEnforcer, 'ledger.md')) || fs.existsSync(path.join(cwdEnforcer, 'archive'))) {
    return cwd;
  }
  const up = findUpEnforcerDir(cwd);
  if (up) return up;
  const down = findDownEnforcerDir(cwd, 3);
  if (down) return down;
  return null;
}

// Extract the target file path from a tool_input payload across guarded
// tool types. Returns null if none applies.
function extractTarget(toolName, toolInput) {
  if (!toolInput) return null;
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') {
    return toolInput.file_path || null;
  }
  if (toolName === 'NotebookEdit') {
    return toolInput.notebook_path || null;
  }
  return null;
}

// Emit hook output + exit. action=block => exit 2 so Claude Code refuses
// the tool call.
function emit(action, message) {
  if (!message) {
    process.exit(0);
  }
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: message
      }
    }));
  } catch (e) {}
  if (shouldBlock(action)) {
    process.stderr.write(message + '\n');
    process.exit(2);
  }
  process.exit(0);
}

function main() {
  const ctx = readContext();
  if (!ctx || !GUARDED_TOOLS.has(ctx.tool_name)) return emit('allow', '');

  const target = extractTarget(ctx.tool_name, ctx.tool_input);
  if (!target) return emit('allow', '');

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  if (!projectRoot) return emit('allow', '');

  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const ledgerPath = path.join(enforcerDir, 'ledger.md');
  if (!fs.existsSync(ledgerPath)) return emit('allow', '');

  // Never guard the enforcer's own control files.
  const relTarget = normalizePath(path.isAbsolute(target) ? path.relative(projectRoot, target) : target);
  if (relTarget.startsWith('.plan-enforcer/')) return emit('allow', '');

  const tier = readTier(enforcerDir);
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const meta = parseMetadata(ledger);

  // Resolve source plan path relative to project root.
  let planPath = null;
  if (meta.source && meta.source !== 'unknown') {
    const absPlan = path.isAbsolute(meta.source) ? meta.source : path.join(projectRoot, meta.source);
    if (fs.existsSync(absPlan)) planPath = absPlan;
  }

  const { files: plannedFiles, empty } = planPath
    ? extractFromFile(planPath)
    : { files: new Set(), empty: true };

  // Option #3 fallback: no planned files could be extracted -> audit-only
  // regardless of tier, so we never block on a plan we can't read.
  if (empty) {
    return emit('audit', `Plan Enforcer [audit]: chain-guard disabled for ${relTarget} — no planned files extractable from plan "${meta.source}". Touch considered unplanned but not enforceable.`);
  }

  const decisionRows = parseDecisionLog(ledger);
  if (isCovered(relTarget, plannedFiles, decisionRows)) {
    return emit('allow', '');
  }

  // Unplanned and not D-row covered — apply the tier matrix.
  const { action, message } = decide(tier, 'unplanned_edit', {
    detail: `Target: ${relTarget}. Add a Decision Log row (type=unplanned, scope=${relTarget}) to proceed.`
  });
  emit(action, message);
}

try {
  main();
} catch (e) {
  // Never crash the user's tool call on an enforcer bug — audit and move
  // on. The error message lands in stderr so a user can report it.
  process.stderr.write(`plan-enforcer chain-guard crashed: ${e.message}\n`);
  process.exit(0);
}

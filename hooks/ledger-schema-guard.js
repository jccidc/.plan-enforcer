#!/usr/bin/env node
// Plan Enforcer — PreToolUse Ledger Schema Guard
//
// Blocks Edit/MultiEdit/Write against the active ledger when the edit
// removes T-rows without a covering `delete`/`unplanned` Decision Log
// entry landing in the same edit.
//
// Motivation: docs/strategy/gaps/ledger-task-count-tampering.md. The
// medium/execute-frozen-plan/native rerun (2026-04-15) silently
// compacted a 15-row ledger to 5 rows during recovery. The archive
// looked clean. Chain of custody is the product's headline claim; an
// audit has to be able to reconstruct "what tasks existed" from the
// archive alone. This hook enforces that invariant at edit time.
//
// Tier-aware via src/tier.js. Unknown violations never hard-crash the
// agent — we bail to exit 0 on any internal error and write to stderr.

const fs = require('fs');
const path = require('path');
const { decide, readTier, shouldBlock } = require('../src/tier');
const { detectAcrossEdits } = require('../src/ledger-row-removal');
const { detectBulkPendingClosureFromEdits } = require('../src/partial-ledger-edit');

const GUARDED_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'Bash']);

function readContext() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Mirror of chain-guard's up-traversal. A hook running in a subdir
// should still find the .plan-enforcer/ root.
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

function resolveProjectRoot(cwd) {
  const cwdEnforcer = path.join(cwd, '.plan-enforcer');
  if (fs.existsSync(path.join(cwdEnforcer, 'ledger.md')) || fs.existsSync(path.join(cwdEnforcer, 'archive'))) {
    return cwd;
  }
  return findUpEnforcerDir(cwd);
}

// Is this tool input targeting the active ledger file? Accept both
// absolute and relative paths; accept forward/backslash separators.
function targetsLedger(toolName, toolInput, ledgerPath) {
  if (toolName === 'Bash') {
    const command = toolInput && toolInput.command;
    return typeof command === 'string' && commandTargetsLedger(command, ledgerPath);
  }
  if (!toolInput) return false;
  const raw = toolInput.file_path;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  const norm = (s) => s.replace(/\\/g, '/');
  const a = norm(path.resolve(raw));
  const b = norm(path.resolve(ledgerPath));
  return a === b;
}

function commandTargetsLedger(command, ledgerPath) {
  const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
  const hay = norm(command);
  const abs = norm(path.resolve(ledgerPath));
  return hay.includes('.plan-enforcer/ledger.md') || hay.includes(abs);
}

function bashLooksLikeLedgerMutation(command) {
  if (typeof command !== 'string') return false;
  const cmd = command.toLowerCase();
  const mutators = [
    /\bsed\s+-i\b/,
    /\bperl\s+-i\b/,
    /\bpython(?:3)?\s+-c\b/,
    /\bnode\s+-e\b/,
    /\btee\b/,
    /\btruncate\b/,
    /\bmv\b/,
    /\bcp\b/,
    /\bset-content\b/,
    /\badd-content\b/,
    /\bout-file\b/,
    /\bremove-item\b/
  ];
  if (mutators.some((re) => re.test(cmd))) return true;
  if (/[>]{1,2}/.test(cmd)) return true;
  return false;
}

// Normalize tool input into the list-of-edits shape detectAcrossEdits
// expects. For Write, synthesize an edit from {currentFileText, newContent}.
function toEdits(toolName, toolInput, ledgerPath) {
  if (toolName === 'Bash') {
    const command = toolInput && toolInput.command;
    if (!commandTargetsLedger(command || '', ledgerPath)) return [];
    if (!bashLooksLikeLedgerMutation(command || '')) return [];
    let current = '';
    try { current = fs.readFileSync(ledgerPath, 'utf8'); } catch (e) { current = ''; }
    // Shell mutations are opaque at PreToolUse time. If a command is about
    // to mutate ledger.md outside Edit/MultiEdit/Write, treat the whole
    // current ledger as the "old" text and an empty post-state as unknown
    // removal until a typed Decision row exists.
    return [{ old: current, new: '' }];
  }
  if (toolName === 'Edit') {
    if (typeof toolInput.old_string !== 'string' || typeof toolInput.new_string !== 'string') return [];
    return [{ old: toolInput.old_string, new: toolInput.new_string }];
  }
  if (toolName === 'MultiEdit' && Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .filter((e) => typeof e.old_string === 'string' && typeof e.new_string === 'string')
      .map((e) => ({ old: e.old_string, new: e.new_string }));
  }
  if (toolName === 'Write' && typeof toolInput.content === 'string') {
    let current = '';
    try { current = fs.readFileSync(ledgerPath, 'utf8'); } catch (e) { current = ''; }
    return [{ old: current, new: toolInput.content }];
  }
  return [];
}

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

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  if (!projectRoot) return emit('allow', '');

  const ledgerPath = path.join(projectRoot, '.plan-enforcer', 'ledger.md');
  if (!targetsLedger(ctx.tool_name, ctx.tool_input, ledgerPath)) return emit('allow', '');

  const edits = toEdits(ctx.tool_name, ctx.tool_input, ledgerPath);
  if (edits.length === 0) return emit('allow', '');

  const bulkClosure = detectBulkPendingClosureFromEdits(edits);
  if (bulkClosure.bulk) {
    const tier = readTier(path.join(projectRoot, '.plan-enforcer'));
    const { action, message } = decide(tier, 'bulk_task_closure', {
      detail: bulkClosure.reason
    });
    emit(action, message);
    return;
  }

  const { uncovered, removed } = detectAcrossEdits(edits);
  if (uncovered.length === 0) return emit('allow', '');

  const tier = readTier(path.join(projectRoot, '.plan-enforcer'));
  const removedStr = removed.length > 4
    ? `${removed.slice(0, 4).join(', ')}, +${removed.length - 4} more`
    : removed.join(', ');
  const uncoveredStr = uncovered.length > 4
    ? `${uncovered.slice(0, 4).join(', ')}, +${uncovered.length - 4} more`
    : uncovered.join(', ');
  const detail = `Edit removes ${removed.length} T-row(s) from the ledger [${removedStr}]. ${uncovered.length} uncovered by Decision Log [${uncoveredStr}]. Add a Decision Log row with type=delete or type=unplanned and scope citing each removed T-ID before dropping rows.`;
  const { action, message } = decide(tier, 'unlogged_delete', { detail });
  emit(action, message);
}

try {
  main();
} catch (e) {
  process.stderr.write(`plan-enforcer ledger-schema-guard crashed: ${e.message}\n`);
  process.exit(0);
}

#!/usr/bin/env node
// Plan Enforcer — PreToolUse Delete Guard
//
// Blocks deletions that don't have a typed `delete` Decision Log row
// covering the target. Fires on:
//   - Bash commands: rm, git rm, git clean -f
//   - Edit/MultiEdit where the new_string is empty OR the removal
//     exceeds DELETE_THRESHOLD (default 50%) of the original
//
// Tier-aware via src/tier.js — advisory audits, structural always
// blocks (hard integrity break), enforced always blocks.
//
// Silent pass-through when:
//   - no enforcer dir is discoverable
//   - target is inside .plan-enforcer/ (control files)
//   - tool isn't one we can analyze (skips without judgment)

const fs = require('fs');
const path = require('path');
const { parseDecisionLog } = require('../src/ledger-parser');
const { DELETE_THRESHOLD, decide, readTier, shouldBlock } = require('../src/tier');
const { normalizePath, pathsMatch } = require('../src/planned-files');

const GUARDED_TOOLS = new Set(['Bash', 'Edit', 'MultiEdit']);

function readContext() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Find-up/find-down logic mirrored from chain-guard (shared enforcer-dir
// resolution semantics across all new P1 hooks).
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

/**
 * Tokenize a shell command into its args, stripping quotes. Naive — good
 * enough for rm/git-rm cases we care about, not a full shell parser.
 */
function tokenize(cmd) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] || m[2] || m[3]);
  }
  return tokens;
}

/**
 * Inspect a Bash command for deletion operations and return the paths
 * being deleted. Empty array = not a deletion we recognize.
 *
 * Recognized forms:
 *   rm <paths>            with any combination of -r -f -rf
 *   git rm <paths>        with any flags
 *   git clean -f[d][x] <paths-optional>
 */
function extractBashDeletePaths(command) {
  if (!command) return [];
  const tokens = tokenize(command);
  if (tokens.length === 0) return [];

  const paths = [];

  // rm ...
  if (tokens[0] === 'rm') {
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('-')) continue; // flag
      paths.push(t);
    }
    return paths;
  }

  // git rm ... / git clean -f ...
  if (tokens[0] === 'git' && tokens.length >= 2) {
    if (tokens[1] === 'rm') {
      for (let i = 2; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) continue;
        paths.push(t);
      }
      return paths;
    }
    if (tokens[1] === 'clean') {
      // Detect -f/-fd/-fdx which is destructive
      const hasForce = tokens.slice(2).some((t) => /^-[fdx]*f[fdx]*$/.test(t));
      if (!hasForce) return [];
      for (let i = 2; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) continue;
        paths.push(t);
      }
      // If no explicit path, git clean -f affects cwd — return ['.']
      if (paths.length === 0) paths.push('.');
      return paths;
    }
  }

  return [];
}

/**
 * Decide whether an Edit counts as a deletion. Returns { isDelete, target }.
 * Rules:
 *   - new_string is empty OR only whitespace AND old_string had content
 *   - OR: new length < old length * (1 - DELETE_THRESHOLD), i.e. removed
 *     more than 50% of characters
 */
function isEditDeletion(toolInput) {
  if (!toolInput) return { isDelete: false, target: null };
  const oldStr = toolInput.old_string || '';
  const newStr = toolInput.new_string || '';
  const target = toolInput.file_path || null;
  if (!target) return { isDelete: false, target: null };
  if (oldStr.length === 0) return { isDelete: false, target };

  if (newStr.trim() === '') {
    return { isDelete: true, target };
  }
  const ratio = 1 - newStr.length / oldStr.length;
  if (ratio >= DELETE_THRESHOLD) return { isDelete: true, target };
  return { isDelete: false, target };
}

/**
 * Check if a MultiEdit contains any delete-like edits.
 */
function multiEditDeletions(toolInput) {
  if (!toolInput) return [];
  const edits = toolInput.edits || [];
  const targets = [];
  for (const e of edits) {
    const newStr = e.new_string || '';
    const oldStr = e.old_string || '';
    if (oldStr.length === 0) continue;
    if (newStr.trim() === '' || (1 - newStr.length / oldStr.length) >= DELETE_THRESHOLD) {
      targets.push(toolInput.file_path);
      return targets; // one hit is enough
    }
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

function hasDeleteDRow(target, decisionRows) {
  const normTarget = normalizePath(target);
  for (const row of decisionRows) {
    if (row.type !== 'delete') continue;
    const scope = normalizePath(row.scope || '');
    if (!scope) continue;
    if (scope === normTarget) return true;
    if (pathsMatch(normTarget, scope)) return true;
    // Also allow directory scopes: "src/legacy/" covers "src/legacy/foo.ts"
    const scopeDir = scope.endsWith('/') ? scope : scope + '/';
    if (normTarget.startsWith(scopeDir)) return true;
  }
  return false;
}

function main() {
  const ctx = readContext();
  if (!ctx || !GUARDED_TOOLS.has(ctx.tool_name)) return emit('allow', '');

  let deletedTargets = [];
  if (ctx.tool_name === 'Bash') {
    const cmd = (ctx.tool_input && ctx.tool_input.command) || '';
    deletedTargets = extractBashDeletePaths(cmd);
  } else if (ctx.tool_name === 'Edit') {
    const { isDelete, target } = isEditDeletion(ctx.tool_input);
    if (isDelete) deletedTargets = [target];
  } else if (ctx.tool_name === 'MultiEdit') {
    deletedTargets = multiEditDeletions(ctx.tool_input);
  }

  if (deletedTargets.length === 0) return emit('allow', '');

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  if (!projectRoot) return emit('allow', '');

  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const ledgerPath = path.join(enforcerDir, 'ledger.md');
  if (!fs.existsSync(ledgerPath)) return emit('allow', '');

  // Never guard the enforcer's own files.
  const relTargets = deletedTargets
    .map((t) => normalizePath(path.isAbsolute(t) ? path.relative(projectRoot, t) : t))
    .filter((t) => !t.startsWith('.plan-enforcer/'));
  if (relTargets.length === 0) return emit('allow', '');

  const tier = readTier(enforcerDir);
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const decisionRows = parseDecisionLog(ledger);

  // Every deleted target must have a delete D-row covering it. If any is
  // uncovered, the whole op is flagged.
  const uncovered = relTargets.filter((t) => !hasDeleteDRow(t, decisionRows));
  if (uncovered.length === 0) return emit('allow', '');

  const detail = `Target${uncovered.length > 1 ? 's' : ''}: ${uncovered.join(', ')}. Add Decision Log row(s) with type=delete and scope=<path> documenting what was removed and why.`;
  const { action, message } = decide(tier, 'unlogged_delete', { detail });
  emit(action, message);
}

try {
  main();
} catch (e) {
  process.stderr.write(`plan-enforcer delete-guard crashed: ${e.message}\n`);
  process.exit(0);
}

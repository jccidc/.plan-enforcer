#!/usr/bin/env node
// Plan Enforcer — PostToolUse Evidence Gate
//
// Fires when a ledger Edit transitions a row's Status from anything to
// 'verified'. Validates the Evidence cell against src/evidence.js. If
// no structural signal resolves, raises a tier-aware violation
// ('missing_evidence') — advisory audits, structural + enforced block.
//
// Implementation note on PostToolUse "blocking": the tool call has
// already happened. We cannot undo it. What we CAN do is:
//   - surface the violation in additionalContext (agent sees it)
//   - exit 2 on block (downstream hooks / logs capture the failure)
//   - record in session-log so later audits can detect the break
// The "block" is softer than chain-guard's PreToolUse block: the edit
// landed, but the agent gets a loud, structured signal that the claim
// is not verifiable.

const fs = require('fs');
const path = require('path');
const { parseMetadata, parseTaskRows, splitRow } = require('../src/ledger-parser');
const { decide, readTier, shouldBlock } = require('../src/tier');
const {
  assessAwarenessQuoteVerification,
  currentIntents,
  loadAwarenessState,
  resolveTaskAwareness
} = require('../src/awareness');
const { validateEvidence } = require('../src/evidence');
const { readConfig } = require('../src/config');
const { runExecutedVerification } = require('../src/executed-verification');

function readContext() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

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
  return findUpEnforcerDir(cwd) || findDownEnforcerDir(cwd, 3);
}

// Extract verified rows from a ledger string. Returns array of
// { id, name, evidence, chain }.
function verifiedRows(ledger) {
  try {
    return parseTaskRows(ledger).filter((r) => r.status === 'verified');
  } catch (e) {
    return [];
  }
}

// Determine the set of row IDs that flipped to 'verified' in this edit.
// Simple shape: compare before-state (tool_input.old_string, if
// present) to after-state (current ledger on disk) — if the old
// string had the row in a non-verified state and the new string has
// it verified, it flipped. For Write tool (no old_string), every
// verified row in the new file counts.
function flippedToVerified(toolName, toolInput, currentLedger) {
  const nowVerifiedIds = new Set(verifiedRows(currentLedger).map((r) => r.id));
  if (toolName === 'Write') {
    // Fresh file — can't tell what flipped vs existed. Validate all
    // verified rows present. This is the conservative choice.
    return [...nowVerifiedIds];
  }
  if (toolName === 'Edit' && toolInput && toolInput.old_string) {
    const oldStr = toolInput.old_string;
    const flipped = [];
    for (const id of nowVerifiedIds) {
      const rowRe = new RegExp(`^\\|\\s*${id}\\s*\\|[^\\n]+`, 'm');
      const oldMatch = oldStr.match(rowRe);
      if (!oldMatch) {
        // The row ID isn't in old_string, which means the edit didn't
        // touch this row. It was already verified before this edit;
        // skipping validation avoids re-prosecuting the same row on
        // every unrelated edit.
        continue;
      }
      const oldCells = splitRow(oldMatch[0]);
      const oldStatus = (oldCells[2] || '').toLowerCase();
      if (oldStatus !== 'verified') flipped.push(id);
    }
    return flipped;
  }
  if (toolName === 'MultiEdit' && toolInput && Array.isArray(toolInput.edits)) {
    // Union of flips across each edit
    const flipped = new Set();
    for (const e of toolInput.edits) {
      const sub = flippedToVerified('Edit', { old_string: e.old_string }, currentLedger);
      for (const id of sub) flipped.add(id);
    }
    return [...flipped];
  }
  return [];
}

function emit(action, message) {
  if (!message) process.exit(0);
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
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
  if (!ctx) return emit('allow', '');
  if (!['Edit', 'Write', 'MultiEdit'].includes(ctx.tool_name)) return emit('allow', '');

  const target = ctx.tool_input && ctx.tool_input.file_path;
  if (!target) return emit('allow', '');
  if (!/[\/\\]\.plan-enforcer[\/\\]ledger\.md$/.test(target) && !/^\.plan-enforcer[\/\\]ledger\.md$/.test(target)) {
    return emit('allow', '');
  }

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  if (!projectRoot) return emit('allow', '');

  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const ledgerPath = path.join(enforcerDir, 'ledger.md');
  if (!fs.existsSync(ledgerPath)) return emit('allow', '');

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const meta = parseMetadata(ledger);
  if (meta.schema !== 'v2') return emit('allow', ''); // v1 has no chain contract

  const tier = readTier(enforcerDir);
  const config = readConfig(path.join(enforcerDir, 'config.md'));
  const awareness = loadAwarenessState({ projectRoot });
  const activeIntents = currentIntents(awareness.state);
  const quoteAssessment = assessAwarenessQuoteVerification(awareness.state, { projectRoot });

  const flipped = flippedToVerified(ctx.tool_name, ctx.tool_input, ledger);
  if (flipped.length === 0) return emit('allow', '');

  const rows = parseTaskRows(ledger);
  const invalid = [];
  const awarenessGaps = [];
  const quoteGaps = quoteAssessment.issues.map((issue) => ({
    id: issue.row,
    name: issue.source || 'no source',
    warnings: [issue.message]
  }));
  const sessionLogPath = path.join(enforcerDir, '.session-log.jsonl');
  for (const id of flipped) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const result = validateEvidence(row.evidence, { projectRoot, sessionLogPath });
    if (!result.valid) {
      invalid.push({ id, name: row.name, warnings: result.warnings });
      continue;
    }
    const executed = runExecutedVerification({
      projectRoot,
      enforcerDir,
      taskId: id,
      evidenceText: row.evidence,
      config
    });
    if (!executed.detected && executed.required) {
      invalid.push({
        id,
        name: row.name,
        warnings: [
          'Evidence claims executable verification but no runnable command could be detected.',
          'Cite the exact command in Evidence or set check_cmd in .plan-enforcer/config.md before marking verified.'
        ]
      });
      continue;
    }
    if (executed.detected && !executed.ok) {
      const why = executed.timedOut
        ? `Executed verification timed out for "${executed.command}".`
        : `Executed verification failed for "${executed.command}" (exit ${executed.exitCode}).`;
      invalid.push({
        id,
        name: row.name,
        warnings: [
          why,
          `See ${executed.logPath} for captured output.`
        ]
      });
    }
    if (activeIntents.length > 0) {
      const assessment = resolveTaskAwareness(row, awareness.state, { config });
      for (const issue of assessment.issues) {
        awarenessGaps.push({
          id,
          name: row.name,
          warnings: [issue.message]
        });
      }
    }
  }

  if (invalid.length === 0 && awarenessGaps.length === 0 && quoteGaps.length === 0) return emit('allow', '');

  let violation = 'missing_evidence';
  let heading = 'Rows flipped to verified without a resolvable structural signal:';
  let problems = invalid;
  if (invalid.length === 0 && awarenessGaps.length > 0 && quoteGaps.length === 0) {
    violation = 'missing_awareness_link';
    heading = 'Rows flipped to verified without a plausible awareness link:';
    problems = awarenessGaps;
  } else if (invalid.length === 0 && awarenessGaps.length === 0 && quoteGaps.length > 0) {
    violation = 'unverified_awareness_quote';
    heading = 'Awareness intent quotes could not be verified against captured user prompts:';
    problems = quoteGaps;
  } else if (invalid.length > 0 || awarenessGaps.length > 0 || quoteGaps.length > 0) {
    heading = 'Rows flipped to verified with evidence and/or awareness integrity gaps:';
    violation = invalid.length > 0
      ? 'missing_evidence'
      : (awarenessGaps.length > 0 ? 'missing_awareness_link' : 'unverified_awareness_quote');
    problems = invalid.concat(awarenessGaps, quoteGaps);
  }

  const details = problems.map((i) => `  ${i.id} (${i.name}): ${i.warnings.join(' ')}`).join('\n');
  const { action, message } = decide(tier, violation, {
    detail: `${heading}\n${details}`
  });
  emit(action, message);
}

try {
  main();
} catch (e) {
  process.stderr.write(`plan-enforcer evidence-gate crashed: ${e.message}\n`);
  process.exit(0);
}

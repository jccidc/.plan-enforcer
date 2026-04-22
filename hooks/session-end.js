#!/usr/bin/env node
// Plan Enforcer - SessionEnd Hook
// Fails loud if the enforced tier was active but the ledger is missing at
// session end. Catches the silent failure mode where a plan was enforced but
// no ledger ever persisted on disk (e.g., agent cd'd into a subdir and wrote
// a ledger the hooks never found, or dropped tracking entirely).

const fs = require('fs');
const path = require('path');
const { parseMetadata, parseTaskRows } = require('../src/ledger-parser');
const { loadAwarenessState, orphanIntents } = require('../src/awareness');
const { readConfig } = require('../src/config');
const { assessExecutedVerification } = require('../src/executed-verification');
const { decide, shouldBlock } = require('../src/tier');

const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);

function unfinishedRows(rows) {
  return rows.filter((r) => !TERMINAL_STATUSES.has(r.status));
}

function appendAuditLog(enforcerDir, record) {
  const logPath = path.join(enforcerDir, '.audit-log.jsonl');
  try {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
    return logPath;
  } catch (_e) {
    return null;
  }
}

function verificationGateIssues(rows, projectRoot, enforcerDir, config) {
  const issues = [];
  for (const row of rows) {
    if (row.status !== 'verified') continue;
    const executed = assessExecutedVerification({
      projectRoot,
      enforcerDir,
      taskId: row.id,
      evidenceText: row.evidence,
      config
    });
    if (executed.state === 'missing') {
      issues.push({
        id: row.id,
        name: row.name,
        message: `expected executed verification (${executed.command}) but no check sidecar exists`
      });
    } else if (executed.state === 'failed') {
      issues.push({
        id: row.id,
        name: row.name,
        message: `latest executed verification failed (${executed.latest.command})`
      });
    } else if (executed.state === 'stale') {
      issues.push({
        id: row.id,
        name: row.name,
        message: `latest executed verification is stale (${executed.latest.command} vs expected ${executed.command})`
      });
    }
  }
  return issues;
}

function awarenessOrphanIssues(projectRoot, ledgerPath, config) {
  const loaded = loadAwarenessState({ projectRoot, ledgerPath });
  const orphans = orphanIntents(loaded.state, loaded.ledgerPath, { config });
  return {
    awarenessPath: loaded.awarenessPath,
    orphans
  };
}

function writeResumeSnapshot(enforcerDir, rows) {
  const unfinished = unfinishedRows(rows);
  if (unfinished.length === 0) return null;
  const nextRow = unfinished[0];
  const completed = rows.length - unfinished.length;
  const resumePath = path.join(enforcerDir, 'resume.md');
  const lines = [
    '# Resume Snapshot',
    '',
    `- Completed rows: ${completed}/${rows.length}`,
    `- Remaining rows: ${unfinished.length}`,
    `- Next row: ${nextRow.id} [${nextRow.status}] ${nextRow.name}`,
    `- Open rows: ${unfinished.map((r) => `${r.id} [${r.status}] ${r.name}`).join('; ')}`
  ];
  try {
    fs.writeFileSync(resumePath, lines.join('\n') + '\n', 'utf8');
    return resumePath;
  } catch (_e) {
    return null;
  }
}

const cwd = process.cwd();
const cwdEnforcerDir = path.join(cwd, '.plan-enforcer');
const activeRootPath = path.join(cwdEnforcerDir, '.active-root');

// Same find-up/find-down semantics as post-tool.js and session-start.js.
function findUpEnforcerDir(startDir) {
  let dir = startDir;
  const rootPath = path.parse(dir).root;
  for (let depth = 0; depth < 3 && dir && dir !== rootPath; depth++) {
    const candidate = path.join(dir, '.plan-enforcer');
    const hasLedger = fs.existsSync(path.join(candidate, 'ledger.md')) || fs.existsSync(path.join(candidate, 'archive'));
    const hasConfig = fs.existsSync(path.join(candidate, 'config.md'));
    const isProjectRoot = fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
    if ((hasLedger || hasConfig) && isProjectRoot) return dir;
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
          const hasLedger = fs.existsSync(path.join(full, 'ledger.md')) || fs.existsSync(path.join(full, 'archive'));
          const hasConfig = fs.existsSync(path.join(full, 'config.md'));
          if (hasLedger || hasConfig) return dir;
        }
        stack.push({ dir: full, depth: depth + 1 });
      }
    } catch (e) {}
  }
  return null;
}

function archiveHasLedger(archiveDir) {
  try {
    return fs.readdirSync(archiveDir).some((f) => f.endsWith('.md'));
  } catch (e) {
    return false;
  }
}

function main() {
  let projectRoot = cwd;
  try {
    const storedRoot = fs.readFileSync(activeRootPath, 'utf8').trim();
    if (storedRoot && fs.existsSync(path.join(storedRoot, '.plan-enforcer'))) {
      projectRoot = storedRoot;
    }
  } catch (e) {}

  if (projectRoot === cwd) {
    const hasLocal = fs.existsSync(path.join(cwdEnforcerDir, 'ledger.md'))
      || fs.existsSync(path.join(cwdEnforcerDir, 'archive'))
      || fs.existsSync(path.join(cwdEnforcerDir, 'config.md'));
    if (!hasLocal) {
      const up = findUpEnforcerDir(cwd);
      if (up) projectRoot = up;
      else {
        const down = findDownEnforcerDir(cwd, 3);
        if (down) projectRoot = down;
      }
    }
  }

  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  if (!fs.existsSync(enforcerDir)) return; // not using enforcer

  const configPath = path.join(enforcerDir, 'config.md');
  const config = readConfig(configPath);
  const tier = (config.tier || '').toLowerCase();
  const configuredGate = (config.completion_gate || 'soft').toLowerCase();
  const gate = configuredGate;

  // Completion-gate consumers run regardless of tier. The gate is
  // orthogonal to tier: a team can run advisory tier but still want a
  // hard gate on session close, or vice versa.
  const ledgerPath = path.join(enforcerDir, 'ledger.md');
  const relDir = path.relative(cwd, enforcerDir).replace(/\\/g, '/') || '.plan-enforcer';
  let allowBenchmarkPartialClose = false;
  try {
    allowBenchmarkPartialClose = fs.existsSync(path.join(enforcerDir, '.benchmark-allow-partial-close'));
  } catch (_e) {}
  if (fs.existsSync(ledgerPath) && (gate === 'hard' || gate === 'audit')) {
    try {
      const ledger = fs.readFileSync(ledgerPath, 'utf8');
      const rows = parseTaskRows(ledger);
      const unfinished = unfinishedRows(rows);
      if (unfinished.length > 0) {
        const resumePath = writeResumeSnapshot(enforcerDir, rows);
        if (allowBenchmarkPartialClose) {
          return;
        }
        const record = {
          event: 'session_end_unfinished_rows',
          timestamp: new Date().toISOString(),
          tier,
          completion_gate: gate,
          ledger_path: relDir + '/ledger.md',
          unfinished: unfinished.map((r) => ({ id: r.id, status: r.status, name: r.name }))
        };

        if (gate === 'audit') {
          const written = appendAuditLog(enforcerDir, record);
          const lines = [
            'PLAN ENFORCER [audit mode]: session closing with unfinished rows.',
            `${unfinished.length} row(s) not in terminal status (verified/skipped/blocked):`,
            ...unfinished.slice(0, 10).map((r) => `  ${r.id} [${r.status}] ${r.name}`),
            unfinished.length > 10 ? `  ...and ${unfinished.length - 10} more` : null,
            resumePath ? `Resume snapshot: ${relDir}/resume.md` : 'Resume snapshot write failed (non-fatal).',
            written ? `Logged to ${relDir}/.audit-log.jsonl for CI consumption.` : 'Audit log write failed (non-fatal).'
          ].filter(Boolean);
          process.stderr.write(lines.join('\n') + '\n');
          // audit mode never blocks; continue to downstream checks.
        } else if (gate === 'hard') {
          const lines = [
            'PLAN ENFORCER [hard gate]: session close refused — unfinished rows.',
            `${unfinished.length} row(s) not in terminal status (verified/skipped/blocked):`,
            ...unfinished.slice(0, 20).map((r) => `  ${r.id} [${r.status}] ${r.name}`),
            unfinished.length > 20 ? `  ...and ${unfinished.length - 20} more` : null,
            resumePath ? `Resume snapshot: ${relDir}/resume.md` : 'Resume snapshot write failed (non-fatal).',
            '',
            'Resolve by marking each row verified / skipped / blocked, or flip',
            'completion_gate to soft/audit via plan-enforcer-config.'
          ].filter(Boolean);
          process.stderr.write(lines.join('\n') + '\n');
          process.exit(2);
        }
      }

      const verificationIssues = verificationGateIssues(rows, projectRoot, enforcerDir, config);
      if (verificationIssues.length > 0) {
        const record = {
          event: 'session_end_executed_verification_gap',
          timestamp: new Date().toISOString(),
          tier,
          completion_gate: gate,
          ledger_path: relDir + '/ledger.md',
          rows: verificationIssues
        };

        if (gate === 'audit') {
          const written = appendAuditLog(enforcerDir, record);
          const lines = [
            'PLAN ENFORCER [audit mode]: session closing with executed-verification gaps.',
            `${verificationIssues.length} verified row(s) do not have a clean executed check:`,
            ...verificationIssues.slice(0, 10).map((r) => `  ${r.id} ${r.message}`),
            verificationIssues.length > 10 ? `  ...and ${verificationIssues.length - 10} more` : null,
            written ? `Logged to ${relDir}/.audit-log.jsonl for CI consumption.` : 'Audit log write failed (non-fatal).'
          ].filter(Boolean);
          process.stderr.write(lines.join('\n') + '\n');
        } else if (gate === 'hard') {
          const lines = [
            'PLAN ENFORCER [hard gate]: session close refused — executed verification incomplete.',
            `${verificationIssues.length} verified row(s) do not have a clean executed check:`,
            ...verificationIssues.slice(0, 20).map((r) => `  ${r.id} [verified] ${r.name}: ${r.message}`),
            verificationIssues.length > 20 ? `  ...and ${verificationIssues.length - 20} more` : null,
            '',
            'Resolve by re-running the required verification command so a green check sidecar exists,',
            'or change completion_gate to soft/audit via plan-enforcer-config.'
          ].filter(Boolean);
          process.stderr.write(lines.join('\n') + '\n');
          process.exit(2);
        }
      }

      const awarenessIssues = awarenessOrphanIssues(projectRoot, ledgerPath, config);
      if (false && awarenessIssues.orphans.length > 0) {
        const record = {
          event: 'session_end_orphan_intents',
          timestamp: new Date().toISOString(),
          tier,
          completion_gate: gate,
          awareness_path: path.relative(cwd, awarenessIssues.awarenessPath).replace(/\\/g, '/'),
          intents: awarenessIssues.orphans.map((row) => ({
            id: row.id,
            quote: row.quote,
            scope: row.scope
          }))
        };

        if (gate === 'audit') {
          const written = appendAuditLog(enforcerDir, record);
          const lines = [
            'PLAN ENFORCER [audit mode]: session closing with orphan awareness intents.',
            `${awarenessIssues.orphans.length} intent row(s) have no linked task in the ledger:`,
            ...awarenessIssues.orphans.slice(0, 10).map((row) => `  ${row.id} [${row.scope}] ${row.quote}`),
            awarenessIssues.orphans.length > 10 ? `  ...and ${awarenessIssues.orphans.length - 10} more` : null,
            written ? `Logged to ${relDir}/.audit-log.jsonl for CI consumption.` : 'Audit log write failed (non-fatal).'
          ].filter(Boolean);
          process.stderr.write(lines.join('\n') + '\n');
        } else if (gate === 'hard') {
          const lines = [
            'PLAN ENFORCER [hard gate]: session close refused — orphan awareness intents remain.',
            `${awarenessIssues.orphans.length} intent row(s) have no linked task in the ledger:`,
            ...awarenessIssues.orphans.slice(0, 20).map((row) => `  ${row.id} [${row.scope}] ${row.quote}`),
            awarenessIssues.orphans.length > 20 ? `  ...and ${awarenessIssues.orphans.length - 20} more` : null,
            '',
            'Resolve by linking each intent to at least one task via Chain awareness tokens,',
            'or capture a typed correction if the scope was intentionally removed.'
          ].filter(Boolean);
          process.stderr.write(lines.join('\n') + '\n');
          process.exit(2);
        }
      }
    } catch (_e) {
      // Non-fatal; unreadable ledger won't hard-fail the gate.
    }
  }

  if (fs.existsSync(ledgerPath)) {
    try {
      const awarenessIssues = awarenessOrphanIssues(projectRoot, ledgerPath, config);
      if (awarenessIssues.orphans.length > 0) {
        const written = appendAuditLog(enforcerDir, {
          event: 'session_end_orphan_intents',
          timestamp: new Date().toISOString(),
          tier,
          awareness_path: path.relative(cwd, awarenessIssues.awarenessPath).replace(/\\/g, '/'),
          intents: awarenessIssues.orphans.map((row) => ({
            id: row.id,
            quote: row.quote,
            scope: row.scope
          }))
        });
        const detail = [
          `${awarenessIssues.orphans.length} intent row(s) have no linked task in the ledger:`,
          ...awarenessIssues.orphans.slice(0, 20).map((row) => `  ${row.id} [${row.scope}] ${row.quote}`),
          awarenessIssues.orphans.length > 20 ? `  ...and ${awarenessIssues.orphans.length - 20} more` : null,
          written ? `Logged to ${relDir}/.audit-log.jsonl.` : 'Audit log write failed (non-fatal).'
        ].filter(Boolean).join('\n');
        const { action, message } = decide(tier, 'orphan_intent', { detail });
        if (action === 'warn' || action === 'block') {
          process.stderr.write(message + '\n');
          if (shouldBlock(action)) process.exit(2);
        }
      }
    } catch (_e) {
      // Non-fatal; awareness parser bugs should not brick session close.
    }
  }

  if (tier !== 'enforced') return;

  const archiveDir = path.join(enforcerDir, 'archive');
  const ledgerExists = fs.existsSync(ledgerPath);
  const archivedExists = fs.existsSync(archiveDir) && archiveHasLedger(archiveDir);

  // Failure mode 1: enforced tier but no ledger persisted anywhere.
  if (!ledgerExists && !archivedExists) {
    const lines = [
      'PLAN ENFORCER: ENFORCED-TIER RUN-END FAILURE',
      `Config tier is 'enforced' at ${relDir}/config.md but no ledger was found.`,
      `  Expected: ${relDir}/ledger.md  (or an archived ledger under ${relDir}/archive/)`,
      'Neither exists. The enforcer was active for this session but the ledger',
      'never persisted on disk. Likely causes:',
      '  - agent changed directory and wrote the ledger somewhere the hooks could not find',
      '  - ledger was deleted or never created',
      '  - plan activation silently failed',
      'This indicates a silent failure. Do not trust this session\'s work as verified.'
    ];
    process.stderr.write(lines.join('\n') + '\n');
    process.exit(2);
  }

  // Failure mode 2: chain integrity break. Any row flipped to 'verified'
  // must have a non-empty Chain column. Empty Chain on a verified row
  // means the agent claimed done without recording what produced it.
  // Soft check — surfaces the row IDs so a user can fix. Deep resolution
  // (chain refs validated against git log / tool outputs) is P4's
  // plan-enforcer-audit --strict.
  if (ledgerExists) {
    try {
      const ledger = fs.readFileSync(ledgerPath, 'utf8');
      const meta = parseMetadata(ledger);
      // Only check v2 ledgers — v1 has no Chain column so this check is N/A.
      if (meta.schema === 'v2') {
        const rows = parseTaskRows(ledger);
        const orphans = rows.filter((r) => r.status === 'verified' && (!r.chain || r.chain.length === 0));
        if (orphans.length > 0) {
          const orphanList = orphans.map((r) => `  ${r.id} - ${r.name}`).join('\n');
          const lines = [
            'PLAN ENFORCER: CHAIN INTEGRITY WARNING',
            `Ledger at ${relDir}/ledger.md has ${orphans.length} verified row(s) with an empty Chain column:`,
            orphanList,
            '',
            'Every verified row should have at least one Chain reference (a',
            'Decision ID, commit SHA as "C:<sha>", or Verification ID as',
            '"V<n>"). An empty Chain on a verified row means the agent',
            'claimed done without recording what produced the outcome.',
            '',
            'To repair: add the missing refs to the Chain cell of each row.',
            'For deeper audit run plan-enforcer-audit --strict (ships in P4).'
          ];
          process.stderr.write(lines.join('\n') + '\n');
          process.exit(2);
        }
      }
    } catch (e) {
      // Non-fatal — an unreadable ledger shouldn't hard-fail session end
      // over a soft chain check. The missing-ledger check above is the
      // load-bearing one.
    }
  }
}

try {
  main();
} catch (e) {
  // Never crash the session end on our own bugs — still emit a signal.
  process.stderr.write(`plan-enforcer session-end: ${e.message}\n`);
  process.exit(0);
}

// Plan Enforcer — Ledger Integrity Audit
// Structural checks over a single ledger. Does NOT verify must-haves
// (plan-enforcer-verify owns goal-backward checks). Does NOT validate
// raw schema shape (plan-enforcer-lint owns that). Audits the
// relationships between rows: D-refs resolve, commit SHAs in Chain
// resolve, task/D-IDs are unique, verified rows have evidence, done
// rows with evidence look like they should be verified.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseTaskRows, parseDecisionLog, parseMetadata } = require('./ledger-parser');
const { validateEvidence } = require('./evidence');
const { classifyChainToken } = require('./chain');
const { assessExecutedVerification } = require('./executed-verification');
const { assessAwarenessQuoteVerification, resolveTaskAwareness } = require('./awareness');
const { readAwareness } = require('./awareness-parser');
const { readConfig } = require('./config');

function addFinding(findings, severity, code, message, row) {
  findings.push({ severity, code, message, row: row || null });
}

function commitExists(sha, cwd) {
  // Avoid `sha^{commit}` — `^` is a cmd.exe escape char and gets
  // silently mangled on Windows (P2 T1 retro). `rev-parse --verify`
  // takes a plain sha and exits nonzero on miss with no quoting grief.
  try {
    execSync(`git rev-parse --verify ${sha}`, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Audit a ledger. Returns structured findings.
 *
 * @param {{ ledgerPath?: string, cwd?: string, enforcerDir?: string }} [opts]
 * @returns {{
 *   ledgerPath: string,
 *   schema: 'v1' | 'v2',
 *   counts: { tasks: number, decisions: number, errors: number, warnings: number },
 *   findings: Array<{ severity: 'error' | 'warning', code: string, message: string, row: string | null }>
 * }}
 */
function auditLedger(opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();
  const enforcerDir = opts.enforcerDir || path.join(cwd, '.plan-enforcer');
  const ledgerPath = opts.ledgerPath || path.join(enforcerDir, 'ledger.md');

  const findings = [];

  if (!fs.existsSync(ledgerPath)) {
    addFinding(findings, 'error', 'NO_LEDGER', `Ledger not found at ${ledgerPath}`);
    return {
      ledgerPath, schema: 'v2',
      counts: { tasks: 0, decisions: 0, errors: 1, warnings: 0 },
      findings
    };
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const meta = parseMetadata(ledger);
  const tasks = parseTaskRows(ledger);
  const decisions = parseDecisionLog(ledger);
  const config = readConfig(path.join(enforcerDir, 'config.md'));
  const awarenessState = readAwareness(path.join(enforcerDir, 'awareness.md'));
  const awarenessQuoteAssessment = assessAwarenessQuoteVerification(awarenessState, { projectRoot: cwd });

  if (meta.schema === 'v1') {
    addFinding(findings, 'warning', 'SCHEMA_V1', 'Ledger is on schema v1 — Chain column + typed Decision Log unavailable. Run schema-migrate to upgrade.');
  }

  for (const issue of awarenessQuoteAssessment.issues) {
    addFinding(findings, 'warning', issue.code, issue.message, issue.row);
  }

  // 1. Unique task IDs
  const taskIds = new Map();
  for (const t of tasks) {
    const key = (t.id || '').toUpperCase();
    if (taskIds.has(key)) {
      addFinding(findings, 'error', 'DUPLICATE_TASK_ID', `Task ID ${t.id} appears more than once`, t.id);
    } else {
      taskIds.set(key, t);
    }
  }

  // 2. Unique D-IDs
  const dIds = new Map();
  for (const d of decisions) {
    const key = (d.id || '').toUpperCase();
    if (dIds.has(key)) {
      addFinding(findings, 'error', 'DUPLICATE_D_ID', `Decision ID ${d.id} appears more than once`, d.id);
    } else {
      dIds.set(key, d);
    }
  }

  // 3. Chain column refs resolve
  for (const t of tasks) {
    for (const raw of t.chain || []) {
      const c = classifyChainToken(raw);
      if (c.kind === 'decision') {
        if (!dIds.has(c.value)) {
          addFinding(findings, 'error', 'DANGLING_D_REF', `Task ${t.id} Chain references ${c.value} but no such Decision Log row exists`, t.id);
        }
      } else if (c.kind === 'commit') {
        if (!commitExists(c.value, cwd)) {
          addFinding(findings, 'warning', 'UNRESOLVED_COMMIT', `Task ${t.id} Chain references commit ${c.value} but git cannot find it`, t.id);
        }
      } else if (c.kind === 'unknown') {
        addFinding(findings, 'warning', 'UNKNOWN_CHAIN_TOKEN', `Task ${t.id} Chain token "${c.raw}" does not match D<n>, V<n>, or commit SHA shape`, t.id);
      }
    }
  }

  // 4. verified rows must carry evidence
  for (const t of tasks) {
    if (t.status === 'verified') {
      if (!t.evidence || !t.evidence.trim()) {
        addFinding(findings, 'error', 'VERIFIED_WITHOUT_EVIDENCE', `Task ${t.id} is verified but Evidence cell is empty`, t.id);
      } else {
        const ev = validateEvidence(t.evidence, { projectRoot: cwd, enforcerDir });
        if (!ev.valid) {
          addFinding(findings, 'warning', 'EVIDENCE_UNRESOLVED', `Task ${t.id} is verified but no evidence signal resolved (commit / file / test / session-log)`, t.id);
        } else {
          const executed = assessExecutedVerification({
            projectRoot: cwd,
            enforcerDir,
            taskId: t.id,
            evidenceText: t.evidence,
            config
          });
          if (executed.state === 'missing') {
            addFinding(findings, 'error', 'EXECUTED_VERIFICATION_MISSING', `Task ${t.id} is verified and expects executed verification (${executed.command}) but no check sidecar exists`, t.id);
          } else if (executed.state === 'failed') {
            addFinding(findings, 'error', 'EXECUTED_VERIFICATION_FAILED', `Task ${t.id} is verified but latest executed verification failed (${executed.latest.command})`, t.id);
          } else if (executed.state === 'stale') {
            addFinding(findings, 'warning', 'EXECUTED_VERIFICATION_STALE', `Task ${t.id} is verified but latest executed verification ran ${executed.latest.command} instead of expected ${executed.command}`, t.id);
          }
        }
      }
      if (awarenessState.schema !== 'missing') {
        const awareness = resolveTaskAwareness(t, awarenessState, { config });
        for (const issue of awareness.issues) {
          addFinding(findings, 'warning', issue.code, issue.message, t.id);
        }
      }
    }
  }

  // 5. done rows with resolvable evidence should be verified
  for (const t of tasks) {
    if (t.status === 'done' && t.evidence && t.evidence.trim()) {
      const ev = validateEvidence(t.evidence, { projectRoot: cwd, enforcerDir });
      if (ev.valid) {
        addFinding(findings, 'warning', 'DONE_WITH_REAL_EVIDENCE', `Task ${t.id} is done with resolvable evidence — promote to verified`, t.id);
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  return {
    ledgerPath,
    schema: meta.schema,
    counts: { tasks: tasks.length, decisions: decisions.length, errors, warnings },
    findings
  };
}

module.exports = { auditLedger, commitExists };

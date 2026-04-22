// Plan Enforcer — Chain Resolver
// Pure-ish module that, given a task ID, returns the full audit trail:
// the ledger task row, every Decision Log entry scoped to the task, the
// parsed Chain column references (decision IDs, commit SHAs, verification
// IDs), the resolved git commits for those SHAs, and the structural
// evidence signals parsed out of the Evidence cell.
//
// Used by plan-enforcer-chain (direct query by task ID) and plan-enforcer-
// audit (integrity sweep). Output is structured data — CLI layers render.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  parseTaskRows,
  parseDecisionLog,
  parseMetadata
} = require('./ledger-parser');
const { validateEvidence } = require('./evidence');

const COMMIT_TOKEN_RE = /^(?:C:)?([0-9a-f]{7,40})$/i;
const DECISION_TOKEN_RE = /^D\d+$/i;
const VERIFICATION_TOKEN_RE = /^V\d+$/i;
const AWARENESS_TOKEN_RE = /^A:(I\d+|R\d+)$/i;

/**
 * Classify a single Chain cell token.
 * @param {string} token
 * @returns {{ kind: 'decision' | 'commit' | 'verification' | 'awareness' | 'unknown', value: string, raw: string }}
 */
function classifyChainToken(token) {
  const raw = token;
  if (DECISION_TOKEN_RE.test(token)) return { kind: 'decision', value: token.toUpperCase(), raw };
  if (VERIFICATION_TOKEN_RE.test(token)) return { kind: 'verification', value: token.toUpperCase(), raw };
  if (AWARENESS_TOKEN_RE.test(token)) return { kind: 'awareness', value: token.toUpperCase(), raw };
  const commitMatch = token.match(COMMIT_TOKEN_RE);
  if (commitMatch) return { kind: 'commit', value: commitMatch[1].toLowerCase(), raw };
  return { kind: 'unknown', value: token, raw };
}

/**
 * Resolve a git commit SHA to { sha, subject, date, author }.
 * Returns null if the SHA is not reachable in the current repo.
 * @param {string} sha
 * @param {string} cwd
 * @returns {{ sha: string, subject: string, date: string, author: string } | null}
 */
function resolveCommitMeta(sha, cwd) {
  try {
    const out = execSync(
      `git log -1 --format=%H%x1f%s%x1f%aI%x1f%an ${sha}`,
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (!out) return null;
    const [fullSha, subject, date, author] = out.split('\x1f');
    return { sha: fullSha, subject, date, author };
  } catch (_e) {
    return null;
  }
}

/**
 * Find all decisions related to a task:
 *   - decisions whose Scope cell mentions the task ID on a word boundary
 *   - decisions whose ID is listed in the task's Chain column
 * Returns the union, de-duplicated by D-ID, preserving ledger order.
 *
 * @param {string} taskId
 * @param {Array<{id: string, type: string, scope: string, reason: string, evidence: string}>} decisions
 * @param {string[]} chainDecisionIds
 * @returns {Array<object>}
 */
function relatedDecisions(taskId, decisions, chainDecisionIds) {
  const idRe = new RegExp(`\\b${taskId}\\b`);
  const chainSet = new Set(chainDecisionIds.map((s) => s.toUpperCase()));
  const picked = [];
  const seen = new Set();
  for (const d of decisions) {
    const hitScope = idRe.test(d.scope || '');
    const hitChain = chainSet.has((d.id || '').toUpperCase());
    if ((hitScope || hitChain) && !seen.has(d.id)) {
      seen.add(d.id);
      picked.push(d);
    }
  }
  return picked;
}

/**
 * Resolve the full audit trail for a single task ID.
 *
 * @param {string} taskId - e.g. "T5"
 * @param {{ ledgerPath?: string, cwd?: string, enforcerDir?: string }} [opts]
 * @returns {{
 *   taskId: string,
 *   found: boolean,
 *   ledgerPath: string,
 *   schema: 'v1' | 'v2',
 *   task: object | null,
 *   decisions: object[],
 *   chainRefs: { decisions: string[], commits: string[], verifications: string[], awareness: string[], unknown: string[] },
 *   commits: Array<{ sha: string, subject: string, date: string, author: string, found: boolean, raw: string }>,
 *   evidence: { valid: boolean, signals: object[], warnings: string[] } | null,
 *   warnings: string[]
 * }}
 */
function resolveChain(taskId, opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();
  const enforcerDir = opts.enforcerDir || path.join(cwd, '.plan-enforcer');
  const ledgerPath = opts.ledgerPath || path.join(enforcerDir, 'ledger.md');

  const warnings = [];
  const result = {
    taskId,
    found: false,
    ledgerPath,
    schema: 'v2',
    task: null,
    decisions: [],
    chainRefs: { decisions: [], commits: [], verifications: [], awareness: [], unknown: [] },
    commits: [],
    evidence: null,
    warnings
  };

  if (!fs.existsSync(ledgerPath)) {
    warnings.push(`Ledger not found at ${ledgerPath}`);
    return result;
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const meta = parseMetadata(ledger);
  result.schema = meta.schema;

  const tasks = parseTaskRows(ledger);
  const task = tasks.find((t) => (t.id || '').toUpperCase() === taskId.toUpperCase()) || null;
  if (!task) {
    warnings.push(`Task ${taskId} not found in ledger`);
    return result;
  }
  result.found = true;
  result.task = task;

  // Classify Chain column tokens
  for (const raw of task.chain || []) {
    const c = classifyChainToken(raw);
    if (c.kind === 'decision') result.chainRefs.decisions.push(c.value);
    else if (c.kind === 'commit') result.chainRefs.commits.push(c.value);
    else if (c.kind === 'verification') result.chainRefs.verifications.push(c.value);
    else if (c.kind === 'awareness') result.chainRefs.awareness.push(c.value);
    else result.chainRefs.unknown.push(c.raw);
  }

  // Decisions = union of chain-referenced + scope-matched
  const allDecisions = parseDecisionLog(ledger);
  result.decisions = relatedDecisions(taskId, allDecisions, result.chainRefs.decisions);

  // Resolve git commits from Chain + from any Evidence-side commit signals
  const commitShas = new Set(result.chainRefs.commits);
  for (const sha of commitShas) {
    const meta2 = resolveCommitMeta(sha, cwd);
    result.commits.push(meta2
      ? { ...meta2, raw: sha, found: true }
      : { sha, subject: '', date: '', author: '', raw: sha, found: false });
  }

  // Evidence cell → structural signals (commit / file / test / session-log)
  if (task.evidence) {
    result.evidence = validateEvidence(task.evidence, {
      projectRoot: cwd,
      enforcerDir
    });
  } else {
    result.evidence = { valid: false, signals: [], warnings: ['Evidence cell is empty'] };
  }

  return result;
}

module.exports = {
  resolveChain,
  classifyChainToken,
  relatedDecisions,
  resolveCommitMeta
};

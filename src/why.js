// Plan Enforcer — File Reverse Lookup
// Given a file path, return every Decision Log row whose Scope cell
// references the file plus every task row whose Evidence or Notes cell
// references it. Answers "why is this code here?" in one pass.
//
// Matching is deliberately permissive: a substring match against the
// normalized forward-slash path, plus a basename fallback. We would
// rather over-include one D-row than silently miss the reason.

const fs = require('fs');
const path = require('path');
const { parseTaskRows, parseDecisionLog, parseMetadata } = require('./ledger-parser');

function normalize(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * True if `cell` mentions `target` either as a substring of the
 * normalized path or as a whole-word basename match.
 * @param {string} cell
 * @param {string} target - normalized path being searched for
 * @param {string} base - basename(target)
 */
function cellMentionsFile(cell, target, base) {
  if (!cell) return false;
  const norm = normalize(cell);
  if (target && norm.includes(target)) return true;
  if (base) {
    const re = new RegExp(`(^|[^\\w/])${escapeRe(base)}([^\\w]|$)`);
    if (re.test(norm)) return true;
  }
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reverse-lookup a file path against the active ledger.
 *
 * @param {string} filePath - path the user asked about (relative or absolute)
 * @param {{ ledgerPath?: string, cwd?: string }} [opts]
 * @returns {{
 *   filePath: string,
 *   normalizedPath: string,
 *   basename: string,
 *   ledgerPath: string,
 *   schema: 'v1' | 'v2',
 *   decisions: object[],
 *   tasks: object[],
 *   warnings: string[]
 * }}
 */
function resolveWhy(filePath, opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();
  const ledgerPath = opts.ledgerPath || path.join(cwd, '.plan-enforcer', 'ledger.md');

  const warnings = [];
  const normalizedPath = normalize(filePath);
  const basename = normalizedPath ? path.posix.basename(normalizedPath) : '';

  const result = {
    filePath,
    normalizedPath,
    basename,
    ledgerPath,
    schema: 'v2',
    decisions: [],
    tasks: [],
    warnings
  };

  if (!fs.existsSync(ledgerPath)) {
    warnings.push(`Ledger not found at ${ledgerPath}`);
    return result;
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  result.schema = parseMetadata(ledger).schema;

  const decisions = parseDecisionLog(ledger);
  result.decisions = decisions.filter((d) =>
    cellMentionsFile(d.scope, normalizedPath, basename) ||
    cellMentionsFile(d.evidence, normalizedPath, basename) ||
    cellMentionsFile(d.reason, normalizedPath, basename)
  );

  const tasks = parseTaskRows(ledger);
  result.tasks = tasks.filter((t) =>
    cellMentionsFile(t.evidence, normalizedPath, basename) ||
    cellMentionsFile(t.notes, normalizedPath, basename)
  );

  if (result.decisions.length === 0 && result.tasks.length === 0) {
    warnings.push(`No ledger row references "${filePath}". The file may be planned (covered by a plan-step scope) or untracked by the ledger.`);
  }

  return result;
}

module.exports = { resolveWhy, cellMentionsFile, normalize };

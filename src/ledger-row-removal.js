// Detects T-row removals from the ledger — the tampering pattern
// observed in medium/execute-frozen-plan/native on 2026-04-15 where a
// 15-row ledger was silently compacted to 5 rows during recovery.
//
// Contract: given the before/after text of a ledger edit, return the
// set of T-IDs that disappeared without a covering `delete` or
// `unplanned` Decision Log row landing in the same edit.
//
// Pure module. No filesystem. Consumed by hooks/ledger-schema-guard.js.
// See docs/strategy/gaps/ledger-task-count-tampering.md for motivation.

const T_ROW_RE = /^\|\s*(T\d+)\s*\|/gm;
const D_ROW_RE = /^\|\s*D\d+\s*\|([^|]*)\|([^|]*)\|/gm;
const INIT_MARKER_RE = /<!--\s*created:/;

/**
 * Extract the set of T-row IDs present in a ledger text blob.
 * @param {string} text
 * @returns {Set<string>}
 */
function taskIdsIn(text) {
  const ids = new Set();
  if (typeof text !== 'string' || text.length === 0) return ids;
  T_ROW_RE.lastIndex = 0;
  let m;
  while ((m = T_ROW_RE.exec(text)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

/**
 * Extract Decision Log rows that plausibly cover a T-row removal. A
 * covering row has type in {delete, unplanned} (v2 shape) and a scope
 * cell mentioning the removed T-ID literally.
 *
 * @param {string} text
 * @returns {Array<{type: string, scope: string}>}
 */
function coverageRows(text) {
  const rows = [];
  if (typeof text !== 'string' || text.length === 0) return rows;
  D_ROW_RE.lastIndex = 0;
  let m;
  while ((m = D_ROW_RE.exec(text)) !== null) {
    const type = (m[1] || '').trim().toLowerCase();
    const scope = (m[2] || '').trim();
    if (type === 'delete' || type === 'unplanned' || type === 'deviation') {
      rows.push({ type, scope });
    }
  }
  return rows;
}

/**
 * Does the given Decision Log cover this T-ID? A row covers the ID if
 * its scope cell contains the literal token. Whole-word match (T5
 * doesn't cover T50).
 *
 * @param {string} taskId
 * @param {Array<{type: string, scope: string}>} rows
 * @returns {boolean}
 */
function isCovered(taskId, rows) {
  const re = new RegExp(`\\b${taskId}\\b`);
  return rows.some((r) => re.test(r.scope));
}

/**
 * Detect whether a ledger Edit is re-initializing the ledger from
 * scratch. Pattern: new_string contains a `<!-- created: -->` header
 * that old_string did not, or old_string is empty. In that case we
 * skip row-removal checks entirely — the row set is being reset, not
 * tampered with.
 *
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {boolean}
 */
function isInitialization(oldStr, newStr) {
  if (!oldStr || oldStr.trim().length === 0) return true;
  const oldHasHeader = INIT_MARKER_RE.test(oldStr);
  const newHasHeader = INIT_MARKER_RE.test(newStr);
  return newHasHeader && !oldHasHeader;
}

/**
 * Core detector. Given one edit (old/new text) against the ledger,
 * return the set of uncovered removed T-IDs.
 *
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {{ uncovered: string[], removed: string[] }}
 */
function detectRowRemoval(oldStr, newStr) {
  if (isInitialization(oldStr, newStr)) {
    return { uncovered: [], removed: [] };
  }
  const before = taskIdsIn(oldStr);
  const after = taskIdsIn(newStr);
  const removed = [];
  for (const id of before) {
    if (!after.has(id)) removed.push(id);
  }
  if (removed.length === 0) return { uncovered: [], removed: [] };
  const rows = coverageRows(newStr);
  const uncovered = removed.filter((id) => !isCovered(id, rows));
  return { uncovered, removed };
}

/**
 * MultiEdit-aware detector. Correlates coverage across all edits in
 * the same tool call — a D-row added in edit #2 can cover a T-row
 * removed in edit #1.
 *
 * @param {Array<{old: string, new: string}>} edits
 * @returns {{ uncovered: string[], removed: string[] }}
 */
function detectAcrossEdits(edits) {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { uncovered: [], removed: [] };
  }
  const removed = [];
  const coverage = [];
  for (const e of edits) {
    if (isInitialization(e.old, e.new)) continue;
    const before = taskIdsIn(e.old);
    const after = taskIdsIn(e.new);
    for (const id of before) {
      if (!after.has(id) && !removed.includes(id)) removed.push(id);
    }
    coverage.push(...coverageRows(e.new));
  }
  if (removed.length === 0) return { uncovered: [], removed: [] };
  const uncovered = removed.filter((id) => !isCovered(id, coverage));
  return { uncovered, removed };
}

module.exports = {
  taskIdsIn,
  coverageRows,
  isCovered,
  isInitialization,
  detectRowRemoval,
  detectAcrossEdits
};

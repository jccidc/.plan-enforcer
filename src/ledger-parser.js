// Plan Enforcer — Ledger Parser
// Extracts stats, task rows, decision log entries, and reconciliation history
// from a ledger file. Accepts both v1 and v2 schemas — v1 rows have 5 content
// cells (ID, Task, Status, Evidence, Notes); v2 adds a Chain column between
// Evidence and Notes. v1 Decision Log rows are 4-cell (ID, Task Ref, Decision,
// Reason); v2 are 5-cell (ID, Type, Scope, Reason, Evidence).

const VALID_D_TYPES = new Set(['deviation', 'unplanned', 'delete', 'pivot', 'override']);
const TASK_ID_PATTERN = 'T\\d+[A-Za-z0-9]*';

function derivePlanScope(source) {
  const normalized = String(source || '').replace(/\\/g, '/');
  const match = normalized.match(/(?:^|[\/._-])(?:phase[-_ ]*|p)(0*[1-9]\d*)(?=$|[\/._-])/i);
  if (!match) return null;
  const phaseNumber = Number.parseInt(match[1], 10);
  if (!Number.isFinite(phaseNumber) || phaseNumber < 1) return null;
  const shortLabel = `P${phaseNumber}`;
  return {
    kind: 'phase',
    shortLabel,
    description: `phase-local ${shortLabel}`
  };
}

/**
 * Split a pipe-table row into its content cells. Strips leading/trailing empty
 * cells from the split, preserves interior content.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  const parts = line.split('|').map((c) => c.trim());
  if (parts.length >= 2 && parts[0] === '') parts.shift();
  if (parts.length >= 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Parse ledger content and return structured stats.
 * @param {string} ledger - Raw ledger markdown content
 * @returns {{ counts, total, doneCount, remaining, drift, source }}
 */
function parseLedger(ledger) {
  const counts = { pending: 0, 'in-progress': 0, done: 0, verified: 0, skipped: 0, blocked: 0, superseded: 0 };
  // Status is column 3 in both v1 and v2 (ID, Task, Status, ...). Match that
  // column regardless of how many trailing cells exist.
  const re = new RegExp(`^\\|\\s*${TASK_ID_PATTERN}\\s*\\|[^|]+\\|\\s*(\\w[\\w-]*)\\s*\\|`, 'gm');
  let m;
  while ((m = re.exec(ledger)) !== null) {
    const s = m[1].trim().toLowerCase();
    if (s in counts) counts[s]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const doneCount = counts.done + counts.verified;
  const remaining = counts.pending + counts['in-progress'];

  // Drift = any D-row whose type OR reason mentions drift/unplanned. For v2
  // the type column IS the signal; for v1 we scan the free-text cells.
  let drift = 0;
  for (const entry of parseDecisionLog(ledger)) {
    if (entry.type === 'unplanned') { drift++; continue; }
    if (/\b(drift|unplanned)\b/i.test(entry.reason || '')) { drift++; }
  }

  let source = 'unknown';
  const sMatch = ledger.match(/<!-- source:\s*(.+?)\s*-->/);
  if (sMatch) source = sMatch[1];

  return { counts, total, doneCount, remaining, drift, source };
}

/**
 * Extract task rows from ledger. Handles both v1 (5 content cells) and v2
 * (6 cells with Chain between Evidence and Notes).
 * @param {string} ledger
 * @returns {Array<{id: string, name: string, status: string, evidence: string, chain: string[], notes: string}>}
 */
function parseTaskRows(ledger) {
  const rows = [];
  const taskLines = (ledger.match(new RegExp(`^\\|\\s*${TASK_ID_PATTERN}\\s*\\|.+$`, 'gm')) || []);
  for (const line of taskLines) {
    const cells = splitRow(line);
    // v1: [id, name, status, evidence, notes]
    // v2: [id, name, status, evidence, chain, notes]
    if (cells.length < 5) continue;

    const id = cells[0];
    const name = cells[1];
    const status = cells[2].toLowerCase();
    const evidence = cells[3] || '';

    let chain = [];
    let notes = '';
    if (cells.length >= 6) {
      chain = parseChainCell(cells[4]);
      notes = cells[5] || '';
    } else {
      notes = cells[4] || '';
    }

    rows.push({ id, name, status, evidence, chain, notes });
  }
  return rows;
}

/**
 * Split a Chain cell into its references. Examples:
 *   "D1, C:a1b2c3d, V1" -> ["D1", "C:a1b2c3d", "V1"]
 *   ""                   -> []
 * @param {string} cell
 * @returns {string[]}
 */
function parseChainCell(cell) {
  if (!cell) return [];
  const raw = cell.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  let previousWasAwareness = false;
  for (const token of raw) {
    if (/^A:(I\d+|R\d+)$/i.test(token)) {
      out.push(`A:${token.slice(2).toUpperCase()}`);
      previousWasAwareness = true;
      continue;
    }
    if (previousWasAwareness && /^(I\d+|R\d+)$/i.test(token)) {
      out.push(`A:${token.toUpperCase()}`);
      previousWasAwareness = true;
      continue;
    }
    out.push(token);
    previousWasAwareness = false;
  }
  return out;
}

/**
 * Extract decision log entries, schema-aware.
 *
 * v1 row: | ID | Task Ref | Decision | Reason |
 * v2 row: | ID | Type | Scope | Reason | Evidence |
 *
 * Return shape is the v2 structured form. v1 rows are mapped:
 *   - type: inferred from Decision+Reason (deviation if unclear)
 *   - scope: Task Ref
 *   - reason: "Decision: Reason" folded
 *   - evidence: empty
 *
 * @param {string} ledger
 * @returns {Array<{id: string, type: string, scope: string, reason: string, evidence: string, cols: string[]}>}
 */
function parseDecisionLog(ledger) {
  const entries = [];
  const lines = ledger.match(/^\|\s*D\d+\s*\|.+$/gm) || [];
  for (const line of lines) {
    const cells = splitRow(line);
    // cells[0] = ID
    let type, scope, reason, evidence;
    if (cells.length >= 5 && VALID_D_TYPES.has(cells[1].toLowerCase())) {
      // v2 shape
      type = cells[1].toLowerCase();
      scope = cells[2] || '';
      reason = cells[3] || '';
      evidence = cells[4] || '';
    } else {
      // v1 shape — infer
      const decision = cells[2] || '';
      const reasonCell = cells[3] || '';
      reason = decision && reasonCell ? `${decision}: ${reasonCell}` : (decision || reasonCell);
      scope = cells[1] || '';
      type = inferDecisionType(`${decision} ${reasonCell}`.trim());
      evidence = '';
    }
    entries.push({ id: cells[0], type, scope, reason, evidence, cols: cells });
  }
  return entries;
}

/**
 * Mirror of schema-migrate.inferType. Duplicated here so ledger-parser has no
 * dependency on schema-migrate (simpler load order, smaller surface).
 * @param {string} text
 * @returns {string}
 */
function inferDecisionType(text) {
  const r = (text || '').toLowerCase();
  if (/\b(delete|deleted|remove|removed|drop|dropped|rm\b|rm -)/.test(r)) return 'delete';
  if (/\b(unplanned|not in the plan|added.*(?:not|wasn'?t))/.test(r)) return 'unplanned';
  if (/\b(pivot|jumped to|switched to task|out of order)/.test(r)) return 'pivot';
  if (/\b(override|bypass|bypassed|force)/.test(r)) return 'override';
  return 'deviation';
}

/**
 * Extract reconciliation history entries. Shape unchanged v1 -> v2.
 * @param {string} ledger
 * @returns {Array<{id: string, cols: string[]}>}
 */
function parseReconciliationHistory(ledger) {
  const entries = [];
  const lines = ledger.match(/^\|\s*R\d+\s*\|.+$/gm) || [];
  for (const line of lines) {
    const cells = splitRow(line);
    entries.push({ id: cells[0], cols: cells });
  }
  return entries;
}

/**
 * Extract metadata comments from ledger. Adds schema version detection.
 * @param {string} ledger
 * @returns {{ source: string, tier: string, created: string, schema: 'v1' | 'v2' }}
 */
function parseMetadata(ledger) {
  const source = (ledger.match(/<!-- source:\s*(.+?)\s*-->/) || [])[1] || 'unknown';
  const tier = (ledger.match(/<!-- tier:\s*(.+?)\s*-->/) || [])[1] || 'unknown';
  const created = (ledger.match(/<!-- created:\s*(.+?)\s*-->/) || [])[1] || 'unknown';
  const schema = ledger.includes('<!-- schema: v2 -->') ? 'v2' : 'v1';
  const scope = derivePlanScope(source);
  return { source, tier, created, schema, scope };
}

function formatStatusReport(ledger) {
  const stats = parseLedger(ledger);
  const meta = parseMetadata(ledger);
  const rows = parseTaskRows(ledger);
  const current = rows.find((row) => row.status === 'in-progress' || row.status === 'pending') || null;
  const unverified = rows.filter((row) => row.status === 'done' && !row.evidence);
  const blocked = rows.filter((row) => row.status === 'blocked');

  const lines = [
    '---🛡 Plan Enforcer Status ---------------------------',
    ` ${stats.doneCount}/${stats.total} tasks  |  ${stats.counts.verified} verified  |  ${stats.counts.skipped + stats.counts.superseded} skipped  |  ${stats.counts.blocked} blocked`,
    ...(meta.scope ? [` Scope: ${meta.scope.description}  |  Source: ${meta.source}`] : []),
    ` Tier: ${meta.tier}  |  Drift: ${stats.drift}  |  Current: ${current ? current.id : 'none'}`,
    '-----------------------------------------------------'
  ];

  if (current) {
    lines.push('', `Current Task: ${current.id} - ${current.name}`);
  }

  if (unverified.length > 0) {
    lines.push('', 'Unverified (done but no evidence):');
    unverified.forEach((row) => {
      lines.push(`  ${row.id} - ${row.name}${row.notes ? ` (${row.notes})` : ''}`);
    });
  }

  if (blocked.length > 0) {
    lines.push('', 'Blocked:');
    blocked.forEach((row) => {
      lines.push(`  ${row.id} - ${row.name}${row.notes ? ` (${row.notes})` : ''}`);
    });
  }

  lines.push('-----------------------------------------------------');
  return lines.join('\n');
}

function formatLogsReport(ledger) {
  const rows = parseTaskRows(ledger);
  const decisions = parseDecisionLog(ledger);
  const reconciliations = parseReconciliationHistory(ledger);
  const skipped = rows.filter((row) => row.status === 'skipped' || row.status === 'superseded');
  const unverified = rows.filter((row) => row.status === 'done' && !row.evidence);
  // v2 drift signal: type column IS unplanned. v1 fallback: scan reason text.
  const driftEvents = decisions.filter((entry) =>
    entry.type === 'unplanned' || /\b(drift|unplanned)\b/i.test(entry.reason || '')
  );

  const lines = ['---🛡 Plan Enforcer Logs -----------------------------'];

  if (skipped.length > 0) {
    lines.push('', 'SKIPPED TASKS:');
    skipped.forEach((row) => {
      lines.push(`  ${row.id}  ${row.name}${row.notes ? ` - ${row.notes}` : ''}`);
    });
  }

  if (driftEvents.length > 0) {
    lines.push('', 'DRIFT EVENTS:');
    driftEvents.forEach((entry) => {
      lines.push(`  ${entry.id}  ${entry.scope} - ${entry.reason}`);
    });
  }

  if (decisions.length > 0) {
    lines.push('', 'DECISION LOG:');
    decisions.forEach((entry) => {
      lines.push(`  ${entry.id}  [${entry.type}]  ${entry.scope} - ${entry.reason}`);
    });
  }

  if (reconciliations.length > 0) {
    lines.push('', 'RECONCILIATION HISTORY:');
    reconciliations.forEach((entry) => {
      lines.push(`  ${entry.id}  ${(entry.cols[1] || '').trim()}  ${(entry.cols[2] || '').trim()} gaps  ${(entry.cols[3] || '').trim()}`);
    });
  }

  if (unverified.length > 0) {
    lines.push('', 'UNVERIFIED (done but no evidence):');
    unverified.forEach((row) => {
      lines.push(`  ${row.id}  ${row.name}${row.notes ? ` - ${row.notes}` : ''}`);
    });
  }

  if (lines.length === 1) {
    lines.push('', 'No audit entries found.');
  }

  lines.push('---------------------------------------------------------');
  return lines.join('\n');
}

module.exports = {
  derivePlanScope,
  VALID_D_TYPES,
  formatLogsReport,
  formatStatusReport,
  inferDecisionType,
  parseChainCell,
  parseDecisionLog,
  parseLedger,
  parseMetadata,
  parseReconciliationHistory,
  parseTaskRows,
  splitRow
};

// Plan Enforcer — Schema Migration (v1 -> v2)
//
// Non-destructive in-place upgrade from schema v1 (Task Ledger with
// | ID | Task | Status | Evidence | Notes |, untyped Decision Log) to
// schema v2 (adds | Chain | between Evidence and Notes; adds | Type |
// to Decision Log rows).
//
// Rules:
// - Idempotent. Running on a v2 ledger is a no-op.
// - Never destructive. On parse failure, original is left intact and
//   a migration log is returned to the caller.
// - Detects v1 by the absence of the schema marker AND by the shape
//   of the Task Ledger header row.
// - Called once per session on first new-hook activation.

const fs = require('fs');

const SCHEMA_MARKER = '<!-- schema: v2 -->';

const TASK_HEADER_V2 = '| ID  | Task                                     | Status  | Evidence | Chain | Notes |';
const TASK_SEP_V2    = '|-----|------------------------------------------|---------|----------|-------|-------|';

const DLOG_HEADER_V2 = '| ID | Type      | Scope | Reason | Evidence |';
const DLOG_SEP_V2    = '|----|-----------|-------|--------|----------|';

const VALID_TYPES = new Set(['deviation', 'unplanned', 'delete', 'pivot', 'override']);

/**
 * Detect ledger schema version from content.
 * @param {string} content
 * @returns {'v1' | 'v2' | 'unknown'}
 */
function detectVersion(content) {
  if (content.includes(SCHEMA_MARKER)) return 'v2';

  // Look at Task Ledger header row: v2 has a "Chain" column between
  // Evidence and Notes; v1 does not.
  const headerMatch = content.match(/^\|\s*ID\s*\|.*\|\s*Status\s*\|.*\|\s*Notes\s*\|$/m);
  if (!headerMatch) return 'unknown';

  const headerCells = headerMatch[0].split('|').map((c) => c.trim()).filter(Boolean);
  if (headerCells.includes('Chain')) return 'v2';
  return 'v1';
}

/**
 * Infer a Decision Log type from the reason text when migrating v1 rows.
 * Best-effort only — callers should not rely on these being perfect.
 * Defaults to 'deviation' which is the least-specific typed label.
 * @param {string} reason
 * @returns {'deviation' | 'unplanned' | 'delete' | 'pivot' | 'override'}
 */
function inferType(reason) {
  const r = (reason || '').toLowerCase();
  if (/\b(delete|deleted|remove|removed|drop|dropped|rm\b|rm -)/.test(r)) return 'delete';
  if (/\b(unplanned|not in the plan|added.*(?:not|wasn'?t))/.test(r)) return 'unplanned';
  if (/\b(pivot|jumped to|switched to task|out of order)/.test(r)) return 'pivot';
  if (/\b(override|bypass|bypassed|force)/.test(r)) return 'override';
  return 'deviation';
}

/**
 * Migrate the Task Ledger section by inserting a Chain column between
 * Evidence and Notes.
 * @param {string} content
 * @returns {string}
 */
function migrateTaskLedger(content) {
  const lines = content.split(/\r?\n/);
  const result = [];
  let inTaskLedger = false;
  let seenHeader = false;
  let seenSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^##\s*Task Ledger/i.test(line)) {
      inTaskLedger = true;
      seenHeader = false;
      seenSeparator = false;
      result.push(line);
      continue;
    }

    if (inTaskLedger && /^##\s/.test(line)) {
      // Left the Task Ledger section
      inTaskLedger = false;
      result.push(line);
      continue;
    }

    if (!inTaskLedger) {
      result.push(line);
      continue;
    }

    // Inside Task Ledger. Header row first, then separator, then task rows.
    if (!seenHeader && /^\|\s*ID\s*\|/.test(line)) {
      // Insert Chain between Evidence and Notes
      result.push(insertColumnBeforeNotes(line, 'Chain'));
      seenHeader = true;
      continue;
    }
    if (seenHeader && !seenSeparator && /^\|[\s-:]+\|/.test(line)) {
      result.push(insertColumnBeforeNotes(line, '-------'));
      seenSeparator = true;
      continue;
    }
    if (seenHeader && seenSeparator && /^\|\s*T\d+[A-Za-z0-9]*\s*\|/.test(line)) {
      // Task row
      result.push(insertColumnBeforeNotes(line, ''));
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Insert a new column value between the "Evidence" column and the final
 * "Notes" column in a pipe-table row. Works on header, separator, and
 * data rows alike (header keeps label, separator keeps dashes, data
 * keeps cell content).
 *
 * A row is split on `|` yielding leading-empty, cells..., trailing-empty.
 * We insert before the last content cell (the Notes cell).
 *
 * @param {string} line
 * @param {string} insertCell
 * @returns {string}
 */
function insertColumnBeforeNotes(line, insertCell) {
  const parts = line.split('|');
  if (parts.length < 3) return line;

  // parts = ['', ' id ', ' task ', ' status ', ' evidence ', ' notes ', '']
  // Insert a cell before the last content cell.
  const contentCellCount = parts.length - 2; // subtract leading + trailing empties
  if (contentCellCount < 4) return line; // malformed, don't touch

  // Heuristic: the sanitized width for Chain column mirrors the shape of the
  // cell we're about to displace. Use a fixed 7-char placeholder for
  // separator rows, otherwise pad to a consistent visual width.
  const isSeparator = /^[-:\s]+$/.test(insertCell);
  let chainCell;
  if (isSeparator) {
    chainCell = '-------';
  } else if (insertCell === '') {
    chainCell = '       ';
  } else {
    // Pad label to match header column width (7 chars)
    chainCell = insertCell.padEnd(7);
  }

  // parts[parts.length - 2] is the Notes cell; insert chainCell before it.
  parts.splice(parts.length - 2, 0, ' ' + chainCell + ' ');
  return parts.join('|');
}

/**
 * Migrate the Decision Log section from v1 shape to v2 shape.
 *
 * v1: | ID | Task Ref | Decision          | Reason |
 * v2: | ID | Type     | Scope (=Task Ref) | Reason (=Decision + Reason) | Evidence |
 *
 * Semantic transform, not just insertion: Decision and Reason cells
 * collapse into a single richer Reason cell; Evidence starts empty.
 * Task Ref becomes Scope (rename only).
 *
 * @param {string} content
 * @returns {string}
 */
function migrateDecisionLog(content) {
  const lines = content.split(/\r?\n/);
  const result = [];
  let inDLog = false;
  let seenHeader = false;
  let seenSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^##\s*Decision Log/i.test(line)) {
      inDLog = true;
      seenHeader = false;
      seenSeparator = false;
      result.push(line);
      continue;
    }

    if (inDLog && /^##\s/.test(line)) {
      inDLog = false;
      result.push(line);
      continue;
    }

    if (!inDLog) {
      result.push(line);
      continue;
    }

    // Replace v1 header with v2 header.
    if (!seenHeader && /^\|\s*ID\s*\|/.test(line)) {
      result.push('| ID | Type      | Scope | Reason | Evidence |');
      seenHeader = true;
      continue;
    }
    // Replace v1 separator with v2 separator.
    if (seenHeader && !seenSeparator && /^\|[\s-:]+\|/.test(line)) {
      result.push('|----|-----------|-------|--------|----------|');
      seenSeparator = true;
      continue;
    }
    // Transform v1 data row into v2 shape.
    if (seenHeader && seenSeparator && /^\|\s*D\d+\s*\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim());
      // cells = ['', 'Dn', 'Task Ref', 'Decision', 'Reason', '']
      const id = cells[1] || '';
      const scope = cells[2] || '';
      const decision = cells[3] || '';
      const reason = cells[4] || '';
      const type = inferType(`${decision} ${reason}`.trim());
      // Fold Decision + Reason into one richer Reason cell, keep Evidence blank.
      const foldedReason = decision && reason
        ? `${decision}: ${reason}`
        : (decision || reason);
      result.push(`| ${id} | ${type.padEnd(9)} | ${scope} | ${foldedReason} |  |`);
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Add the schema:v2 marker near the top of the file, after the title and
 * any existing HTML comments.
 * @param {string} content
 * @returns {string}
 */
function addSchemaMarker(content) {
  if (content.includes(SCHEMA_MARKER)) return content;

  const lines = content.split(/\r?\n/);
  // Find insertion point: after the last leading HTML comment block.
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^<!--.*-->$/.test(lines[i].trim())) {
      insertAt = i + 1;
      continue;
    }
    if (lines[i].trim() === '' && insertAt > 0) continue;
    break;
  }

  lines.splice(insertAt, 0, SCHEMA_MARKER);
  return lines.join('\n');
}

/**
 * Perform a full v1 -> v2 migration on a ledger content string.
 * @param {string} content
 * @returns {{ migrated: string, version: 'v1' | 'v2' | 'unknown', changed: boolean, warnings: string[] }}
 */
function migrate(content) {
  const warnings = [];
  const version = detectVersion(content);

  if (version === 'v2') {
    return { migrated: content, version, changed: false, warnings };
  }

  if (version === 'unknown') {
    warnings.push('Could not detect ledger schema; leaving file unchanged.');
    return { migrated: content, version, changed: false, warnings };
  }

  // v1 -> v2
  let out = content;
  try {
    out = migrateTaskLedger(out);
    out = migrateDecisionLog(out);
    out = addSchemaMarker(out);
  } catch (e) {
    warnings.push(`Migration failed mid-flight: ${e.message}. Reverting.`);
    return { migrated: content, version: 'v1', changed: false, warnings };
  }

  return { migrated: out, version: 'v1', changed: true, warnings };
}

/**
 * Migrate a ledger file in place. Non-destructive: on any error or
 * already-v2 content, the file is untouched. Returns a result object
 * the caller can log.
 *
 * @param {string} ledgerPath
 * @returns {{ path: string, version: 'v1' | 'v2' | 'unknown', changed: boolean, warnings: string[] }}
 */
function migrateFile(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return { path: ledgerPath, version: 'unknown', changed: false, warnings: [`Ledger not found: ${ledgerPath}`] };
  }

  const original = fs.readFileSync(ledgerPath, 'utf8');
  const result = migrate(original);

  if (result.changed) {
    // Backup before write. Safety net in case the result parses poorly.
    try {
      fs.writeFileSync(`${ledgerPath}.bak`, original);
      fs.writeFileSync(ledgerPath, result.migrated);
    } catch (e) {
      result.warnings.push(`Write failed: ${e.message}`);
      result.changed = false;
    }
  }

  return { path: ledgerPath, version: result.version, changed: result.changed, warnings: result.warnings };
}

module.exports = {
  SCHEMA_MARKER,
  VALID_TYPES,
  detectVersion,
  inferType,
  migrate,
  migrateFile
};

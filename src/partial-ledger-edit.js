// Detects when an Edit on the ledger is "partial" — a completion
// transition (in-progress -> verified|done) that lands without the
// matching scoreboard bump or evidence content.
//
// Motivation: docs/strategy/gaps/protocol-overhead-bookkeeping-burn.md
// — first-pass sessions burn 53-59% of tool calls on sequential
// ledger edits (status-flip, then scoreboard, then evidence as
// separate Edits). Consolidating into one Edit per task is the
// priority lever. The hook guidance already says "ONE atomic Edit
// ... status + evidence + scoreboard". This detector catches the
// cases where the model ignored that guidance.
//
// Returns { partial: boolean, reason: string | null }. Non-blocking;
// post-tool.js consumes the reason string as an advisory nudge.

const FORWARD_COMPLETIONS = new Set([
  'in-progress->verified',
  'in-progress->done',
  'done->verified'
]);

function extractEdits(toolContext) {
  if (!toolContext || !toolContext.tool_input) return [];
  const input = toolContext.tool_input;
  if (toolContext.tool_name === 'Edit') {
    if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') return [];
    return [{ old: input.old_string, new: input.new_string }];
  }
  if (toolContext.tool_name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits
      .filter((e) => typeof e.old_string === 'string' && typeof e.new_string === 'string')
      .map((e) => ({ old: e.old_string, new: e.new_string }));
  }
  return [];
}

// Parses a task row string like "| T3 | Name | verified | evidence | ... |"
// and returns { id, status, evidence } or null if it doesn't match.
function parseTaskRow(line) {
  const trimmed = line.trim();
  if (!/^\|\s*T\d+\s*\|/.test(trimmed)) return null;
  const cells = trimmed.split('|').map((c) => c.trim());
  // cells[0] = '', cells[1] = id, cells[2] = task name, cells[3] = status,
  // cells[4] = evidence, cells[5] = chain, cells[6] = notes, cells[7] = ''
  if (cells.length < 5) return null;
  return {
    id: cells[1],
    status: (cells[3] || '').toLowerCase().replace(/\s*\(.*$/, '').trim(),
    evidence: cells[4] || ''
  };
}

function findTaskRow(text, taskId) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const row = parseTaskRow(line);
    if (row && row.id === taskId) return row;
  }
  return null;
}

// Returns set of task IDs whose status changed between old and new strings,
// and their transitions keyed by id.
function statusTransitions(oldStr, newStr) {
  const transitions = {};
  const lines = newStr.split(/\r?\n/);
  for (const line of lines) {
    const row = parseTaskRow(line);
    if (!row) continue;
    const priorRow = findTaskRow(oldStr, row.id);
    if (priorRow && priorRow.status !== row.status) {
      transitions[row.id] = {
        from: priorRow.status,
        to: row.status,
        newEvidence: row.evidence,
        priorEvidence: priorRow.evidence
      };
    }
  }
  return transitions;
}

function isForwardCompletion(transition) {
  return FORWARD_COMPLETIONS.has(`${transition.from}->${transition.to}`);
}

// Does either the old or new text chunk include the scoreboard line that
// typically looks like "<n> total | <n> done | <n> verified | ...".
function touchesScoreboard(oldStr, newStr) {
  const scoreboardRe = /\btotal\b[\s|]+.*\b(done|verified|remaining)\b/i;
  const inOld = scoreboardRe.test(oldStr);
  const inNew = scoreboardRe.test(newStr);
  if (!inOld && !inNew) return false;
  // Both present + identical → the scoreboard was included in context
  // but not actually modified. Treat as "not touched" for nudge purposes.
  if (inOld && inNew) {
    const oldMatch = oldStr.match(scoreboardRe);
    const newMatch = newStr.match(scoreboardRe);
    if (oldMatch && newMatch && oldMatch[0] === newMatch[0]) return false;
  }
  return true;
}

function touchesReconciliation(oldStr, newStr) {
  const rRowRe = /^\s*\|\s*R\d+\s*\|/m;
  return rRowRe.test(newStr) && !rRowRe.test(oldStr);
}

function evidenceAdded(transition) {
  const prior = (transition.priorEvidence || '').trim();
  const next = (transition.newEvidence || '').trim();
  return next.length > prior.length + 5; // allow minor whitespace; require real growth
}

function detectPartialLedgerEdit(toolContext) {
  const edits = extractEdits(toolContext);
  if (edits.length === 0) return { partial: false, reason: null };

  for (const edit of edits) {
    const transitions = statusTransitions(edit.old, edit.new);
    const ids = Object.keys(transitions);
    if (ids.length === 0) continue;

    // Only nudge on forward completion transitions (in-progress -> done/verified).
    // Claim transitions (pending -> in-progress) are legitimately their own step.
    const completions = ids.filter((id) => isForwardCompletion(transitions[id]));
    if (completions.length === 0) continue;

    // Narrowed 2026-04-15 after observability rerun: we previously also
    // flagged missing-scoreboard completions, but 5/5 fires in the
    // measured run were scoreboard-only — the model consolidates status
    // + evidence atomically, then updates the scoreboard as a separate
    // edit because the scoreboard lives far from the task row in the
    // file layout. That's architecture, not laziness. Nudging on it
    // trains the model to distrust hook output broadly. The
    // audit-critical property is "no status-flip to verified without
    // evidence" — keep that alarm, drop the cosmetic one.
    for (const id of completions) {
      const t = transitions[id];
      if (evidenceAdded(t)) continue;
      return {
        partial: true,
        reason: `${id} ${t.from}->${t.to} without evidence in the same Edit`
      };
    }
  }
  return { partial: false, reason: null };
}

module.exports = {
  detectPartialLedgerEdit,
  // exported for tests
  parseTaskRow,
  statusTransitions,
  touchesScoreboard,
  touchesReconciliation
};

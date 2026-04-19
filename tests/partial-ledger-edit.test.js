const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectPartialLedgerEdit } = require('../src/partial-ledger-edit');

const taskRow = (id, status, evidence = '') =>
  `| ${id} | Task ${id} | ${status} | ${evidence} |       |       |`;

const scoreboard = (done, verified, remaining) =>
  ` 15 total  |  ${done} done  |  ${verified} verified  |  0 skipped  |  0 blocked  |  ${remaining} remaining`;

function makeLedger({ tRows = [], scoreboardLine = scoreboard(0, 0, 15), rRows = [] } = {}) {
  return [
    '## Scoreboard',
    scoreboardLine,
    '',
    '## Task Ledger',
    '| ID  | Task | Status | Evidence | Chain | Notes |',
    '|-----|------|--------|----------|-------|-------|',
    ...tRows,
    '',
    '## Reconciliation History',
    '| Round | Tasks | Gaps | Action |',
    '|-------|-------|------|--------|',
    ...rRows
  ].join('\n');
}

function editContext({ old_string, new_string }) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: '.plan-enforcer/ledger.md', old_string, new_string }
  };
}

describe('detectPartialLedgerEdit', () => {
  it('is not partial for pending -> in-progress claim transitions', () => {
    const oldLedger = makeLedger({ tRows: [taskRow('T3', 'pending')] });
    const newLedger = makeLedger({ tRows: [taskRow('T3', 'in-progress')] });
    const result = detectPartialLedgerEdit(editContext({
      old_string: oldLedger, new_string: newLedger
    }));
    assert.equal(result.partial, false);
  });

  it('flags in-progress -> verified without evidence (audit-critical)', () => {
    const oldLedger = makeLedger({
      tRows: [taskRow('T3', 'in-progress')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const newLedger = makeLedger({
      tRows: [taskRow('T3', 'verified')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const result = detectPartialLedgerEdit(editContext({
      old_string: oldLedger, new_string: newLedger
    }));
    assert.equal(result.partial, true);
    assert.match(result.reason, /T3/);
    assert.match(result.reason, /evidence/);
  });

  it('accepts a consolidated completion with evidence + scoreboard', () => {
    const oldLedger = makeLedger({
      tRows: [taskRow('T3', 'in-progress')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const newLedger = makeLedger({
      tRows: [taskRow('T3', 'verified', 'tsc clean; 9/9 tests pass; src/routes/auth.ts POST /register')],
      scoreboardLine: scoreboard(0, 3, 12)
    });
    const result = detectPartialLedgerEdit(editContext({
      old_string: oldLedger, new_string: newLedger
    }));
    assert.equal(result.partial, false, `unexpected partial: ${result.reason}`);
  });

  it('does NOT flag status+evidence without scoreboard (scoreboard lives far from task row, acceptable separation)', () => {
    const oldLedger = makeLedger({
      tRows: [taskRow('T3', 'in-progress')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const newLedger = makeLedger({
      tRows: [taskRow('T3', 'verified', 'tsc clean; tests pass; routes wired')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const result = detectPartialLedgerEdit(editContext({
      old_string: oldLedger, new_string: newLedger
    }));
    assert.equal(result.partial, false, `unexpected partial: ${result.reason}`);
  });

  it('flags status + scoreboard without evidence', () => {
    const oldLedger = makeLedger({
      tRows: [taskRow('T3', 'in-progress')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const newLedger = makeLedger({
      tRows: [taskRow('T3', 'verified')],
      scoreboardLine: scoreboard(0, 3, 12)
    });
    const result = detectPartialLedgerEdit(editContext({
      old_string: oldLedger, new_string: newLedger
    }));
    assert.equal(result.partial, true);
    assert.match(result.reason, /evidence/);
  });

  it('returns non-partial for non-ledger tools', () => {
    const result = detectPartialLedgerEdit({
      tool_name: 'Bash',
      tool_input: { command: 'ls' }
    });
    assert.equal(result.partial, false);
  });

  it('returns non-partial for malformed input', () => {
    assert.equal(detectPartialLedgerEdit(null).partial, false);
    assert.equal(detectPartialLedgerEdit({}).partial, false);
    assert.equal(
      detectPartialLedgerEdit({ tool_name: 'Edit', tool_input: {} }).partial,
      false
    );
  });

  it('handles MultiEdit with mixed partial + consolidated edits', () => {
    const oldLedger = makeLedger({
      tRows: [taskRow('T3', 'in-progress'), taskRow('T4', 'pending')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const newLedger = makeLedger({
      tRows: [taskRow('T3', 'verified'), taskRow('T4', 'in-progress')],
      scoreboardLine: scoreboard(0, 2, 13)
    });
    const result = detectPartialLedgerEdit({
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: '.plan-enforcer/ledger.md',
        edits: [{ old_string: oldLedger, new_string: newLedger }]
      }
    });
    assert.equal(result.partial, true);
    assert.match(result.reason, /T3/);
  });

  it('does not flag backward edits (typo fixes on already-verified rows)', () => {
    const oldLedger = makeLedger({
      tRows: [taskRow('T3', 'verified', 'tsc clean; testz pass')]
    });
    const newLedger = makeLedger({
      tRows: [taskRow('T3', 'verified', 'tsc clean; tests pass')]
    });
    const result = detectPartialLedgerEdit(editContext({
      old_string: oldLedger, new_string: newLedger
    }));
    assert.equal(result.partial, false);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { inferStatuslineState } = require('../src/statusline-state');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-statusline-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }, null, 2));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer, { recursive: true });
  return { dir, enforcer };
}

function writeState(enforcer, state) {
  fs.writeFileSync(path.join(enforcer, 'statusline-state.json'), JSON.stringify(state), 'utf8');
}

function writeDiscuss(enforcer, body) {
  fs.writeFileSync(path.join(enforcer, 'discuss.md'), body || '# test discuss\n', 'utf8');
}

function writeLedger(enforcer) {
  const ledger = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/demo.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
| T1 | work | pending |  |  |  |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger, 'utf8');
}

function writeLedgerRows(enforcer, rows) {
  const rowLines = rows.map((r) => `| ${r.id} | ${r.name || 'work'} | ${r.status} | ${r.evidence || ''} |  |  |`).join('\n');
  const ledger = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/demo.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
${rowLines}

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger, 'utf8');
}

describe('inferStatuslineState witness requirement', () => {
  it('returns null when statusline-state.json has a stale stage and no ledger/discuss exist', () => {
    const { dir, enforcer } = mkProject();
    writeState(enforcer, { label: '1-DISCUSS', sessionId: 'any', updatedAt: new Date().toISOString() });
    const state = inferStatuslineState({ cwd: dir, sessionId: 'any' });
    assert.equal(state, null, 'stale statusline-state should not render without a ledger or discuss packet');
  });

  it('returns the stage when a discuss packet witnesses authorship work', () => {
    const { dir, enforcer } = mkProject();
    writeDiscuss(enforcer);
    writeState(enforcer, { label: '1-DISCUSS', sessionId: 'sess1', updatedAt: new Date().toISOString() });
    const state = inferStatuslineState({ cwd: dir, sessionId: 'sess1' });
    assert.ok(state, 'should render a state when discuss packet exists');
    assert.equal(String(state.label).toUpperCase(), '1-DISCUSS');
  });

  it('returns a derived state when a ledger exists (no statusline-state.json needed)', () => {
    const { dir, enforcer } = mkProject();
    writeLedger(enforcer);
    const state = inferStatuslineState({ cwd: dir, sessionId: 'sess1' });
    assert.ok(state, 'should render a state when ledger exists');
  });

  it('returns null when discuss packet was deleted but statusline-state.json remained', () => {
    const { dir, enforcer } = mkProject();
    writeDiscuss(enforcer);
    writeState(enforcer, { label: '1-DISCUSS', sessionId: 'sess1', updatedAt: new Date().toISOString() });
    // Simulate "abandon refused + orphan cleanup option 2" path: discuss deleted, state file remains.
    fs.unlinkSync(path.join(enforcer, 'discuss.md'));
    const state = inferStatuslineState({ cwd: dir, sessionId: 'sess1' });
    assert.equal(state, null, 'stage should clear once discuss packet is gone');
  });
});

describe('closed-ledger witness handling (v0.1.4)', () => {
  it('(a) all-verified ledger with no discuss packet returns null', () => {
    const { dir, enforcer } = mkProject();
    writeLedgerRows(enforcer, [
      { id: 'T1', status: 'verified', evidence: 'ok' },
      { id: 'T2', status: 'verified', evidence: 'ok' }
    ]);
    const state = inferStatuslineState({ cwd: dir, sessionId: 'x' });
    assert.equal(state, null, 'closed ledger with no discuss witness should not render a progress tag');
  });

  it('(b) all-verified ledger alongside discuss packet falls through to authorship state', () => {
    const { dir, enforcer } = mkProject();
    writeLedgerRows(enforcer, [
      { id: 'T1', status: 'verified', evidence: 'ok' }
    ]);
    writeDiscuss(enforcer);
    const state = inferStatuslineState({ cwd: dir, sessionId: 'sess1' });
    assert.ok(state, 'authorship witness should win over closed ledger');
    assert.equal(String(state.label).toUpperCase(), '1-DISCUSS');
  });

  it('(c) all-terminal with a blocked row still returns null (blocked is terminal)', () => {
    const { dir, enforcer } = mkProject();
    writeLedgerRows(enforcer, [
      { id: 'T1', status: 'verified', evidence: 'ok' },
      { id: 'T2', status: 'blocked', evidence: 'waiting on X' }
    ]);
    const state = inferStatuslineState({ cwd: dir, sessionId: 'x' });
    assert.equal(state, null, 'blocked must count as terminal for the closed-ledger check');
  });

  it('(d) ledger of only superseded rows returns null (HC2 edge)', () => {
    const { dir, enforcer } = mkProject();
    writeLedgerRows(enforcer, [
      { id: 'T1', status: 'superseded', evidence: 'abandoned: ...' },
      { id: 'T2', status: 'superseded', evidence: 'abandoned: ...' }
    ]);
    const state = inferStatuslineState({ cwd: dir, sessionId: 'x' });
    assert.equal(state, null, 'all-superseded rows leave zero active rows; should not render');
  });

  it('(e) ledger with at least one pending row still returns an active derived state', () => {
    const { dir, enforcer } = mkProject();
    writeLedgerRows(enforcer, [
      { id: 'T1', status: 'verified', evidence: 'ok' },
      { id: 'T2', status: 'pending', evidence: '' }
    ]);
    const state = inferStatuslineState({ cwd: dir, sessionId: 'x' });
    assert.ok(state, 'open plan should still render a progress tag');
    assert.equal(state.stage, 'tasks');
    assert.equal(state.total, 2);
  });

  it('(f) closed ledger + stored 3-EXECUTE label: derived state wins, not the stale label', () => {
    const { dir, enforcer } = mkProject();
    writeLedgerRows(enforcer, [
      { id: 'T1', status: 'verified', evidence: 'ok' }
    ]);
    writeState(enforcer, { label: '3-EXECUTE', sessionId: 'sess1', updatedAt: new Date().toISOString() });
    const state = inferStatuslineState({ cwd: dir, sessionId: 'sess1' });
    // No discuss packet: closed ledger falls through, no witness, should be null.
    assert.equal(state, null, 'closed-ledger fallthrough should not re-enable the stale stored label path');
  });
});

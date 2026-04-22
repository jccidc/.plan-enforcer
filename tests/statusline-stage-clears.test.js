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

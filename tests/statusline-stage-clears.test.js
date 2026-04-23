const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inferStatuslineState,
  captureStatuslineSessionBridge,
  isPlanEnforcerStateDir,
  isInside,
  STATUSLINE_SESSION_BRIDGE
} = require('../src/statusline-state');

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

describe('cross-project isolation (v0.1.5)', () => {
  function clearBridge() {
    try { fs.unlinkSync(STATUSLINE_SESSION_BRIDGE); } catch (_e) {}
  }

  it('isPlanEnforcerStateDir: rejects a .plan-enforcer directory with no state artifacts (bare repo dir)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-bare-'));
    assert.equal(isPlanEnforcerStateDir(dir), false, 'empty dir must not count as a state dir');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    assert.equal(isPlanEnforcerStateDir(dir), false, 'repo-shaped dir without plan-enforcer artifacts must not count');
    fs.writeFileSync(path.join(dir, 'config.md'), 'tier: structural\n');
    assert.equal(isPlanEnforcerStateDir(dir), true, 'once config.md exists, counts as a state dir');
  });

  it('isInside: ancestor of bridged root is NOT considered inside', () => {
    assert.equal(isInside('/a/b', '/a/b/project'), false, 'parent must not be treated as inside a child project');
    assert.equal(isInside('/a/b/project', '/a/b/project'), true, 'equal paths are inside');
    assert.equal(isInside('/a/b/project/src', '/a/b/project'), true, 'descendant is inside');
    assert.equal(isInside('/a/b/other', '/a/b/project'), false, 'sibling is not inside');
  });

  it('does NOT render a state when cwd is a parent of the bridged project (bug 1 regression)', () => {
    clearBridge();
    // Bridged project A has an open ledger.
    const { dir: projectA, enforcer: enforcerA } = mkProject();
    writeLedgerRows(enforcerA, [
      { id: 'T1', status: 'pending', evidence: '' },
      { id: 'T2', status: 'pending', evidence: '' }
    ]);
    // Capture the bridge pointing at projectA.
    captureStatuslineSessionBridge({ session_id: 's1', workspace: { current_dir: projectA } });

    // Now user cd's to parent directory (which is a generic projects dir).
    const parent = path.dirname(projectA);
    const state = inferStatuslineState({ cwd: parent, sessionId: 's1' });
    assert.equal(state, null, 'statusline must not render project A state when cwd is above it');

    clearBridge();
  });

  it('still renders the bridged state when cwd is a descendant of the bridged project', () => {
    clearBridge();
    const { dir: projectA, enforcer: enforcerA } = mkProject();
    writeLedgerRows(enforcerA, [
      { id: 'T1', status: 'pending', evidence: '' }
    ]);
    captureStatuslineSessionBridge({ session_id: 's2', workspace: { current_dir: projectA } });

    // User cd's into a subdir (e.g., src/); that's still "inside" the project.
    const sub = path.join(projectA, 'src');
    fs.mkdirSync(sub, { recursive: true });
    const state = inferStatuslineState({ cwd: sub, sessionId: 's2' });
    assert.ok(state, 'descendant cwd should still pick up the bridged project stage');

    clearBridge();
  });

  it('treats a bare .plan-enforcer directory (no artifacts) as if it were absent', () => {
    clearBridge();
    // Mimic the staging-repo edge case: a directory literally named
    // `.plan-enforcer` sitting under a parent, containing only a repo
    // (e.g., src/, package.json) -- not plan-enforcer state.
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-parent-'));
    const bare = path.join(parent, '.plan-enforcer');
    fs.mkdirSync(bare, { recursive: true });
    fs.writeFileSync(path.join(bare, 'package.json'), '{}');
    fs.mkdirSync(path.join(bare, 'src'));

    const state = inferStatuslineState({ cwd: parent, sessionId: 'sx' });
    assert.equal(state, null, 'a non-state .plan-enforcer dir must not trigger any render at parent cwd');

    clearBridge();
  });
});

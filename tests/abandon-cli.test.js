const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const a = require('../src/abandon-cli');

const SAMPLE_LEDGER = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/demo.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
| T1 | first | pending |         | A:I1 |       |
| T2 | second | verified | built  | A:I1 |       |
| T3 | third | pending  |         | A:I1 |       |
| T4 | fourth | blocked | wait   | A:I1 |       |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
| D1 | pivot | x | seed | y |
| D2 | override | gate | bypass | z |

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;

describe('parseArgs', () => {
  it('captures --reason value', () => {
    const out = a.parseArgs(['--reason', 'scope changed']);
    assert.equal(out.reason, 'scope changed');
    assert.equal(out.help, false);
  });
  it('missing --reason returns null', () => {
    const out = a.parseArgs([]);
    assert.equal(out.reason, null);
  });
  it('--help sets help flag', () => {
    const out = a.parseArgs(['--help']);
    assert.equal(out.help, true);
  });
});

describe('markAllNonTerminalSuperseded', () => {
  it('flips only non-terminal rows', () => {
    const r = a.markAllNonTerminalSuperseded(SAMPLE_LEDGER, 'pivoting');
    assert.deepEqual(r.mutatedIds, ['T1', 'T3']);
    assert.match(r.content, /\| T1 \| first \| superseded \| abandoned: pivoting/);
    assert.match(r.content, /\| T3 \| third \| superseded \| abandoned: pivoting/);
    // T2 and T4 untouched
    assert.match(r.content, /\| T2 \| second \| verified \| built/);
    assert.match(r.content, /\| T4 \| fourth \| blocked \| wait/);
  });
  it('truncates long reasons in evidence', () => {
    const long = 'x'.repeat(100);
    const r = a.markAllNonTerminalSuperseded(SAMPLE_LEDGER, long);
    assert.ok(r.content.includes('abandoned: ' + 'x'.repeat(40)));
    assert.ok(!r.content.includes('abandoned: ' + 'x'.repeat(41)));
  });
});

describe('injectAbandonDecisionRow', () => {
  it('computes next D-ID after existing rows', () => {
    const r = a.injectAbandonDecisionRow(SAMPLE_LEDGER, ['T1', 'T3'], 'scope changed');
    assert.equal(r.decisionId, 'D3');
    assert.match(r.content, /\| D3 \| pivot \| T1, T3 \| Plan abandoned: scope changed/);
  });
  it('falls back to D1 when Decision Log is empty', () => {
    const empty = SAMPLE_LEDGER.replace(/\| D1.*\n\| D2.*\n/s, '');
    const r = a.injectAbandonDecisionRow(empty, ['T1'], 'why');
    assert.equal(r.decisionId, 'D1');
    assert.match(r.content, /\| D1 \| pivot \| T1 \| Plan abandoned: why/);
  });
});

describe('sanityCheckAllTerminal', () => {
  it('passes after mark+inject', () => {
    const m = a.markAllNonTerminalSuperseded(SAMPLE_LEDGER, 'done');
    const d = a.injectAbandonDecisionRow(m.content, m.mutatedIds, 'done');
    a.sanityCheckAllTerminal(d.content);
  });
  it('throws when a non-terminal row remains', () => {
    assert.throws(() => a.sanityCheckAllTerminal(SAMPLE_LEDGER), /non-terminal rows remain/);
  });
});

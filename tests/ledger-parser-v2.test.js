const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  VALID_D_TYPES,
  inferDecisionType,
  parseChainCell,
  parseDecisionLog,
  parseLedger,
  parseMetadata,
  parseTaskRows,
  splitRow
} = require('../src/ledger-parser');
const { generateLedger } = require('../src/plan-detector');

const V2_LEDGER = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p1.md -->
<!-- tier: enforced -->
<!-- created: 2026-04-12T18:00:00Z -->

## Task Ledger

| ID  | Task           | Status   | Evidence              | Chain          | Notes |
|-----|----------------|----------|-----------------------|----------------|-------|
| T1  | Scaffold repo  | verified | commit a1b2c3d        | D1, C:a1b2c3d  |       |
| T2  | Add auth       | done     | src/auth.ts           |                | WIP   |
| T3  | Ship docs      | pending  |                       |                |       |

## Decision Log

| ID | Type      | Scope | Reason                             | Evidence      |
|----|-----------|-------|------------------------------------|---------------|
| D1 | deviation | T1    | Used Express instead of Fastify    | commit a1b2c3d |
| D2 | unplanned | —     | Added logger.ts for auth debugging | commit b3c4d5e |
| D3 | delete    | T2    | Removed legacy middleware          | commit c5d6e7f |

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
| R1    | T1-T2         | 0          | continue     |
`;

const V1_LEDGER = `# Plan Enforcer Ledger
<!-- source: docs/plans/old.md -->
<!-- tier: structural -->

## Task Ledger

| ID  | Task        | Status   | Evidence | Notes |
|-----|-------------|----------|----------|-------|
| T1  | Old task 1  | verified | done it  | hi    |
| T2  | Old task 2  | done     |          |       |

## Decision Log

| ID | Task Ref | Decision          | Reason                              |
|----|----------|-------------------|-------------------------------------|
| D1 | T1       | Used Express      | Fastify broke on Windows            |
| D2 | T2       | Removed middleware| Replaced by new auth per T2 spec    |
`;

const SUFFIX_LEDGER = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/suffix.md -->
<!-- tier: structural -->

## Task Ledger

| ID   | Task        | Status      | Evidence | Chain | Notes |
|------|-------------|-------------|----------|-------|-------|
| T1   | one         | verified    | yes      |       |       |
| T11a | split alpha | in-progress |          |       |       |
| T11b | split beta  | pending     |          |       |       |
`;

describe('splitRow', () => {
  it('strips leading and trailing empty cells', () => {
    assert.deepEqual(splitRow('| a | b | c |'), ['a', 'b', 'c']);
  });
  it('preserves interior empties', () => {
    assert.deepEqual(splitRow('| a |  | c |'), ['a', '', 'c']);
  });
});

describe('parseChainCell', () => {
  it('splits comma-separated references', () => {
    assert.deepEqual(parseChainCell('D1, C:a1b2c3d, V1'), ['D1', 'C:a1b2c3d', 'V1']);
  });
  it('empty cell returns empty array', () => {
    assert.deepEqual(parseChainCell(''), []);
    assert.deepEqual(parseChainCell('   '), []);
  });
  it('single reference returns one-element array', () => {
    assert.deepEqual(parseChainCell('D1'), ['D1']);
  });
});

describe('parseTaskRows on v2', () => {
  it('includes chain field populated from Chain column', () => {
    const rows = parseTaskRows(V2_LEDGER);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].chain, ['D1', 'C:a1b2c3d']);
    assert.deepEqual(rows[1].chain, []);
    assert.deepEqual(rows[2].chain, []);
  });
  it('preserves evidence and notes cells', () => {
    const rows = parseTaskRows(V2_LEDGER);
    assert.equal(rows[0].evidence, 'commit a1b2c3d');
    assert.equal(rows[1].notes, 'WIP');
  });
  it('status is lowercased', () => {
    const rows = parseTaskRows(V2_LEDGER);
    assert.equal(rows[0].status, 'verified');
    assert.equal(rows[1].status, 'done');
    assert.equal(rows[2].status, 'pending');
  });
});

describe('parseTaskRows on v1 (backward compat)', () => {
  it('returns chain=[] for v1 rows', () => {
    const rows = parseTaskRows(V1_LEDGER);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].chain, []);
    assert.equal(rows[0].evidence, 'done it');
    assert.equal(rows[0].notes, 'hi');
  });
});

describe('suffixed task IDs', () => {
  it('parses split task rows like T11a/T11b', () => {
    const rows = parseTaskRows(SUFFIX_LEDGER);
    assert.deepEqual(rows.map((row) => row.id), ['T1', 'T11a', 'T11b']);
    assert.equal(rows[1].status, 'in-progress');
    assert.equal(rows[2].status, 'pending');
  });

  it('counts suffixed task rows in ledger stats', () => {
    const stats = parseLedger(SUFFIX_LEDGER);
    assert.equal(stats.total, 3);
    assert.equal(stats.doneCount, 1);
    assert.equal(stats.remaining, 2);
  });
});

describe('parseDecisionLog on v2', () => {
  it('returns structured fields per entry', () => {
    const entries = parseDecisionLog(V2_LEDGER);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].id, 'D1');
    assert.equal(entries[0].type, 'deviation');
    assert.equal(entries[0].scope, 'T1');
    assert.match(entries[0].reason, /Express/);
    assert.equal(entries[0].evidence, 'commit a1b2c3d');
  });
  it('all types are in the valid set', () => {
    const entries = parseDecisionLog(V2_LEDGER);
    for (const e of entries) {
      assert.ok(VALID_D_TYPES.has(e.type), `type "${e.type}" not valid`);
    }
  });
});

describe('parseDecisionLog on v1 (backward compat)', () => {
  it('folds Decision + Reason into reason field', () => {
    const entries = parseDecisionLog(V1_LEDGER);
    assert.equal(entries.length, 2);
    assert.match(entries[0].reason, /Express/);
    assert.match(entries[0].reason, /Fastify/);
  });
  it('infers type from combined Decision + Reason text', () => {
    const entries = parseDecisionLog(V1_LEDGER);
    assert.equal(entries[0].type, 'deviation');
    assert.equal(entries[1].type, 'delete');
  });
  it('scope falls back to Task Ref', () => {
    const entries = parseDecisionLog(V1_LEDGER);
    assert.equal(entries[0].scope, 'T1');
    assert.equal(entries[1].scope, 'T2');
  });
});

describe('parseLedger drift uses typed D-rows on v2', () => {
  it('counts unplanned type as drift', () => {
    const stats = parseLedger(V2_LEDGER);
    assert.equal(stats.drift, 1, 'D2 is type=unplanned and should count as drift');
  });
});

describe('parseMetadata', () => {
  it('returns schema=v2 on v2 ledgers', () => {
    assert.equal(parseMetadata(V2_LEDGER).schema, 'v2');
  });
  it('returns schema=v1 on v1 ledgers (no marker)', () => {
    assert.equal(parseMetadata(V1_LEDGER).schema, 'v1');
  });
});

describe('inferDecisionType mirrors schema-migrate', () => {
  it('detects delete from Decision cell', () => {
    assert.equal(inferDecisionType('Removed legacy middleware'), 'delete');
  });
  it('falls back to deviation', () => {
    assert.equal(inferDecisionType('Used Express'), 'deviation');
  });
});

describe('round-trip: generateLedger + parser', () => {
  it('parser reads what the generator emits', () => {
    const gen = generateLedger('docs/plans/test.md', ['T1 name', 'T2 name'], 'enforced');
    const rows = parseTaskRows(gen);
    const meta = parseMetadata(gen);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'pending');
    assert.deepEqual(rows[0].chain, []);
    assert.equal(meta.schema, 'v2');
  });
});

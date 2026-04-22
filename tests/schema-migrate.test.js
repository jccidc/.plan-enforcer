const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA_MARKER,
  VALID_TYPES,
  detectVersion,
  inferType,
  migrate,
  migrateFile
} = require('../src/schema-migrate');

const V1_LEDGER = `# Plan Enforcer Ledger
<!-- source: docs/plans/test.md -->
<!-- tier: enforced -->
<!-- created: 2026-04-12T00:00:00Z -->

## Scoreboard
 3 total  |  1 done  |  0 verified  |  0 skipped  |  0 blocked  |  2 remaining

## Task Ledger

| ID  | Task                                     | Status  | Evidence | Notes |
|-----|------------------------------------------|---------|----------|-------|
| T1  | Scaffold project                         | verified | commit a1b | initial |
| T2  | Add auth                                 | done     |          |        |
| T3  | Ship docs                                | pending  |          |        |

## Decision Log

| ID | Task Ref | Decision | Reason |
|----|----------|----------|--------|
| D1 | T2       | Used Express not Fastify | Fastify native modules broke on Windows |
| D2 | T2       | Removed old auth middleware | Replaced by new one per T2 spec |

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
| R1    | T1-T2         | 0          | continue     |
`;

const V2_LEDGER = `# Plan Enforcer Ledger
${SCHEMA_MARKER}
<!-- source: docs/plans/test.md -->

## Task Ledger

| ID  | Task   | Status  | Evidence | Chain   | Notes |
|-----|--------|---------|----------|---------|-------|
| T1  | foo    | done    |          |         |       |

## Decision Log

| ID | Type      | Task Ref | Decision | Reason |
|----|-----------|----------|----------|--------|
`;

describe('detectVersion', () => {
  it('recognizes v2 via schema marker', () => {
    assert.equal(detectVersion(V2_LEDGER), 'v2');
  });

  it('recognizes v1 by absent Chain column and present Notes', () => {
    assert.equal(detectVersion(V1_LEDGER), 'v1');
  });

  it('returns unknown when no ledger-shaped header exists', () => {
    assert.equal(detectVersion('# Some random doc\n\nHello world.'), 'unknown');
  });
});

describe('inferType', () => {
  it('classifies deletion language', () => {
    assert.equal(inferType('Removed old auth middleware'), 'delete');
    assert.equal(inferType('deleted src/legacy/'), 'delete');
    assert.equal(inferType('ran rm -rf build/'), 'delete');
  });

  it('classifies unplanned additions', () => {
    assert.equal(inferType('added src/logger.ts, not in the plan'), 'unplanned');
  });

  it('classifies pivots', () => {
    assert.equal(inferType('Jumped to T11 because T8 was blocked'), 'pivot');
    assert.equal(inferType('switched to task 5 out of order'), 'pivot');
  });

  it('classifies overrides', () => {
    assert.equal(inferType('bypassed the gate to commit WIP'), 'override');
  });

  it('defaults to deviation', () => {
    assert.equal(inferType('Used Express instead of Fastify'), 'deviation');
    assert.equal(inferType(''), 'deviation');
  });

  it('inferred values are all valid types', () => {
    const samples = ['removed X', 'unplanned Y', 'pivoted', 'override', 'vague reason'];
    for (const s of samples) {
      assert.ok(VALID_TYPES.has(inferType(s)), `inferType("${s}") should be a valid type`);
    }
  });
});

describe('migrate', () => {
  it('is idempotent on v2 content', () => {
    const r = migrate(V2_LEDGER);
    assert.equal(r.changed, false);
    assert.equal(r.version, 'v2');
    assert.equal(r.migrated, V2_LEDGER);
  });

  it('leaves unknown content untouched with a warning', () => {
    const r = migrate('Not a ledger at all.');
    assert.equal(r.changed, false);
    assert.equal(r.version, 'unknown');
    assert.ok(r.warnings.length > 0);
  });

  it('upgrades v1 to v2: adds schema marker', () => {
    const r = migrate(V1_LEDGER);
    assert.equal(r.changed, true);
    assert.ok(r.migrated.includes(SCHEMA_MARKER));
  });

  it('upgrades v1 to v2: Task Ledger header gets Chain column', () => {
    const r = migrate(V1_LEDGER);
    const headerLine = r.migrated.split('\n').find((l) => /^\|\s*ID\s*\|.*Notes\s*\|$/.test(l));
    assert.ok(headerLine, 'should find task ledger header');
    const cells = headerLine.split('|').map((c) => c.trim()).filter(Boolean);
    assert.ok(cells.includes('Chain'), `header should have Chain; got cells ${JSON.stringify(cells)}`);
    // Chain appears between Evidence and Notes
    const evIdx = cells.indexOf('Evidence');
    const chIdx = cells.indexOf('Chain');
    const noIdx = cells.indexOf('Notes');
    assert.ok(evIdx < chIdx && chIdx < noIdx, 'Chain must sit between Evidence and Notes');
  });

  it('upgrades v1 to v2: task rows get an empty Chain cell', () => {
    const r = migrate(V1_LEDGER);
    const t1Line = r.migrated.split('\n').find((l) => /^\|\s*T1\s*\|/.test(l));
    const cells = t1Line.split('|').map((c) => c.trim());
    // leading empty, T1, Task, Status, Evidence, Chain, Notes, trailing empty = 8
    assert.equal(cells.length, 8, `T1 row should have 6 content cells; got ${JSON.stringify(cells)}`);
  });

  it('upgrades v1 to v2: Decision Log header is the v2 canonical shape', () => {
    const r = migrate(V1_LEDGER);
    const dlogLines = r.migrated.split('\n');
    const headerIdx = dlogLines.findIndex((l) => l.trim() === '## Decision Log');
    const headerRow = dlogLines.slice(headerIdx).find((l) => /^\|\s*ID\s*\|/.test(l));
    const cells = headerRow.split('|').map((c) => c.trim()).filter(Boolean);
    assert.deepEqual(cells, ['ID', 'Type', 'Scope', 'Reason', 'Evidence']);
  });

  it('upgrades v1 to v2: D-rows get inferred Type in column 2', () => {
    const r = migrate(V1_LEDGER);
    const dlogLines = r.migrated.split('\n').filter((l) => /^\|\s*D\d+\s*\|/.test(l));
    // Each row: | Dn | type | scope | reason | evidence |
    const d1Cells = dlogLines[0].split('|').map((c) => c.trim());
    const d2Cells = dlogLines[1].split('|').map((c) => c.trim());
    // cells[0]='', cells[1]='Dn', cells[2]=type, cells[3]=scope, cells[4]=reason, cells[5]=evidence, cells[6]=''
    assert.equal(d1Cells[2], 'deviation', `D1 type should be deviation; row: ${dlogLines[0]}`);
    assert.equal(d2Cells[2], 'delete', `D2 type should be delete; row: ${dlogLines[1]}`);
  });

  it('upgrades v1 to v2: folds Decision + Reason into v2 Reason column', () => {
    const r = migrate(V1_LEDGER);
    const d1Line = r.migrated.split('\n').find((l) => /^\|\s*D1\s*\|/.test(l));
    // V1 D1: Decision="Used Express not Fastify", Reason="Fastify native modules..."
    // V2 D1 Reason cell should include both.
    assert.ok(/Used Express not Fastify/.test(d1Line));
    assert.ok(/Fastify native modules/.test(d1Line));
  });

  it('upgrades v1 to v2: Scope column carries old Task Ref value', () => {
    const r = migrate(V1_LEDGER);
    const d1Cells = r.migrated.split('\n').find((l) => /^\|\s*D1\s*\|/.test(l)).split('|').map((c) => c.trim());
    assert.equal(d1Cells[3], 'T2', 'v2 Scope should inherit v1 Task Ref');
  });

  it('applying migrate twice is stable', () => {
    const once = migrate(V1_LEDGER).migrated;
    const twice = migrate(once);
    assert.equal(twice.changed, false, 'second pass should be no-op');
    assert.equal(twice.version, 'v2');
    assert.equal(twice.migrated, once);
  });

  it('preserves non-ledger content around the task table', () => {
    const r = migrate(V1_LEDGER);
    assert.ok(r.migrated.includes('## Scoreboard'));
    assert.ok(r.migrated.includes('<!-- source: docs/plans/test.md -->'));
    assert.ok(r.migrated.includes('## Reconciliation History'));
  });
});

describe('migrateFile', () => {
  it('writes migrated file + backup for a v1 file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-mig-'));
    const p = path.join(dir, 'ledger.md');
    fs.writeFileSync(p, V1_LEDGER);
    const res = migrateFile(p);
    assert.equal(res.changed, true);
    assert.equal(res.version, 'v1'); // detected as v1, upgraded
    const written = fs.readFileSync(p, 'utf8');
    assert.ok(written.includes(SCHEMA_MARKER));
    const backup = fs.readFileSync(`${p}.bak`, 'utf8');
    assert.equal(backup, V1_LEDGER);
  });

  it('does nothing to a v2 file (no backup, no change)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-mig-'));
    const p = path.join(dir, 'ledger.md');
    fs.writeFileSync(p, V2_LEDGER);
    const res = migrateFile(p);
    assert.equal(res.changed, false);
    assert.equal(res.version, 'v2');
    assert.equal(fs.existsSync(`${p}.bak`), false);
  });

  it('returns unknown + warning for missing file', () => {
    const res = migrateFile('/nonexistent/does-not-exist.md');
    assert.equal(res.changed, false);
    assert.equal(res.version, 'unknown');
    assert.ok(res.warnings.length > 0);
  });

  it('returns unknown + warning for non-ledger content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-mig-'));
    const p = path.join(dir, 'random.md');
    fs.writeFileSync(p, '# Some readme\n\nContent.');
    const res = migrateFile(p);
    assert.equal(res.changed, false);
    assert.equal(res.version, 'unknown');
    assert.equal(fs.existsSync(`${p}.bak`), false);
  });
});

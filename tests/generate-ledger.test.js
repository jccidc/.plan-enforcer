const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateLedger } = require('../src/plan-detector');
const { detectVersion, migrate } = require('../src/schema-migrate');

const SAMPLE_TASKS = ['Scaffold project', 'Add auth middleware', 'Ship docs'];
const FIXED_NOW = new Date('2026-04-12T18:00:00Z');

describe('generateLedger v2 output', () => {
  it('emits the v2 schema marker', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    assert.ok(out.includes('<!-- schema: v2 -->'), 'v2 marker must be present');
  });

  it('detected as v2 by schema-migrate', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    assert.equal(detectVersion(out), 'v2');
  });

  it('is idempotent under migrate (no-op)', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    const r = migrate(out);
    assert.equal(r.changed, false);
    assert.equal(r.version, 'v2');
  });

  it('Task Ledger header contains Chain column between Evidence and Notes', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    const headerLine = out.split('\n').find((l) => /^\|\s*ID\s*\|.*Chain.*Notes/.test(l));
    assert.ok(headerLine, 'header with Chain column expected');
    const cells = headerLine.split('|').map((c) => c.trim()).filter(Boolean);
    const evIdx = cells.indexOf('Evidence');
    const chIdx = cells.indexOf('Chain');
    const noIdx = cells.indexOf('Notes');
    assert.ok(evIdx < chIdx && chIdx < noIdx, 'Chain between Evidence and Notes');
  });

  it('each task row has six content cells including blank Chain', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    const rows = out.split('\n').filter((l) => /^\|\s*T\d+\s*\|/.test(l));
    assert.equal(rows.length, SAMPLE_TASKS.length);
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      // leading empty, ID, Task, Status, Evidence, Chain, Notes, trailing empty = 8
      assert.equal(cells.length, 8, `row should have 6 content cells: ${row}`);
      // Chain cell (index 5) and Notes cell (index 6) start empty
      assert.equal(cells[5], '', `Chain cell should be blank at creation: ${row}`);
      assert.equal(cells[6], '', `Notes cell should be blank at creation: ${row}`);
    }
  });

  it('Decision Log header has Type column after ID', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    const dlHeaderIdx = out.split('\n').findIndex((l) => l.trim() === '## Decision Log');
    assert.ok(dlHeaderIdx > 0);
    const headerRow = out.split('\n').slice(dlHeaderIdx).find((l) => /^\|\s*ID\s*\|/.test(l));
    const cells = headerRow.split('|').map((c) => c.trim()).filter(Boolean);
    assert.deepEqual(cells, ['ID', 'Type', 'Scope', 'Reason', 'Evidence']);
  });

  it('preserves scoreboard with correct task count', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'structural', FIXED_NOW);
    assert.match(out, /3 total/);
    assert.match(out, /3 remaining/);
    assert.match(out, /Tier: structural/);
  });

  it('emits created timestamp from provided now', () => {
    const out = generateLedger('docs/plans/test.md', SAMPLE_TASKS, 'enforced', FIXED_NOW);
    assert.match(out, /<!-- created: 2026-04-12T18:00:00Z -->/);
  });

  it('handles empty task list without crashing', () => {
    const out = generateLedger('docs/plans/test.md', [], 'advisory', FIXED_NOW);
    assert.equal(detectVersion(out), 'v2');
    assert.match(out, /0 total/);
    // Still has table header + separator, just no rows
    const rows = out.split('\n').filter((l) => /^\|\s*T\d+\s*\|/.test(l));
    assert.equal(rows.length, 0);
  });

  it('seeds Chain cells from inline awareness refs', () => {
    const out = generateLedger('docs/plans/test.md', ['Ship explicit closure A:I1, I2'], 'enforced', FIXED_NOW);
    const row = out.split('\n').find((line) => /^\|\s*T1\s*\|/.test(line));
    assert.match(row, /\|\s*Ship explicit closure\s*\|/);
    assert.match(row, /\|\s*A:I1, A:I2\s*\|/);
  });
});

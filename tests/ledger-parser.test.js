const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  formatLogsReport,
  formatStatusReport,
  parseLedger,
  parseTaskRows,
  parseDecisionLog,
  parseReconciliationHistory,
  parseMetadata
} = require('../src/ledger-parser');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parseLedger', () => {
  it('counts all statuses correctly from sample ledger', () => {
    const result = parseLedger(fixture('sample-ledger.md'));
    assert.equal(result.counts.verified, 2);
    assert.equal(result.counts.done, 1);
    assert.equal(result.counts.skipped, 1);
    assert.equal(result.counts['in-progress'], 1);
    assert.equal(result.counts.pending, 1);
    assert.equal(result.total, 6);
    assert.equal(result.doneCount, 3); // done + verified
    assert.equal(result.remaining, 2); // pending + in-progress
  });

  it('detects drift entries', () => {
    const result = parseLedger(fixture('sample-ledger.md'));
    assert.equal(result.drift, 1);
  });

  it('extracts source from metadata comment', () => {
    const result = parseLedger(fixture('sample-ledger.md'));
    assert.equal(result.source, 'docs/plans/test-plan.md');
  });

  it('handles all-verified ledger', () => {
    const result = parseLedger(fixture('complete-ledger.md'));
    assert.equal(result.counts.verified, 3);
    assert.equal(result.counts.done, 0);
    assert.equal(result.total, 3);
    assert.equal(result.remaining, 0);
  });

  it('handles empty ledger (no task rows)', () => {
    const result = parseLedger(fixture('empty-ledger.md'));
    assert.equal(result.total, 0);
    assert.equal(result.doneCount, 0);
    assert.equal(result.remaining, 0);
    assert.equal(result.drift, 0);
  });

  it('returns unknown source when no comment present', () => {
    const result = parseLedger('# No metadata here\n| T1 | Foo | done |');
    assert.equal(result.source, 'unknown');
  });
});

describe('parseTaskRows', () => {
  it('extracts all task rows with correct fields', () => {
    const rows = parseTaskRows(fixture('sample-ledger.md'));
    assert.equal(rows.length, 6);
    assert.equal(rows[0].id, 'T1');
    assert.equal(rows[0].name, 'Setup project structure');
    assert.equal(rows[0].status, 'verified');
    assert.equal(rows[2].notes, 'needs tests');
    assert.equal(rows[4].id, 'T5');
    assert.equal(rows[4].status, 'in-progress');
  });

  it('returns empty array for empty ledger', () => {
    const rows = parseTaskRows(fixture('empty-ledger.md'));
    assert.equal(rows.length, 0);
  });

  it('returns empty array for non-ledger content', () => {
    const rows = parseTaskRows('Just some text with no tables');
    assert.equal(rows.length, 0);
  });
});

describe('parseDecisionLog', () => {
  it('extracts decision entries', () => {
    const entries = parseDecisionLog(fixture('sample-ledger.md'));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, 'D1');
    assert.equal(entries[1].id, 'D2');
  });

  it('returns empty for ledger with no decisions', () => {
    const entries = parseDecisionLog(fixture('empty-ledger.md'));
    assert.equal(entries.length, 0);
  });
});

describe('parseReconciliationHistory', () => {
  it('extracts reconciliation rounds', () => {
    const entries = parseReconciliationHistory(fixture('sample-ledger.md'));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, 'R1');
    assert.equal(entries[1].id, 'R2');
  });

  it('returns empty for ledger with no reconciliations', () => {
    const entries = parseReconciliationHistory(fixture('empty-ledger.md'));
    assert.equal(entries.length, 0);
  });
});

describe('parseMetadata', () => {
  it('extracts source, tier, and created', () => {
    const meta = parseMetadata(fixture('sample-ledger.md'));
    assert.equal(meta.source, 'docs/plans/test-plan.md');
    assert.equal(meta.tier, 'structural');
    assert.equal(meta.created, '2026-04-11T10:00:00Z');
  });

  it('returns unknown for missing metadata', () => {
    const meta = parseMetadata('# No metadata');
    assert.equal(meta.source, 'unknown');
    assert.equal(meta.tier, 'unknown');
    assert.equal(meta.created, 'unknown');
  });
});

describe('formatStatusReport', () => {
  it('renders scoreboard, current task, and unverified items', () => {
    const report = formatStatusReport(fixture('sample-ledger.md'));
    assert.match(report, /3\/6 tasks/);
    assert.match(report, /Current: T5/);
    assert.match(report, /Current Task: T5 - Add authentication/);
    assert.match(report, /Unverified \(done but no evidence\):/);
    assert.match(report, /T3 - Build API endpoints \(needs tests\)/);
  });
});

describe('formatLogsReport', () => {
  it('renders skipped tasks, drift, decisions, reconciliation, and unverified items', () => {
    const report = formatLogsReport(fixture('sample-ledger.md'));
    assert.match(report, /SKIPPED TASKS:/);
    assert.match(report, /T4  Write frontend components - see D1/);
    assert.match(report, /DRIFT EVENTS:/);
    assert.match(report, /D2  T3 - .*Added unplanned health check endpoint/);
    assert.match(report, /DECISION LOG:/);
    assert.match(report, /RECONCILIATION HISTORY:/);
    assert.match(report, /UNVERIFIED \(done but no evidence\):/);
  });
});

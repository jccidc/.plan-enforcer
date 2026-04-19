const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { populateForRun } = require('../benchmarks/framework-comparison/scripts/auto-populate-native');

function makeRun(ledgerText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-native-'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ size: 'large', scenario: 'test' }));
  fs.writeFileSync(path.join(dir, 'ledger.md'), ledgerText);
  return dir;
}

describe('auto-populate-native flexible parser', () => {
  it('parses native | N | row format, suffixed statuses, escaped pipes, and bullet decisions', () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'native-ledger.md'), 'utf8');
    const dir = makeRun(fixture);
    populateForRun(dir, 'test-scenario', 'large');
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'objectives.json'), 'utf8'));
    assert.equal(obj.total_tasks, 22);
    assert.equal(obj.verified, 22);
    assert.equal(obj.completion_pct, 100);
    assert.equal(obj.decisions_count, 5);
    assert.equal(obj.reconciliations_count, 1);
  });

  it('returns zeros on empty ledger body', () => {
    const dir = makeRun('# Ledger\n\n(no tasks)\n');
    populateForRun(dir, 'empty', 'small');
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'objectives.json'), 'utf8'));
    assert.equal(obj.total_tasks, 0);
    assert.equal(obj.decisions_count, 0);
    assert.equal(obj.reconciliations_count, 0);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildOutcome, listPhaseVerdicts } = require('../benchmarks/framework-comparison/scripts/aggregate-phase-verdicts');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('aggregate-phase-verdicts', () => {
  it('lists and aggregates phase verdicts into outcome shape', () => {
    const cellDir = mkTmp('pe-phase-verdict-agg-');
    const phase1 = path.join(cellDir, 'phase-01');
    const phase2 = path.join(cellDir, 'phase-02');
    fs.mkdirSync(phase1, { recursive: true });
    fs.mkdirSync(phase2, { recursive: true });

    fs.writeFileSync(path.join(phase1, 'phase-verdict.json'), JSON.stringify({
      judge: 'phase-verify-cli@v0',
      archive: 'a1.md',
      tasks: [
        { id: 'T1', shipped: true, status: 'verified', evidence: 'src/a.js' },
        { id: 'T2', shipped: true, status: 'verified', evidence: 'src/b.js' }
      ]
    }, null, 2));
    fs.writeFileSync(path.join(phase2, 'phase-verdict.json'), JSON.stringify({
      judge: 'phase-verify-cli@v0',
      archive: 'a2.md',
      tasks: [
        { id: 'T3', shipped: true, status: 'verified', evidence: 'src/c.js' },
        { id: 'T4', shipped: false, status: 'pending', evidence: '' }
      ]
    }, null, 2));

    const verdicts = listPhaseVerdicts(cellDir);
    assert.equal(verdicts.length, 2);

    const outcome = buildOutcome(verdicts);
    assert.equal(outcome.judge, 'phase-verify-cli@v0');
    assert.equal(outcome.total_tasks, 4);
    assert.equal(outcome.verified, 3);
    assert.equal(outcome.per_task[3].shipped, false);
  });
});

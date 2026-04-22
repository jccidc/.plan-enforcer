const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listPhasePlanFiles, parsePhaseNumber } = require('../benchmarks/framework-comparison/scripts/list-phase-plan-files');

describe('list-phase-plan-files', () => {
  it('parses numbered phase files', () => {
    assert.equal(parsePhaseNumber('phase-01.md'), 1);
    assert.equal(parsePhaseNumber('phase-14.md'), 14);
    assert.equal(parsePhaseNumber('README.md'), null);
  });

  it('returns sorted phase files only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-files-'));
    fs.writeFileSync(path.join(dir, 'phase-10.md'), '# phase 10\n');
    fs.writeFileSync(path.join(dir, 'phase-02.md'), '# phase 2\n');
    fs.writeFileSync(path.join(dir, 'phase-01.md'), '# phase 1\n');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore\n');

    const files = listPhasePlanFiles(dir).map((file) => path.basename(file));
    assert.deepEqual(files, ['phase-01.md', 'phase-02.md', 'phase-10.md']);
  });
});

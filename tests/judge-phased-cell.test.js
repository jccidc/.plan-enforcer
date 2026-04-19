const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildOutcome } = require('../benchmarks/framework-comparison/scripts/judge-phased-cell');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('judge-phased-cell', () => {
  it('judges phased work from plan outputs and shipped artifacts', () => {
    const cellDir = mkTmp('pe-phased-judge-');
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'src'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'test'), { recursive: true });

    fs.writeFileSync(path.join(cellDir, 'phase-01', 'plan.md'), [
      '# Phase 01',
      '',
      '## Tasks',
      '### Task 1: Add visible explanation',
      '### Task 2: Add audit note',
      '',
      '## Outputs',
      '- visible user explanation',
      '- `docs/audit.md` exists',
      '',
      '## Verification',
      '- `npm test` passes'
    ].join('\n'));

    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'src', 'app.js'), 'const visibleMessage = "Visible explanation banner";\n');
    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'audit.md'), 'Audit note with visible explanation rationale.\n');
    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'test', 'audit.test.js'), 'test("visible explanation", () => {})\n');

    const outcome = buildOutcome(cellDir);
    assert.equal(outcome.total_tasks, 2);
    assert.equal(outcome.verified, 2);
    assert.equal(outcome.per_task.every((task) => task.shipped), true);
  });

  it('marks missing artifact-backed tasks as unshipped', () => {
    const cellDir = mkTmp('pe-phased-judge-miss-');
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'src'), { recursive: true });

    fs.writeFileSync(path.join(cellDir, 'phase-01', 'plan.md'), [
      '# Phase 01',
      '',
      '## Tasks',
      '### Task 1: Add audit note',
      '',
      '## Outputs',
      '- `docs/audit.md` exists'
    ].join('\n'));

    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'src', 'app.js'), 'console.log("no audit doc");\n');

    const outcome = buildOutcome(cellDir);
    assert.equal(outcome.total_tasks, 1);
    assert.equal(outcome.verified, 0);
    assert.equal(outcome.per_task[0].shipped, false);
  });

  it('does not let generic docs fallback satisfy an explicit missing ref', () => {
    const cellDir = mkTmp('pe-phased-judge-explicit-ref-');
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs'), { recursive: true });

    fs.writeFileSync(path.join(cellDir, 'phase-01', 'plan.md'), [
      '# Phase 01',
      '',
      '## Tasks',
      '### Task 1: Write final audit note',
      '',
      '## Outputs',
      '- `docs/final-audit.md` exists',
    ].join('\n'));

    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'other-note.md'), 'some other audit-ish note\n');

    const outcome = buildOutcome(cellDir);
    assert.equal(outcome.total_tasks, 1);
    assert.equal(outcome.verified, 0);
    assert.equal(outcome.per_task[0].shipped, false);
  });

  it('parses numbered task lists under ## Tasks', () => {
    const cellDir = mkTmp('pe-phased-judge-numbered-');
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'src'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs'), { recursive: true });

    fs.writeFileSync(path.join(cellDir, 'phase-01', 'plan.md'), [
      '# Phase 01',
      '',
      '## Tasks',
      '1. Create app shell',
      '2. Capture baseline contract note',
      '',
      '## Outputs',
      '- runnable shell',
      '- `docs/contract-note.md` exists',
      '',
      '## Verification',
      '- smoke passes'
    ].join('\n'));

    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'src', 'app.js'), 'export const shell = true;\n');
    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'contract-note.md'), 'baseline contract note\n');

    const outcome = buildOutcome(cellDir);
    assert.equal(outcome.total_tasks, 2);
    assert.equal(outcome.per_task[0].task, 'Create app shell');
    assert.equal(outcome.per_task[1].task, 'Capture baseline contract note');
    assert.equal(outcome.per_task[1].shipped, true);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('review-cli', () => {
  it('prints a formatted report and returns weak/unsafe exit code for bad plans', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-review-cli-'));
    const planPath = path.join(tempDir, 'bad-plan.md');

    fs.writeFileSync(planPath, ['# Plan', '', '### Task 1: Improve backend'].join('\n'));

    const result = spawnSync(process.execPath, ['src/review-cli.js', planPath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 3);
    assert.match(result.stdout, /^Verdict: unsafe/m);
    assert.match(result.stdout, /Suggested repair block:/);
  });

  it('returns zero for passing plans', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-review-cli-'));
    const planPath = path.join(tempDir, 'good-plan.md');

    fs.writeFileSync(planPath, [
      '# Plan',
      '',
      '**Constraints:** keep API stable',
      '**Out of scope:** billing changes',
      '',
      '### Task 1: Add auth regression test',
      '- [ ] Write test for missing session',
      '- [ ] Verify test fails before middleware fix',
      '',
      '### Task 2: Fix auth middleware',
      '- [ ] Reject missing session',
      '- [ ] Verify targeted test passes'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/review-cli.js', planPath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Verdict: pass/m);
  });

  it('writes a patched draft when --write is requested for a weak plan', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-review-cli-write-'));
    const planPath = path.join(tempDir, 'weak-plan.md');

    fs.writeFileSync(planPath, [
      '# Plan',
      '',
      '### Task 1: Improve backend'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/review-cli.js', '--write', planPath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    const repairedPath = path.join(tempDir, 'weak-plan.repaired.md');
    assert.equal(result.status, 3);
    assert.equal(fs.existsSync(repairedPath), true);
    assert.match(result.stdout, /Patched draft written to:/);
    assert.match(fs.readFileSync(repairedPath, 'utf8'), /\*\*Assumptions:\*\*/);
  });

  it('auto-loads discuss packet and reports packet drift', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-review-cli-packet-'));
    const planDir = path.join(tempDir, 'docs', 'plans');
    const packetDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(planDir, { recursive: true });
    fs.mkdirSync(packetDir, { recursive: true });

    const planPath = path.join(planDir, 'export-plan.md');
    const packetPath = path.join(packetDir, 'discuss.md');

    fs.writeFileSync(packetPath, [
      '# Intent packet',
      '',
      '## Normalized Goal',
      'Ship safer exports without losing analyst visibility.',
      '',
      '## Non-Negotiables',
      '- NN1: Analyst exports never leak internal notes',
      '',
      '## Proof Requirements',
      '- PR1: Capture proof that analyst preview text and CSV column set stay aligned'
    ].join('\n'));

    fs.writeFileSync(planPath, [
      '# Plan',
      '',
      '**Constraints:** keep API stable',
      '**Out of scope:** admin redesign',
      '',
      '### Task 1: Add export button',
      '- [ ] Build button',
      '- [ ] Verify button renders'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/review-cli.js', planPath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Discuss packet:/);
    assert.match(result.stdout, /non-negotiable/i);
    assert.match(result.stdout, /proof requirement/i);
  });
});

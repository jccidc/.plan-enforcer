const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { reviewPlanContent, adversarialFindings, extractTaskBlocks } = require('../src/plan-review');

const CLEAN_PLAN = `# Plan
**Assumptions:** x.
**Constraints:** y.
**Out of scope:** z.

### Task 1: Add src/routes/users.ts
- [ ] Create the route module
- [ ] Verify tests/routes/users.test.ts passes

### Task 2: Wire the route into src/app.ts
- [ ] Import and mount at /users
- [ ] Verify curl /users returns 200
`;

describe('adversarialFindings — default off', () => {
  it('reviewPlanContent without opts.adversarial emits no adversarial_ codes', () => {
    const r = reviewPlanContent(CLEAN_PLAN);
    assert.ok(!r.findings.some((f) => f.code.startsWith('adversarial_')));
  });

  it('reviewPlanContent with opts.adversarial=false emits no adversarial_ codes', () => {
    const r = reviewPlanContent(CLEAN_PLAN, { adversarial: false });
    assert.ok(!r.findings.some((f) => f.code.startsWith('adversarial_')));
  });
});

describe('adversarialFindings — clean input stays clean', () => {
  it('a plan with distinct files + complete refs + verified deploys emits nothing', () => {
    const r = reviewPlanContent(CLEAN_PLAN, { adversarial: true });
    const adv = r.findings.filter((f) => f.code.startsWith('adversarial_'));
    assert.equal(adv.length, 0, `unexpected: ${adv.map((f) => f.code).join(', ')}`);
  });
});

describe('adversarialFindings — detector matrix', () => {
  function plan(...blocks) {
    return [
      '# Plan',
      '**Assumptions:** x.',
      '**Constraints:** y.',
      '**Out of scope:** z.',
      '',
      ...blocks
    ].join('\n');
  }

  it('adversarial_multiple_owners fires when two tasks name the same file', () => {
    const p = plan(
      '### Task 1: Add src/app.ts handler',
      '- [ ] Edit src/app.ts',
      '- [ ] Verify tests pass',
      '',
      '### Task 2: Edit src/app.ts for logging',
      '- [ ] Add log line to src/app.ts',
      '- [ ] Verify console output'
    );
    const r = reviewPlanContent(p, { adversarial: true });
    const hits = r.findings.filter((f) => f.code === 'adversarial_multiple_owners');
    assert.ok(hits.length >= 1, `expected multiple_owners; got ${JSON.stringify(r.findings.map(f=>f.code))}`);
    assert.match(hits[0].message, /src\/app\.ts/);
  });

  it('adversarial_dangling_task_ref fires on a reference to a nonexistent task', () => {
    const p = plan(
      '### Task 1: Build it',
      '- [ ] Reference T99 for context',
      '- [ ] Verify tests pass'
    );
    const r = reviewPlanContent(p, { adversarial: true });
    const hits = r.findings.filter((f) => f.code === 'adversarial_dangling_task_ref');
    assert.ok(hits.length >= 1);
    assert.match(hits[0].message, /T99/);
  });

  it('adversarial_unverified_deploy fires on a deploy task with no verification', () => {
    const p = plan(
      '### Task 1: Deploy to staging',
      '- [ ] Push to staging',
      '- [ ] Announce in channel'
    );
    const r = reviewPlanContent(p, { adversarial: true });
    const hits = r.findings.filter((f) => f.code === 'adversarial_unverified_deploy');
    assert.ok(hits.length >= 1);
  });

  it('adversarial_unverified_deploy does NOT fire when the deploy task has verification', () => {
    const p = plan(
      '### Task 1: Deploy to staging',
      '- [ ] Push to staging',
      '- [ ] Verify smoke test passes before announcing'
    );
    const r = reviewPlanContent(p, { adversarial: true });
    const hits = r.findings.filter((f) => f.code === 'adversarial_unverified_deploy');
    assert.equal(hits.length, 0);
  });

  it('adversarial_contradicting_tasks fires on add-then-remove of the same noun phrase', () => {
    const p = plan(
      '### Task 1: Add the retry middleware',
      '- [ ] Create src/retry.ts',
      '- [ ] Verify tests pass',
      '',
      '### Task 2: Remove the retry middleware',
      '- [ ] Delete src/retry.ts',
      '- [ ] Verify tests pass'
    );
    const r = reviewPlanContent(p, { adversarial: true });
    const hits = r.findings.filter((f) => f.code === 'adversarial_contradicting_tasks');
    assert.ok(hits.length >= 1);
    assert.match(hits[0].message, /retry middleware/);
  });

  it('contradicting-tasks phrase requires ≥2 tokens (doesn\'t flag single-word noise)', () => {
    const p = plan(
      '### Task 1: Add src',
      '- [ ] Write to src',
      '- [ ] Verify tests',
      '',
      '### Task 2: Remove src',
      '- [ ] Delete src',
      '- [ ] Verify tests'
    );
    const r = reviewPlanContent(p, { adversarial: true });
    const hits = r.findings.filter((f) => f.code === 'adversarial_contradicting_tasks');
    assert.equal(hits.length, 0, 'bare "src" should not trigger the contradicting_tasks detector');
  });
});

describe('plan-enforcer-research skill sanity', () => {
  const skillPath = path.join(__dirname, '..', 'skills', 'plan-enforcer-research', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  it('has YAML frontmatter with name + description', () => {
    assert.match(content, /^---\s*\n/);
    assert.match(content, /^name:\s*plan-enforcer-research/m);
    assert.match(content, /^description:\s*"?\S/m);
  });

  it('points at the shared research brief path', () => {
    assert.match(content, /\.plan-enforcer\/research\.md/);
  });

  it('includes skip / bailout guidance', () => {
    assert.match(content, /skip|bailout|already briefed/i);
  });

  it('specifies the cite-file:line discipline', () => {
    assert.match(content, /file\s*path|file:line|cite/i);
  });
});

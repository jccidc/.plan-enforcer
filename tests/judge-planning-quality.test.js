const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildJudgment } = require('../benchmarks/framework-comparison/scripts/judge-planning-quality');

describe('judge-planning-quality', () => {
  it('passes when interpretation, plan, and review preserve the ask', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'analyst-safe preview and csv must stay aligned');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'keep private notes out and explain narrowing');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['analyst-safe', 'private notes', 'preview', 'csv', 'explain', 'proof'],
      required_plan_signals: ['private notes', 'preview', 'csv', 'verify', 'out of scope'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: ['generic export feature']
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'combobulate.md'),
      [
        '# Intent',
        '',
        '## Normalized Goal',
        'Add analyst-safe export planning.',
        '',
        '## Non-Negotiables',
        '- NN1: analyst-safe export never includes private notes',
        '',
        '## Proof Requirements',
        '- PR1: proof that preview and csv stay aligned',
        '',
        'analyst-safe private notes preview csv explain proof'
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      [
        '# Plan',
        '',
        '**Goal:** analyst-safe export without leaking private notes',
        '**Constraints:** keep preview and csv aligned',
        '**Out of scope:** redesign',
        '',
        '## Must-Haves',
        '- MH1: analyst-safe mode strips private notes from preview and csv',
        '',
        '### Task 1: Add shared preview/csv field selector',
        '- [ ] Build shared selector',
        '- [ ] Verify preview and csv stay aligned',
        '',
        '### Task 2: Add visible explanation',
        '- [ ] Explain analyst-safe narrowing',
        '- [ ] Verify explanation appears'
      ].join('\n')
    );

    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: pass');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'pass');
    assert.equal(judgment.interpretation.passed, true);
    assert.equal(judgment.plan.passed, true);
    assert.equal(judgment.review.passed, true);
  });

  it('fails when the plan narrows to a generic export feature', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['analyst-safe'],
      required_plan_signals: ['verify', 'out of scope'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: ['generic export feature']
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      [
        '# Plan',
        '',
        '**Goal:** generic export feature',
        '**Out of scope:** redesign',
        '',
        '### Task 1: Add export',
        '- [ ] Build export',
        '- [ ] Verify export'
      ].join('\n')
    );
    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: weak');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'fail');
    assert.ok(judgment.plan.forbidden_hits.includes('generic export feature'));
  });

  it('does not treat out-of-scope bullets as forbidden narrowing hits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['analyst-safe preview'],
      required_plan_signals: ['same payload-building path', 'verification', 'out of scope'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: ['platform redesign']
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'combobulate.md'),
      'analyst-safe preview same payload-building path proof'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      [
        '# Plan',
        '',
        '**Goal:** admin replay flow',
        '**Out of scope:**',
        '- Event delivery platform redesign.',
        '',
        '### Task 1: Add shared payload builder',
        '- [ ] Build one payload-building code path',
        '- [ ] Verification: prove preview and execute stay aligned'
      ].join('\n')
    );
    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: pass');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.plan.passed, true);
    assert.deepEqual(judgment.plan.forbidden_hits, []);
  });

  it('does not treat must-not blocklist references as forbidden hits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['active roadmap'],
      required_plan_signals: ['diff review', 'out of scope'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: ['planning first']
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'combobulate.md'),
      'active roadmap'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      [
        '# Plan',
        '',
        '**Goal:** protect active roadmap',
        '**Out of scope:** broad rewrite',
        '',
        '- The archived planning first framing must not appear in the final file.',
        '- Verification: diff review proof step'
      ].join('\n')
    );
    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: pass');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.plan.passed, true);
    assert.deepEqual(judgment.plan.forbidden_hits, []);
  });

  it('does not treat archived snapback references as forbidden hits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['active roadmap'],
      required_plan_signals: ['diff review', 'out of scope'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: ['planning first']
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'combobulate.md'),
      'active roadmap'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      [
        '# Plan',
        '',
        '**Goal:** prevent a snapback to the archived planning-first roadmap.',
        '**Out of scope:** broad rewrite',
        '',
        '- Verification: diff review proof step'
      ].join('\n')
    );
    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: pass');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.plan.passed, true);
    assert.deepEqual(judgment.plan.forbidden_hits, []);
  });

  it('does not treat guard language about reinstating a stale position as a forbidden hit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['active roadmap'],
      required_plan_signals: ['diff review', 'out of scope'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: ['planning first']
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'combobulate.md'),
      'active roadmap'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      [
        '# Plan',
        '',
        '**Goal:** roadmap guard',
        '**Out of scope:** broad rewrite',
        '',
        '- Proof step prevents reinstating planning-first positioning.',
        '- Verification: diff review proof step'
      ].join('\n')
    );
    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: pass');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.plan.passed, true);
    assert.deepEqual(judgment.plan.forbidden_hits, []);
  });

  it('accepts fair source-of-truth / stale-guidance aliases', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['source of truth', 'superseded stale note', 'contract lineage'],
      required_plan_signals: ['source of truth', 'superseded stale note', 'contract lineage', 'verification'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: []
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'interpretation.md'),
      'Use canonical source from compliance note, call out stale runbook, preserve semantic lineage.'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'plan.md'),
      'Authoritative source wins. Superseded guidance gets migration note. Build lineage map. Verification required.'
    );
    fs.writeFileSync(path.join(cellDir, 'output.txt'), 'Verdict: pass');

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'pass');
    assert.equal(judgment.interpretation.passed, true);
    assert.equal(judgment.plan.passed, true);
  });

  it('finds GSD-style plan and review artifacts under .planning milestone paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', '.planning', 'milestone-01-admin-replay', 'phase-01-replay-planning'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['same payload-building path'],
      required_plan_signals: ['same payload-building path', 'response shape stable', 'verification'],
      required_review_signals: ['verdict'],
      forbidden_narrowings: []
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'interpretation.md'),
      'Interpretation keeps a single payload shaping path.'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.planning', 'milestone-01-admin-replay', 'phase-01-replay-planning', 'PLAN.md'),
      'Plan uses a single payload shaping path. Existing response shape is frozen. Verification required.'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', '.planning', 'milestone-01-admin-replay', 'phase-01-replay-planning', 'PLAN-CHECK.md'),
      'Verdict: pass'
    );

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'pass');
    assert.ok(judgment.plan.path.endsWith('PLAN.md'));
    assert.ok(judgment.review.path.endsWith('PLAN-CHECK.md'));
  });

  it('finds docs/plans seeded review artifacts and one-payload aliases', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-quality-judge-'));
    const cellDir = path.join(root, 'cell');
    const fixtureDir = path.join(root, 'fixture');
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'full ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'judge-spec.json'), JSON.stringify({
      required_interpretation_signals: ['same payload-building path'],
      required_plan_signals: ['same payload-building path', 'effective replay decision', 'verification'],
      required_review_signals: ['verdict', 'same payload-building path', 'approval note'],
      forbidden_narrowings: []
    }));

    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'interpretation.md'),
      'Interpretation keeps same payload-building path.'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'replay-plan.md'),
      'Plan uses ONE payload-building function and surfaces currentReplayDecision. Verification required.'
    );
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'seeded-replay-review.md'),
      'Verdict: reject. Use same payload-building path. Approval note required.'
    );

    const judgment = buildJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'pass');
    assert.ok(judgment.review.path.endsWith('seeded-replay-review.md'));
  });
});

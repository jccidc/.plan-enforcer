const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildAskFidelityJudgment,
  findForbiddenEvidence,
  writeJudgment
} = require('../benchmarks/framework-comparison/scripts/judge-ask-fidelity');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe('judge-ask-fidelity', () => {
  it('passes scenario-a style artifacts when all ask-level signals are present', () => {
    const root = mkTmp('pe-ask-fidelity-pass-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'docs', 'verification'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'typing autosave and recovery message with restore/discard');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'hidden contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'cold auditor replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'ask-fidelity-small-scenario-a',
      requirements: [
        { id: 'typing_autosave', summary: 'typing autosave', all_of: ['typing'], any_of: ['autosave'], required: true },
        { id: 'recovery_message', summary: 'recovery message', all_of: ['recovery'], any_of: ['message'], required: true },
        { id: 'restore_discard_choice', summary: 'restore discard', all_of: ['restore', 'discard'], any_of: ['recovery'], required: true },
        { id: 'recovery_verification', summary: 'verification', all_of: ['verification'], any_of: ['recovery'], required: true }
      ]
    });

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 4,
      verified: 4
    });
    writeJson(path.join(cellDir, 'phase-01', 'phase-verdict.json'), {
      pass: true,
      warnings: [],
      decisions: []
    });
    fs.writeFileSync(path.join(cellDir, 'README.md'), [
      'Typing autosave saves draft state while typing.',
      'Recovery message appears on revisit.',
      'User can restore or discard the recovered draft.'
    ].join('\n'));
    fs.writeFileSync(path.join(cellDir, 'docs', 'verification', 'recovery-check.md'), [
      'Verification steps for recovery flow.',
      'Check restore path.',
      'Check discard path.'
    ].join('\n'));

    const judgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'pass');
    assert.equal(judgment.scores.execution_outcome, 1);
    assert.equal(judgment.scores.ask_fidelity, 1);
    assert.equal(judgment.scores.false_completion_resistance, 1);
    const written = writeJudgment(cellDir, judgment);
    assert.equal(fs.existsSync(written), true);
  });

  it('fails ask fidelity when completion is full but recovery UX evidence is missing', () => {
    const root = mkTmp('pe-ask-fidelity-fail-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'typing autosave and recovery message with restore/discard');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'hidden contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'cold auditor replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'ask-fidelity-small-scenario-a',
      requirements: [
        { id: 'typing_autosave', summary: 'typing autosave', all_of: ['typing'], any_of: ['autosave'], required: true },
        { id: 'recovery_message', summary: 'recovery message', all_of: ['recovery'], any_of: ['message'], required: true }
      ]
    });

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 4,
      verified: 4
    });
    writeJson(path.join(cellDir, 'phase-01', 'phase-verdict.json'), {
      pass: true,
      warnings: [],
      decisions: []
    });
    fs.writeFileSync(path.join(cellDir, 'README.md'), 'Typing autosave works while typing.');

    const judgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'partial');
    assert.equal(judgment.scores.execution_outcome, 1);
    assert.equal(judgment.scores.ask_fidelity, 0.5);
    assert.equal(judgment.scores.false_completion_resistance, 0);
    assert.equal(judgment.findings[0].requirement_id, 'recovery_message');
  });

  it('honors an executable oracle when fixture provides one', () => {
    const root = mkTmp('pe-ask-fidelity-oracle-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'oracle-scenario',
      requirements: [
        { id: 'r1', summary: 'req', all_of: ['present'], required: true }
      ]
    });
    fs.writeFileSync(path.join(fixtureDir, 'oracle.js'), [
      "const fs = require('fs');",
      "const path = require('path');",
      "const idx = process.argv.indexOf('--artifacts');",
      "const dir = process.argv[idx + 1];",
      "const pass = fs.existsSync(path.join(dir, 'must-exist.txt'));",
      "process.stdout.write(JSON.stringify({ pass, findings: pass ? [] : [{ kind: 'oracle_fail', severity: 'high', summary: 'missing oracle artifact' }] }));"
    ].join('\n'));

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 1,
      verified: 1
    });
    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'doc.md'), 'present');

    const failJudgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(failJudgment.scores.ask_fidelity, 0);
    assert.equal(failJudgment.findings.some((finding) => finding.kind === 'oracle_fail'), true);

    fs.writeFileSync(path.join(cellDir, 'worktree-artifacts', 'must-exist.txt'), 'ok');
    const passJudgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(passJudgment.scores.ask_fidelity, 1);
    assert.equal(passJudgment.oracle.pass, true);
  });

  it('does not treat benchmark-generated phase plan files as scope creep in scenario-o style oracles', () => {
    const root = mkTmp('pe-ask-fidelity-oracle-plans-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    const artifactsDir = path.join(cellDir, 'worktree-artifacts');
    fs.mkdirSync(path.join(fixtureDir, 'fixture-repo', 'docs', 'archive'), { recursive: true });
    fs.mkdirSync(path.join(artifactsDir, 'docs', 'archive'), { recursive: true });
    fs.mkdirSync(path.join(artifactsDir, 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(path.join(artifactsDir, 'docs', 'strategy'), { recursive: true });
    fs.mkdirSync(path.join(artifactsDir, 'tests'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'ask-fidelity-small-scenario-o',
      requirements: [
        { id: 'active_roadmap_guard', summary: 'guard', all_of: ['roadmap'], any_of: ['guard'], required: true }
      ]
    });

    fs.writeFileSync(path.join(fixtureDir, 'fixture-repo', 'docs', 'archive', 'product-roadmap-2026-04-15.md'), 'old roadmap');
    fs.writeFileSync(path.join(fixtureDir, 'oracle.js'), fs.readFileSync(path.join(process.cwd(), 'benchmarks/framework-comparison/frozen-plans/ask-fidelity-small-scenario-o/oracle.js'), 'utf8'));

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 1,
      verified: 1
    });

    fs.writeFileSync(path.join(artifactsDir, 'docs', 'archive', 'product-roadmap-2026-04-15.md'), 'old roadmap');
    fs.writeFileSync(path.join(artifactsDir, 'docs', 'strategy', 'product-roadmap.md'), 'Product roadmap\ncarryover moat is the primary wedge\nexecuted verification\nroadmap-regression guard\n');
    fs.writeFileSync(path.join(artifactsDir, 'docs', 'strategy', 'roadmap-regression-proof.md'), 'archive stale narrow untouched proof');
    fs.writeFileSync(path.join(artifactsDir, 'tests', 'roadmap-regression.test.js'), 'roadmap regression test planning quality is the whole story');
    fs.writeFileSync(path.join(artifactsDir, 'docs', 'plans', 'phase-01.md'), 'generated benchmark phase plan');
    fs.writeFileSync(path.join(artifactsDir, 'docs', 'plans', 'shared-execution-plan.md'), 'generated benchmark shared plan');

    const judgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(judgment.oracle.pass, true);
    assert.equal(judgment.findings.some((finding) => String(finding.summary || '').includes('unexpected new file outside narrow scope')), false);
  });

  it('falls back to cell-level phase artifacts when root worktree-artifacts is empty', () => {
    const root = mkTmp('pe-ask-fidelity-phase-fallback-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'phase-01', 'worktree-artifacts', 'src'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'phase-fallback',
      requirements: [
        { id: 'shared_builder', summary: 'shared builder', all_of: ['shared'], any_of: ['builder'], required: true }
      ]
    });

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 1,
      verified: 1
    });
    writeJson(path.join(cellDir, 'phase-01', 'phase-verdict.json'), {
      pass: true,
      warnings: [],
      decisions: []
    });
    fs.writeFileSync(path.join(cellDir, 'phase-01', 'worktree-artifacts', 'src', 'builder.js'), 'shared builder\n');

    const judgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(judgment.scores.ask_fidelity, 1);
  });

  it('skips oracle when no captured worktree artifacts exist anywhere in the cell', () => {
    const root = mkTmp('pe-ask-fidelity-no-artifacts-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts'), { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'phase-01'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'no-artifacts',
      requirements: [
        { id: 'req', summary: 'req', all_of: ['phase'], any_of: ['output'], required: true }
      ]
    });
    fs.writeFileSync(path.join(fixtureDir, 'oracle.js'), [
      "process.stdout.write(JSON.stringify({ pass: false, findings: [{ kind: 'oracle_fail', severity: 'high', summary: 'should not run' }] }));"
    ].join('\n'));

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 1,
      verified: 1
    });
    fs.writeFileSync(path.join(cellDir, 'README.md'), 'phase output evidence\n');

    const judgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(judgment.oracle, null);
    assert.equal(judgment.scores.ask_fidelity, 1);
  });

  it('does not treat explicitly negated forbidden phrases as blockers', () => {
    const corpus = [
      { path: 'docs/good.md', text: 'handler does NOT recompute from current state and must not widen preview' },
      { path: 'docs/bad.md', text: 'payload may recompute from current state when cache misses' }
    ];
    const hits = findForbiddenEvidence(corpus, ['recompute from current state']);
    assert.deepEqual(hits, ['docs/bad.md']);
  });

  it('does not treat trap-analysis forbidden phrases as shipped violations', () => {
    const corpus = [
      { path: 'docs/trap.md', text: 'Trap 3: using the export body as a handoff bundle widens the audience for raw private notes and is a wrong shortcut.' },
      { path: 'docs/contract.md', text: 'field must not appear if it would make the attestation a current-state shortcut.' },
      { path: 'docs/bad.md', text: 'customer summary includes raw private notes for account teams.' }
    ];
    const rawPrivateNotes = findForbiddenEvidence(corpus, ['raw private notes']);
    const currentStateShortcut = findForbiddenEvidence(corpus, ['current state shortcut']);
    assert.deepEqual(rawPrivateNotes, ['docs/bad.md']);
    assert.deepEqual(currentStateShortcut, []);
  });

  it('does not treat explanatory shortcut comments as shipped violations', () => {
    const corpus = [
      { path: 'tests/proof.test.js', text: 'A recompute-from-current-state shortcut would echo the mutation on a second call.' },
      { path: 'docs/good.md', text: 'Route points to frozen proof and final closure material.' }
    ];
    const snapshot = findForbiddenEvidence(corpus, ['recompute from current state']);
    const currentStateShortcut = findForbiddenEvidence(corpus, ['current state shortcut']);
    assert.deepEqual(snapshot, []);
    assert.deepEqual(currentStateShortcut, []);
  });

  it('does not treat refusal-to-recompute phrases as shipped violations', () => {
    const corpus = [
      { path: 'src/good.js', text: 'payloadSnapshot missing - refusing to recompute from current state' },
      { path: 'src/good-2.js', text: 'This function does not accept a repo and cannot perform a current-state recompute even if asked.' },
      { path: 'src/bad.js', text: 'fallback path may recompute from current state if the snapshot is absent' }
    ];
    const hits = findForbiddenEvidence(corpus, ['recompute from current state']);
    assert.deepEqual(hits, ['src/bad.js']);
  });

  it('matches snapshot provenance through camelCase and stored-snapshot variants', () => {
    const root = mkTmp('pe-ask-fidelity-camelcase-');
    const fixtureDir = path.join(root, 'fixture');
    const cellDir = path.join(root, 'cell');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.mkdirSync(path.join(cellDir, 'worktree-artifacts', 'src', 'replay'), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, 'original-ask.md'), 'ask');
    fs.writeFileSync(path.join(fixtureDir, 'evaluator-contract.md'), 'contract');
    fs.writeFileSync(path.join(fixtureDir, 'replay-prompt.md'), 'replay');
    writeJson(path.join(fixtureDir, 'judge-spec.json'), {
      scenario: 'camelcase-snapshot',
      requirements: [
        {
          id: 'snapshot_provenance',
          summary: 'Replay payload comes from stored snapshot',
          all_of: ['snapshot'],
          any_of: ['stored snapshot'],
          none_of: ['recompute from current state'],
          required: true
        }
      ]
    });

    writeJson(path.join(cellDir, 'outcome.json'), {
      judge: 'phase-verify-cli@v1',
      total_tasks: 1,
      verified: 1
    });
    fs.writeFileSync(
      path.join(cellDir, 'worktree-artifacts', 'src', 'replay', 'buildReplayPayload.js'),
      [
        "const SNAPSHOT_SOURCE = 'stored-snapshot';",
        'function buildReplayPayload({ storedSnapshot, payloadSnapshot }) {',
        '  if (!storedSnapshot && !payloadSnapshot) throw new Error("refusing to recompute from current state");',
        '  return { provenance: { source: SNAPSHOT_SOURCE }, storedSnapshot, payloadSnapshot };',
        '}'
      ].join('\n')
    );

    const judgment = buildAskFidelityJudgment(cellDir, fixtureDir);
    assert.equal(judgment.result, 'pass');
    assert.equal(judgment.requirements[0].passed, true);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sessionStartHook = path.join(repoRoot, 'hooks', 'session-start.js');
const postToolHook = path.join(repoRoot, 'hooks', 'post-tool.js');

function makeTempProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('session-start hook', () => {
  it('clears stale named stage when no ledger or plan is active', () => {
    const projectDir = makeTempProject('plan-enforcer-session-start-clear-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'discuss.md'), '# Packet\n');
    fs.writeFileSync(path.join(enforcerDir, 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 'stale-session'
    }, null, 2));

    const result = spawnSync(process.execPath, [sessionStartHook], {
      cwd: projectDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(path.join(enforcerDir, 'statusline-state.json')), false);
  });

  it('auto-activates a detected plan and creates a ledger', () => {
    const projectDir = makeTempProject('plan-enforcer-session-start-');
    const planDir = path.join(projectDir, 'docs', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'test-plan.md'), [
      '# Test plan',
      '',
      '### Task 1: Add auth route',
      '- [ ] Implement route',
      '- [ ] Verify curl returns 200',
      '',
      '### Task 2: Add tests',
      '- [ ] Add regression test',
      '- [ ] Verify tests pass'
    ].join('\n'));

    const result = spawnSync(process.execPath, [sessionStartHook], {
      cwd: projectDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PLAN ENFORCER ACTIVATED/);
    assert.match(result.stdout, /docs[\\/]+plans[\\/]+test-plan\.md/);

    const ledgerPath = path.join(projectDir, '.plan-enforcer', 'ledger.md');
    assert.equal(fs.existsSync(ledgerPath), true);
    const ledger = fs.readFileSync(ledgerPath, 'utf8');
    assert.match(ledger, /T1/);
    assert.match(ledger, /T2/);
  });

  it('does not re-activate when an archived run exists for the same plan with different path separators', () => {
    const projectDir = makeTempProject('plan-enforcer-session-start-archived-');
    const planDir = path.join(projectDir, 'docs', 'plans');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    const archiveDir = path.join(enforcerDir, 'archive');
    fs.mkdirSync(planDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'test-plan.md'), [
      '# Test plan',
      '',
      '- [ ] Ship feature',
      '- [ ] Verify feature'
    ].join('\n'));

    const archivePlanRef = path.sep === '\\'
      ? 'docs/plans/test-plan.md'
      : 'docs\\plans\\test-plan.md';
    fs.writeFileSync(path.join(archiveDir, '2026-04-20-test-plan.md'), [
      '---',
      `plan: ${archivePlanRef}`,
      'tier: structural',
      'tasks: 2',
      'verified: 2',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 0',
      'reconciliations: 0',
      'started: 2026-04-20T00:00:00Z',
      'completed: 2026-04-20T00:05:00Z',
      'result: clean',
      '---',
      '',
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      `<!-- source: ${archivePlanRef} -->`,
      '<!-- tier: structural -->',
      '',
      '## Scoreboard',
      ' 2 total  |  0 done  |  2 verified  |  0 skipped  |  0 blocked  |  0 remaining',
      ' Drift: 0  |  Last reconcile: none  |  Tier: structural',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Ship feature | verified | yes | | |',
      '| T2  | Verify feature | verified | yes | | |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, [sessionStartHook], {
      cwd: projectDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /PLAN ENFORCER ACTIVATED/);
    assert.equal(fs.existsSync(path.join(enforcerDir, 'ledger.md')), false);
  });

  it('emits ordered resume packet for enforced benchmark resumes', () => {
    const projectDir = makeTempProject('plan-enforcer-session-resume-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: enforced',
      'reconcile_interval: 5',
      'stale_threshold: 0',
      'completion_gate: hard',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/shared-execution-plan.md -->',
      '<!-- tier: enforced -->',
      '<!-- created: 2026-04-14T12:00:00Z -->',
      '',
      '## Scoreboard',
      ' 15 total  |  0 done  |  10 verified  |  0 skipped  |  0 blocked  |  5 remaining  |  0 in-progress',
      ' Drift: 0  |  Last reconcile: R8  |  Tier: enforced',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | A | verified | yes | | |',
      '| T2  | B | verified | yes | | |',
      '| T3  | C | verified | yes | | |',
      '| T4  | D | verified | yes | | |',
      '| T5  | E | verified | yes | | |',
      '| T6  | F | verified | yes | | |',
      '| T7  | G | verified | yes | | |',
      '| T8  | H | verified | yes | | |',
      '| T9  | I | verified | yes | | |',
      '| T10 | J | verified | yes | | |',
      '| T11 | Unit Tests | pending | | | |',
      '| T12 | Auth Tests | pending | | | |',
      '| T13 | Search Tests | pending | | | |',
      '| T14 | Refactor | pending | | | |',
      '| T15 | Final Verify | pending | | | |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|',
      '| R8    | T1-T15 | 0 | Ready for resume |'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'resume.md'), [
      '# Resume Snapshot',
      '',
      '- Completed rows: 10/15',
      '- Remaining rows: 5',
      '- Next row: T11 [pending] Unit Tests',
      '- Open rows: T11 [pending] Unit Tests; T12 [pending] Auth Tests; T13 [pending] Search Tests; T14 [pending] Refactor; T15 [pending] Final Verify'
    ].join('\n'));

    const result = spawnSync(process.execPath, [sessionStartHook], {
      cwd: projectDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /ORDER TO EXECUTE \(from \.plan-enforcer\/resume\.md\):/);
    assert.match(result.stdout, /1\. Finish T11 \[pending\] Unit Tests/);
    assert.match(result.stdout, /2\. Then T12 \[pending\] Auth Tests/);
    assert.match(result.stdout, /Start with T11\. Keep one active row at a time; no separate claim edit is required before planned workspace work\./);
    assert.match(result.stdout, /Completion still means 0 remaining rows and archive-ready ledger state/);
  });

  it('advisory startup guidance stays lightweight', () => {
    const projectDir = makeTempProject('plan-enforcer-session-advisory-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: advisory',
      'reconcile_interval: 50',
      'stale_threshold: 999',
      'completion_gate: soft',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/test.md -->',
      '<!-- tier: advisory -->',
      '',
      '## Scoreboard',
      ' 4 total  |  0 done  |  1 verified  |  0 skipped  |  0 blocked  |  3 remaining  |  0 in-progress',
      ' Drift: 0  |  Last reconcile: none  |  Tier: advisory',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | A    | verified | yes | | |',
      '| T2  | B    | pending  |     | | |',
      '| T3  | C    | pending  |     | | |',
      '| T4  | D    | pending  |     | | |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, [sessionStartHook], {
      cwd: projectDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Protocol: execute in meaningful chunks/);
    assert.match(result.stdout, /GATE: soft close allowed/);
    assert.doesNotMatch(result.stdout, /Do not end the session while any row is pending/i);
  });

  it('surfaces prior phase context when present', () => {
    const projectDir = makeTempProject('plan-enforcer-session-context-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: structural',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: soft',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/test.md -->',
      '<!-- tier: structural -->',
      '',
      '## Scoreboard',
      ' 1 total  |  0 done  |  0 verified  |  0 skipped  |  0 blocked  |  1 remaining  |  0 in-progress',
      ' Drift: 0  |  Last reconcile: none  |  Tier: structural',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | A    | pending  |     | | |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'phase-context.md'), [
      '# Phase Context',
      '',
      '- Source: docs/plans/shared-execution-plan.md',
      '- Tier: structural',
      '- Archive: archive/2026-04-16-shared-execution-plan.md',
      '- Completed rows: 4',
      '- Focus files: src/app.js; src/store/note-store.js; test/notes.test.js',
      '- Verification: npm test'
    ].join('\n'));

    const result = spawnSync(process.execPath, [sessionStartHook], {
      cwd: projectDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Recent phase context: \.plan-enforcer\/phase-context\.md/);
    assert.match(result.stdout, /Focus files: src\/app\.js; src\/store\/note-store\.js; test\/notes\.test\.js/);
    assert.match(result.stdout, /Verification: npm test/);
  });
});

describe('post-tool hook', () => {
  it('auto-activates on markdown plan reads and emits hook context JSON', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-');
    const planDir = path.join(projectDir, 'docs', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"hook-fixture"}\n');
    const planPath = path.join(planDir, 'read-trigger.md');
    fs.writeFileSync(planPath, [
      '# Trigger plan',
      '',
      '### Task 1: Add middleware',
      '- [ ] Implement middleware',
      '- [ ] Verify route rejects missing auth',
      '',
      '### Task 2: Add tests',
      '- [ ] Add regression test',
      '- [ ] Verify tests pass'
    ].join('\n'));

    const payload = JSON.stringify({
      tool_name: 'Read',
      tool_input: {
        file_path: planPath
      }
    });

    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: payload
    });

    assert.equal(result.status, 0);
    assert.ok(result.stdout);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.match(output, /PLAN ENFORCER ACTIVATED \(Read-trigger\)/);
    assert.match(output, /read-trigger\.md/);

    const ledgerPath = path.join(projectDir, '.plan-enforcer', 'ledger.md');
    assert.equal(fs.existsSync(ledgerPath), true);
  });

  it('archives a completed ledger and removes working files', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-complete-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: enforced',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: soft',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Plan Enforcer Ledger',
      '<!-- source: docs/plans/done.md -->',
      '<!-- tier: enforced -->',
      '<!-- created: 2026-04-11T10:00:00Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task    | Status   | Evidence | Notes |',
      '|-----|---------|----------|----------|-------|',
      '| T1  | Do thing | verified | yes      |       |',
      '| T2  | Do more  | verified | yes      |       |',
      '',
      '## Decision Log',
      '',
      '| ID | Task Ref | Decision | Reason |',
      '|----|----------|----------|--------|',
      '| D1 | T2       | drift    | Extra proof |',
      '',
      '## Reconciliation History',
      '',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|',
      '| R1    | T1-T2         | 0          | All clear    |'
    ].join('\n'));
    fs.writeFileSync(path.join(enforcerDir, '.session-log.jsonl'), [
      JSON.stringify({ tool: 'Write', input: { file_path: path.join(projectDir, 'src', 'app.js') } }),
      JSON.stringify({ tool: 'Edit', input: { file_path: path.join(projectDir, 'test', 'app.test.js') } }),
      JSON.stringify({ tool: 'Bash', input: { command: 'npm test' } })
    ].join('\n') + '\n');

    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: path.join(projectDir, 'README.md') } })
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.match(output, /Plan Enforcer \(COMPLETE\)/);
    assert.match(output, /Archived: \.plan-enforcer\/archive\//);

    const archiveDir = path.join(enforcerDir, 'archive');
    const archives = fs.readdirSync(archiveDir).filter((name) => name.endsWith('.md') && !name.endsWith('.verdict.md'));
    assert.equal(archives.length, 1);
    assert.equal(fs.existsSync(path.join(enforcerDir, 'ledger.md')), false);
    const phaseContext = fs.readFileSync(path.join(enforcerDir, 'phase-context.md'), 'utf8');
    assert.match(phaseContext, /Focus files: src\/app\.js; test\/app\.test\.js/);
    assert.match(phaseContext, /Verification: npm test/);
    const phaseVerdict = JSON.parse(fs.readFileSync(path.join(enforcerDir, 'phase-verdict.json'), 'utf8'));
    assert.equal(phaseVerdict.pass, true);
    assert.equal(phaseVerdict.totals.verified, 2);
    const phaseReport = fs.readFileSync(path.join(enforcerDir, 'phase-report.md'), 'utf8');
    assert.match(phaseReport, /# Phase Verify Report/);
    assert.match(phaseReport, /Verified rows: 2\/2/);
    const archivePath = path.join(archiveDir, archives[0]);
    assert.equal(fs.existsSync(`${archivePath}.verdict.json`), true);
    assert.equal(fs.existsSync(`${archivePath}.verdict.md`), true);
  });

  it('allows final-stretch workspace edits without a separate claim ritual', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-closeout-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: enforced',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: hard',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Plan Enforcer Ledger',
      '<!-- source: docs/plans/test.md -->',
      '<!-- tier: enforced -->',
      '<!-- created: 2026-04-14T12:00:00Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task           | Status      | Evidence | Notes |',
      '|-----|----------------|-------------|----------|-------|',
      '| T1  | Earlier task    | verified    | yes      |       |',
      '| T2  | Current task    | verified    | yes      |       |',
      '| T3  | Next task       | pending     |          |       |',
      '| T4  | Later task      | pending     |          |       |',
      '| T5  | Final verify    | pending     |          |       |',
      '',
      '## Decision Log',
      '',
      '| ID | Task Ref | Decision | Reason |',
      '|----|----------|----------|--------|',
      '',
      '## Reconciliation History',
      '',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const targetFile = path.join(projectDir, 'src', 'feature.js');
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, 'console.log("hi");\n');

    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: targetFile } })
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.match(output, /Plan Enforcer \[closeout-next\]: T3 \[pending\] Next task/);
    assert.doesNotMatch(output, /\[block\]: T3 is still pending in the ledger/);
  });

  it('emits focus guidance, not claim ritual, on ledger edits that enter final stretch', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-closeout-enter-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: enforced',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: hard',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    const ledgerPath = path.join(enforcerDir, 'ledger.md');
    const oldScore = ' 15 total  |  0 done  |  10 verified  |  0 skipped  |  0 blocked  |  6 remaining  |  0 in-progress';
    const newScore = ' 15 total  |  0 done  |  10 verified  |  0 skipped  |  0 blocked  |  5 remaining  |  0 in-progress';
    fs.writeFileSync(ledgerPath, [
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/test.md -->',
      '<!-- tier: enforced -->',
      '<!-- created: 2026-04-14T12:00:00Z -->',
      '',
      '## Scoreboard',
      newScore,
      ' Drift: 0  |  Last reconcile: R8  |  Tier: enforced',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task           | Status   | Evidence | Chain | Notes |',
      '|-----|----------------|----------|----------|-------|-------|',
      '| T1  | A              | verified | yes      |       |       |',
      '| T2  | B              | verified | yes      |       |       |',
      '| T3  | C              | verified | yes      |       |       |',
      '| T4  | D              | verified | yes      |       |       |',
      '| T5  | E              | verified | yes      |       |       |',
      '| T6  | F              | verified | yes      |       |       |',
      '| T7  | G              | verified | yes      |       |       |',
      '| T8  | H              | verified | yes      |       |       |',
      '| T9  | I              | verified | yes      |       |       |',
      '| T10 | J              | verified | yes      |       |       |',
      '| T11 | K              | pending  |          |       |       |',
      '| T12 | L              | pending  |          |       |       |',
      '| T13 | M              | pending  |          |       |       |',
      '| T14 | N              | pending  |          |       |       |',
      '| T15 | O              | pending  |          |       |       |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: ledgerPath, old_string: oldScore, new_string: newScore }
      })
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.match(output, /Plan Enforcer \[closeout-next\]: T11 \[pending\] K/);
    assert.match(output, /Plan Enforcer \[closeout-focus\]: final stretch active\. T11 is next; keep work aligned and fold the row update into the next real ledger edit\./);
    assert.doesNotMatch(output, /closeout-claim/);
  });

  it('structural post-tool guidance omits ledger hash prefix', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-structural-hash-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: structural',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: soft',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    const ledgerPath = path.join(enforcerDir, 'ledger.md');
    fs.writeFileSync(ledgerPath, [
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/test.md -->',
      '<!-- tier: structural -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Only | pending |         |       |       |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|'
    ].join('\n'));

    // A drift-triggering edit on an unreferenced file forces the hook to emit
    // guidance (drift warning), so the hash-prefix branch runs.
    const strayFile = path.join(projectDir, 'stray.js');
    fs.writeFileSync(strayFile, 'module.exports = {};\n');
    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: strayFile } })
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.doesNotMatch(output, /Plan Enforcer \[state\]: ledger hash [0-9a-f]{8}\./);
  });

  it('enforced post-tool guidance still prefixes current ledger hash when there is guidance to emit', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-enforced-hash-');
    const enforcerDir = path.join(projectDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    fs.writeFileSync(path.join(enforcerDir, 'config.md'), [
      '---',
      'tier: enforced',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: hard',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));

    const ledgerPath = path.join(enforcerDir, 'ledger.md');
    fs.writeFileSync(ledgerPath, [
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/test.md -->',
      '<!-- tier: enforced -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Only | pending |         |       |       |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|'
    ].join('\n'));

    const strayFile = path.join(projectDir, 'stray.js');
    fs.writeFileSync(strayFile, 'module.exports = {};\n');
    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: strayFile } })
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.match(output, /Plan Enforcer \[state\]: ledger hash [0-9a-f]{8}\./);
    assert.match(output, /skip the re-read before the next task/);
  });

  it('emits consolidated-edit guidance on auto-activation (no per-task re-read step)', () => {
    const projectDir = makeTempProject('plan-enforcer-post-tool-consolidated-');
    const planDir = path.join(projectDir, 'docs', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"hook-fixture"}\n');
    const planPath = path.join(planDir, 'consolidated.md');
    fs.writeFileSync(planPath, [
      '# Plan',
      '',
      '### Task 1: First',
      '- [ ] Step',
      '',
      '### Task 2: Second',
      '- [ ] Step'
    ].join('\n'));

    const result = spawnSync(process.execPath, [postToolHook], {
      cwd: projectDir,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: planPath } })
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const output = parsed.hookSpecificOutput.additionalContext;
    assert.match(output, /ONE atomic Edit/);
    assert.match(output, /single diff/);
    assert.ok(!/Re-read the ledger file/.test(output), 'per-task re-read step should be gone');
    assert.ok(!/Print scoreboard after each update/.test(output), 'standalone scoreboard step should be gone');
    assert.match(output, /No separate claim edit is required before planned workspace work\./);
  });
});

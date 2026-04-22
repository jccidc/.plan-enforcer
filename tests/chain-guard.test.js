const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'chain-guard.js');

function mkProject(tier, plannedPathContent, ledgerExtras) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-chainguard-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  if (plannedPathContent !== null) {
    fs.writeFileSync(path.join(dir, 'docs', 'plans', 'plan.md'), plannedPathContent);
  }

  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), `---\ntier: ${tier}\n---\n`);
  const ledger = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/plan.md -->
<!-- tier: ${tier} -->
<!-- created: 2026-04-12T00:00:00Z -->

## Task Ledger

| ID  | Task   | Status  | Evidence | Chain | Notes |
|-----|--------|---------|----------|-------|-------|
| T1  | Build  | pending |          |       |       |

## Decision Log

| ID | Type      | Scope | Reason | Evidence |
|----|-----------|-------|--------|----------|
${ledgerExtras || ''}

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger);
  return dir;
}

function runHook(cwd, toolName, toolInput) {
  const stdinPayload = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      cwd,
      input: stdinPayload,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stdout: stdout.toString(), stderr: '' };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout || Buffer.from('')).toString(),
      stderr: (e.stderr || Buffer.from('')).toString()
    };
  }
}

const PLAN_WITH_FILES = `# Plan

Task 1: build the thing.

- Create \`src/app.ts\` with express setup
- Add \`src/auth.ts\` for middleware
- Tests in \`tests/app.test.js\`
`;

describe('chain-guard — silent pass-through', () => {
  it('no enforcer dir => allow', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-noguard-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    const r = runHook(dir, 'Edit', { file_path: 'src/app.ts' });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });

  it('tool_name outside guarded set => allow', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'Read', { file_path: 'src/whatever.ts' });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });

  it('.plan-enforcer/ control files are never guarded', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'Edit', { file_path: '.plan-enforcer/ledger.md' });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });

  it('missing source plan => audit (option #3 fallback)', () => {
    const dir = mkProject('enforced', null); // no plan file
    const r = runHook(dir, 'Edit', { file_path: 'src/anything.ts' });
    assert.equal(r.code, 0, 'should not block');
    assert.match(r.stdout, /chain-guard disabled/);
  });

  it('empty plan (no extractable paths) => audit (option #3)', () => {
    const dir = mkProject('enforced', '# Plan\n\nJust prose. No paths mentioned.\n');
    const r = runHook(dir, 'Edit', { file_path: 'src/app.ts' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /chain-guard disabled/);
  });
});

describe('chain-guard — planned file allows', () => {
  it('planned file in enforced tier => allow', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'Edit', { file_path: 'src/app.ts' });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });

  it('planned file under nested path (suffix match) => allow', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'Write', { file_path: 'project/src/app.ts' });
    assert.equal(r.code, 0);
  });

  it('Write tool on planned file => allow', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'Write', { file_path: 'tests/app.test.js' });
    assert.equal(r.code, 0);
  });
});

describe('chain-guard — unplanned edits by tier', () => {
  it('advisory: audits, does not block', () => {
    const dir = mkProject('advisory', PLAN_WITH_FILES);
    const r = runHook(dir, 'Edit', { file_path: 'src/new.ts' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[audit\]/);
  });

  it('structural: warns, does not block', () => {
    const dir = mkProject('structural', PLAN_WITH_FILES);
    const r = runHook(dir, 'Edit', { file_path: 'src/new.ts' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[warn\]/);
  });

  it('enforced: blocks with non-zero exit', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'Edit', { file_path: 'src/new.ts' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /\[block\]/);
    assert.match(r.stderr, /Decision Log row/);
  });
});

describe('chain-guard — Decision Log overrides the block', () => {
  it('D-row with matching scope => allow at enforced', () => {
    const dlogRows = '| D1 | unplanned | src/new.ts | needed by T1 logger debug | pending |\n';
    const dir = mkProject('enforced', PLAN_WITH_FILES, dlogRows);
    const r = runHook(dir, 'Edit', { file_path: 'src/new.ts' });
    assert.equal(r.code, 0, `expected allow, got stderr=${r.stderr}`);
  });
});

describe('chain-guard — MultiEdit + NotebookEdit support', () => {
  it('MultiEdit on unplanned file blocks at enforced', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'MultiEdit', { file_path: 'src/mystery.ts', edits: [] });
    assert.equal(r.code, 2);
  });

  it('NotebookEdit uses notebook_path', () => {
    const dir = mkProject('enforced', PLAN_WITH_FILES);
    const r = runHook(dir, 'NotebookEdit', { notebook_path: 'notebooks/unplanned.ipynb' });
    assert.equal(r.code, 2);
  });
});

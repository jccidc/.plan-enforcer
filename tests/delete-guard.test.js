const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'delete-guard.js');

function mkProject(tier, dlogRows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-del-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }));

  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), `---\ntier: ${tier}\n---\n`);

  const ledger = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p.md -->

## Task Ledger

| ID  | Task   | Status  | Evidence | Chain | Notes |
|-----|--------|---------|----------|-------|-------|
| T1  | Build  | pending |          |       |       |

## Decision Log

| ID | Type      | Scope | Reason | Evidence |
|----|-----------|-------|--------|----------|
${dlogRows || ''}

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger);
  return dir;
}

function runHook(cwd, toolName, toolInput) {
  const stdin = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      cwd,
      input: stdin,
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

describe('delete-guard — Bash rm', () => {
  it('enforced: rm without D-row blocks', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'rm src/legacy.ts' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /\[block\]/);
    assert.match(r.stderr, /src\/legacy\.ts/);
  });

  it('enforced: rm -rf blocks', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'rm -rf build/' });
    assert.equal(r.code, 2);
  });

  it('enforced: rm with matching delete D-row allows', () => {
    const dlog = '| D1 | delete | src/legacy.ts | T1 said replace | commit abc |\n';
    const dir = mkProject('enforced', dlog);
    const r = runHook(dir, 'Bash', { command: 'rm src/legacy.ts' });
    assert.equal(r.code, 0);
  });

  it('enforced: directory scope in D-row covers nested files', () => {
    const dlog = '| D1 | delete | src/legacy/ | replace whole dir | pending |\n';
    const dir = mkProject('enforced', dlog);
    const r = runHook(dir, 'Bash', { command: 'rm src/legacy/old.ts' });
    assert.equal(r.code, 0, `expected allow; stderr=${r.stderr}`);
  });

  it('structural: rm without D-row blocks (hard integrity break)', () => {
    const dir = mkProject('structural');
    const r = runHook(dir, 'Bash', { command: 'rm foo.ts' });
    assert.equal(r.code, 2);
  });

  it('advisory: rm audits, never blocks', () => {
    const dir = mkProject('advisory');
    const r = runHook(dir, 'Bash', { command: 'rm foo.ts' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[audit\]/);
  });
});

describe('delete-guard — Bash git rm / git clean -f', () => {
  it('git rm without D-row blocks at enforced', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'git rm src/old.ts' });
    assert.equal(r.code, 2);
  });

  it('git clean -f blocks at enforced (applies to cwd)', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'git clean -fd' });
    assert.equal(r.code, 2);
  });

  it('git clean without -f is a no-op (safe command)', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'git clean -n' });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });
});

describe('delete-guard — Edit / MultiEdit deletions', () => {
  it('Edit emptying new_string counts as deletion', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Edit', {
      file_path: 'src/foo.ts',
      old_string: 'export function foo() { return 1; }\nexport function bar() { return 2; }',
      new_string: ''
    });
    assert.equal(r.code, 2);
  });

  it('Edit removing >50% triggers deletion check', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Edit', {
      file_path: 'src/big.ts',
      old_string: 'a'.repeat(100),
      new_string: 'b'.repeat(30)
    });
    assert.equal(r.code, 2);
  });

  it('Edit with small deletion (under threshold) is allowed', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Edit', {
      file_path: 'src/min.ts',
      old_string: 'a'.repeat(100),
      new_string: 'b'.repeat(80)
    });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });

  it('MultiEdit with any full removal triggers', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'MultiEdit', {
      file_path: 'src/multi.ts',
      edits: [
        { old_string: 'xxx', new_string: 'yyy' },
        { old_string: 'significant chunk of code...', new_string: '' }
      ]
    });
    assert.equal(r.code, 2);
  });

  it('Edit with matching delete D-row allows', () => {
    const dlog = '| D1 | delete | src/foo.ts | T1 clean slate | commit abc |\n';
    const dir = mkProject('enforced', dlog);
    const r = runHook(dir, 'Edit', {
      file_path: 'src/foo.ts',
      old_string: 'lots of stuff here',
      new_string: ''
    });
    assert.equal(r.code, 0);
  });
});

describe('delete-guard — silent pass-through', () => {
  it('no enforcer dir => allow', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-nodel-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    const r = runHook(dir, 'Bash', { command: 'rm anything.ts' });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
  });

  it('non-delete Bash command => allow', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'ls -la' });
    assert.equal(r.code, 0);
  });

  it('.plan-enforcer/ paths are never guarded', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Bash', { command: 'rm .plan-enforcer/.session-log.jsonl' });
    assert.equal(r.code, 0);
  });

  it('non-guarded tool returns immediately', () => {
    const dir = mkProject('enforced');
    const r = runHook(dir, 'Read', { file_path: 'anything.ts' });
    assert.equal(r.code, 0);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'plan-close.js');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-pclose-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts: {} }, null, 2));
  try {
    execSync('git init -q', { cwd: dir, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir, stdio: 'ignore' });
  } catch (_err) {
    // non-git env is fine; hook should still function
  }
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer, { recursive: true });
  fs.mkdirSync(path.join(enforcer, 'proof'), { recursive: true });
  // Copy the receipt CLI into the local tree position the hook looks for.
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'receipt-cli.js'), path.join(srcDir, 'receipt-cli.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'ledger-parser.js'), path.join(srcDir, 'ledger-parser.js'));
  return dir;
}

function writeLedger(dir, tasks) {
  const enforcer = path.join(dir, '.plan-enforcer');
  const rows = tasks.map((t) => `| ${t.id} | ${t.name} | ${t.status} | ${t.evidence || ''} |  |  |`).join('\n');
  const content = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/demo.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
${rows}

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), content, 'utf8');
  return content;
}

function runHook(dir, payload) {
  const stdin = JSON.stringify(payload || {});
  try {
    const out = execFileSync(process.execPath, [HOOK], { cwd: dir, input: stdin, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout || Buffer.from('')).toString(),
      stderr: (e.stderr || Buffer.from('')).toString()
    };
  }
}

function proofFiles(dir) {
  return fs.readdirSync(path.join(dir, '.plan-enforcer', 'proof'))
    .filter((name) => name.startsWith('closure-'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProof(dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proofFiles(dir).length > 0) return true;
    await sleep(30);
  }
  return false;
}

describe('plan-close hook', () => {
  it('does nothing when tool_input is not ledger.md', () => {
    const dir = mkProject();
    writeLedger(dir, [{ id: 'T1', name: 'done', status: 'verified', evidence: 'ok' }]);
    const result = runHook(dir, {
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'README.md') }
    });
    assert.equal(result.code, 0);
    assert.equal(proofFiles(dir).length, 0);
  });

  it('emits receipt on close-transition edit', async () => {
    const dir = mkProject();
    writeLedger(dir, [{ id: 'T1', name: 'done', status: 'verified', evidence: 'ok' }]);
    const result = runHook(dir, {
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(result.code, 0);
    const ok = await waitForProof(dir, 4000);
    assert.ok(ok, 'expected receipt file in proof dir');
    assert.equal(proofFiles(dir).length, 1);
    const hashFile = path.join(dir, '.plan-enforcer', '.last-close-hash');
    assert.ok(fs.existsSync(hashFile));
  });

  it('is idempotent on no-op repeat', async () => {
    const dir = mkProject();
    writeLedger(dir, [{ id: 'T1', name: 'done', status: 'verified', evidence: 'ok' }]);
    runHook(dir, { tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') } });
    await waitForProof(dir, 4000);
    const countAfterFirst = proofFiles(dir).length;
    runHook(dir, { tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') } });
    await sleep(500);
    const countAfterSecond = proofFiles(dir).length;
    assert.equal(countAfterSecond, countAfterFirst, 'should not emit a duplicate receipt on no-op');
  });

  it('does not emit when plan is still open', async () => {
    const dir = mkProject();
    writeLedger(dir, [
      { id: 'T1', name: 'done', status: 'verified', evidence: 'ok' },
      { id: 'T2', name: 'still pending', status: 'pending' }
    ]);
    runHook(dir, { tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') } });
    await sleep(400);
    assert.equal(proofFiles(dir).length, 0);
  });

  it('exits 0 on malformed ledger without crashing', () => {
    const dir = mkProject();
    const enforcer = path.join(dir, '.plan-enforcer');
    fs.writeFileSync(path.join(enforcer, 'ledger.md'), '{{{not a valid ledger}}}');
    const result = runHook(dir, { tool_name: 'Edit', tool_input: { file_path: path.join(enforcer, 'ledger.md') } });
    assert.equal(result.code, 0);
    assert.equal(proofFiles(dir).length, 0);
  });

  it('ignores unrelated tool names', () => {
    const dir = mkProject();
    writeLedger(dir, [{ id: 'T1', name: 'done', status: 'verified', evidence: 'ok' }]);
    const result = runHook(dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') } });
    assert.equal(result.code, 0);
    assert.equal(proofFiles(dir).length, 0);
  });

  it('respects closed-plan definition across superseded rows', async () => {
    const dir = mkProject();
    writeLedger(dir, [
      { id: 'T1', name: 'prior plan task', status: 'superseded' },
      { id: 'T2', name: 'new plan task', status: 'verified', evidence: 'ok' }
    ]);
    runHook(dir, { tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') } });
    await waitForProof(dir, 4000);
    assert.equal(proofFiles(dir).length, 1);
  });
});

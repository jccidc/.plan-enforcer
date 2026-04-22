const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-chainab-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }, null, 2));
  try {
    execSync('git init -q', { cwd: dir, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir, stdio: 'ignore' });
  } catch (_err) { /* ok */ }
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(path.join(enforcer, 'proof'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'demo.md'), '# demo\n');
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  for (const mod of ['abandon-cli.js', 'receipt-cli.js', 'ledger-parser.js', 'archive.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'src', mod), path.join(srcDir, mod));
  }
  return dir;
}

function writeClosedLedger(dir) {
  const content = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/demo.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
| T1 | work | verified | built |  |  |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), content, 'utf8');
}

function writeOpenLedger(dir) {
  const content = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/demo.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
| T1 | work | pending |  |  |  |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), content, 'utf8');
}

function run(cwd, bin, args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(cwd, 'src', bin), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || Buffer.from('')).toString(), stderr: (e.stderr || Buffer.from('')).toString() };
  }
}

describe('abandon-cli chain-walkability', () => {
  it('abandonment receipt links to prior closure receipt for same plan-slug', () => {
    const dir = mkProject();

    // Step 1: close the plan normally and emit a closure receipt via receipt-cli.
    writeClosedLedger(dir);
    const first = run(dir, 'receipt-cli.js', []);
    assert.equal(first.code, 0, `stderr=${first.stderr}`);
    const firstReceiptPath = first.stdout.trim();
    assert.ok(fs.existsSync(firstReceiptPath));

    // Clear the ledger (simulate a hard close), then reopen with a fresh pending task.
    fs.unlinkSync(path.join(dir, '.plan-enforcer', 'ledger.md'));
    writeOpenLedger(dir);

    // Step 2: abandon the reopened plan; a new receipt should link to the first.
    const second = run(dir, 'abandon-cli.js', ['--reason', 'second close -- abandoning']);
    assert.equal(second.code, 0, `stderr=${second.stderr}`);
    const m = second.stdout.match(/receipt:\s+(.+)/);
    assert.ok(m, 'receipt path printed');
    const secondReceiptPath = m[1].trim();
    const secondBody = fs.readFileSync(secondReceiptPath, 'utf8');
    const priorMatch = secondBody.match(/## Prior closure\n([\s\S]*?)\n\n## /);
    assert.ok(priorMatch, 'Prior closure section present');
    const firstFilename = path.basename(firstReceiptPath);
    assert.ok(priorMatch[1].includes(firstFilename), `Prior closure should reference ${firstFilename}`);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'src', 'abandon-cli.js');

function mkProject(tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-abandon-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts: {} }, null, 2));
  try {
    execSync('git init -q', { cwd: dir, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir, stdio: 'ignore' });
  } catch (_err) { /* ok without git */ }
  const enforcerDir = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcerDir, { recursive: true });
  fs.mkdirSync(path.join(enforcerDir, 'proof'), { recursive: true });
  const plansDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(path.join(plansDir, 'demo.md'), '# demo plan\n');
  // Copy src modules the CLI requires into dir/src so require resolution works.
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  for (const mod of ['abandon-cli.js', 'receipt-cli.js', 'ledger-parser.js', 'archive.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'src', mod), path.join(srcDir, mod));
  }
  // Also config is referenced by archive.js -- copy it even if we do not use config.md.
  const configMod = path.join(__dirname, '..', 'src', 'config.js');
  if (fs.existsSync(configMod)) {
    fs.copyFileSync(configMod, path.join(srcDir, 'config.js'));
  }
  writeLedger(enforcerDir, tasks);
  return dir;
}

function writeLedger(enforcerDir, tasks) {
  const rows = tasks.map((t) => `| ${t.id} | ${t.name} | ${t.status} | ${t.evidence || ''} |  |  |`).join('\n');
  const ledger = `# Plan Enforcer Ledger
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
  fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), ledger, 'utf8');
}

function run(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(cwd, 'src', 'abandon-cli.js'), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout || Buffer.from('')).toString(),
      stderr: (e.stderr || Buffer.from('')).toString()
    };
  }
}

describe('abandon-cli end-to-end', () => {
  it('happy path writes archive + receipt, removes ledger', () => {
    const dir = mkProject([
      { id: 'T1', name: 'pending-one', status: 'pending' },
      { id: 'T2', name: 'verified-one', status: 'verified', evidence: 'built' },
      { id: 'T3', name: 'pending-two', status: 'pending' }
    ]);
    const result = run(dir, ['--reason', 'scope changed -- pivot']);
    assert.equal(result.code, 0, `stderr=${result.stderr}`);
    assert.match(result.stdout, /archive: /);
    assert.match(result.stdout, /receipt: /);

    const archivePaths = fs.readdirSync(path.join(dir, '.plan-enforcer', 'archive'));
    assert.equal(archivePaths.length, 1);
    const archiveContent = fs.readFileSync(path.join(dir, '.plan-enforcer', 'archive', archivePaths[0]), 'utf8');
    assert.match(archiveContent, /\| T1 \| pending-one \| superseded \| abandoned: scope changed/);
    assert.match(archiveContent, /\| T3 \| pending-two \| superseded \| abandoned: scope changed/);
    assert.match(archiveContent, /\| T2 \| verified-one \| verified \| built/);
    assert.match(archiveContent, /\| D1 \| pivot \| T1, T3 \| Plan abandoned: scope changed/);

    const receiptPaths = fs.readdirSync(path.join(dir, '.plan-enforcer', 'proof'));
    const closures = receiptPaths.filter((n) => n.startsWith('closure-'));
    assert.equal(closures.length, 1);

    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', 'ledger.md')), false);
  });

  it('missing --reason exits 2 and leaves ledger untouched', () => {
    const dir = mkProject([{ id: 'T1', name: 'work', status: 'pending' }]);
    const before = fs.readFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), 'utf8');
    const result = run(dir, []);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--reason required/);
    const after = fs.readFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), 'utf8');
    assert.equal(after, before);
  });

  it('missing ledger exits 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-abandon-noledger-'));
    const enforcer = path.join(dir, '.plan-enforcer');
    fs.mkdirSync(enforcer, { recursive: true });
    // no ledger.md
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    for (const mod of ['abandon-cli.js', 'receipt-cli.js', 'ledger-parser.js', 'archive.js']) {
      fs.copyFileSync(path.join(__dirname, '..', 'src', mod), path.join(srcDir, mod));
    }
    const result = run(dir, ['--reason', 'test']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no active plan to abandon/);
  });

  it('already-closed ledger exits 2', () => {
    const dir = mkProject([{ id: 'T1', name: 'done', status: 'verified', evidence: 'ok' }]);
    const result = run(dir, ['--reason', 'test']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no active plan to abandon/);
  });

  it('idempotent: second run after success exits 2 (no active plan)', () => {
    const dir = mkProject([{ id: 'T1', name: 'work', status: 'pending' }]);
    const first = run(dir, ['--reason', 'first']);
    assert.equal(first.code, 0, `stderr=${first.stderr}`);
    const second = run(dir, ['--reason', 'second']);
    assert.equal(second.code, 2);
    assert.match(second.stderr, /no active plan to abandon/);
  });
});

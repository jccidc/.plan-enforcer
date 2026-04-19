const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'session-start.js');

const LEDGER_V2_PENDING = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task  | Status  | Evidence | Chain | Notes |
|----|-------|---------|----------|-------|-------|
| T1 | Build | pending |          |       |       |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;

function mkProject(ledgerContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-stale-edge-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  fs.mkdirSync(path.join(dir, '.git'));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: structural\n---\n');
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledgerContent);
  return dir;
}

function runStart(cwd) {
  try {
    const out = execFileSync(process.execPath, [HOOK], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || Buffer.from('')).toString(), stderr: (e.stderr || Buffer.from('')).toString() };
  }
}

function age(filePath, daysAgo) {
  const ms = Date.now() - daysAgo * 86400000;
  fs.utimesSync(filePath, new Date(ms), new Date(ms));
}

describe('stale-ledger edge cases — T8 closure', () => {
  it('within-threshold edit (< 10 min) does not warn', () => {
    const dir = mkProject(LEDGER_V2_PENDING);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'fresh.ts'), 'x');
    // Both files stamped to ~now; the src file is newer by milliseconds only.
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout));
  });

  it('ignores node_modules even with newer mtime', () => {
    const dir = mkProject(LEDGER_V2_PENDING);
    age(path.join(dir, '.plan-enforcer', 'ledger.md'), 2);
    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'x');
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout), 'node_modules should not trigger stale');
  });

  it('non-code extensions are ignored', () => {
    const dir = mkProject(LEDGER_V2_PENDING);
    age(path.join(dir, '.plan-enforcer', 'ledger.md'), 2);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'data.json'), '{}');
    // JSON isn't in our scan list; stale shouldn't fire
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout));
  });

  it('advisory tier still shows the warning (always advisory, never block)', () => {
    const dir = mkProject(LEDGER_V2_PENDING);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'config.md'), '---\ntier: advisory\n---\n');
    age(path.join(dir, '.plan-enforcer', 'ledger.md'), 2);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    const r = runStart(dir);
    assert.match(r.stdout, /STALE LEDGER WARNING/);
    assert.equal(r.code, 0, 'never blocks regardless of tier');
  });
});

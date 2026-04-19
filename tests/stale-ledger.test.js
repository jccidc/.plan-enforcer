const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'session-start.js');

const V2_LEDGER_WITH_PENDING = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p.md -->
<!-- tier: structural -->

## Task Ledger

| ID | Task  | Status  | Evidence | Chain | Notes |
|----|-------|---------|----------|-------|-------|
| T1 | Build | pending |          |       |       |
| T2 | Ship  | pending |          |       |       |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;

const V2_LEDGER_ALL_VERIFIED = V2_LEDGER_WITH_PENDING.replace(/pending/g, 'verified');

function mkProject(ledgerContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-stale-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  fs.mkdirSync(path.join(dir, '.git'));  // satisfy project-root detection
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: structural\n---\n');
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledgerContent);
  return dir;
}

function setFileMtime(filePath, daysAgo) {
  const ms = Date.now() - daysAgo * 86400000;
  fs.utimesSync(filePath, new Date(ms), new Date(ms));
}

function runStart(cwd) {
  try {
    const out = execFileSync(process.execPath, [HOOK], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || Buffer.from('')).toString(), stderr: (e.stderr || Buffer.from('')).toString() };
  }
}

describe('stale-ledger detector', () => {
  it('fires when ledger older than src + pending rows exist', () => {
    const dir = mkProject(V2_LEDGER_WITH_PENDING);
    const ledger = path.join(dir, '.plan-enforcer', 'ledger.md');
    setFileMtime(ledger, 1); // 1 day old
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;'); // new
    const r = runStart(dir);
    assert.match(r.stdout, /STALE LEDGER WARNING/);
  });

  it('silent when ledger is fresh', () => {
    const dir = mkProject(V2_LEDGER_WITH_PENDING);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    const ledger = path.join(dir, '.plan-enforcer', 'ledger.md');
    // Make src file OLDER than ledger
    setFileMtime(path.join(dir, 'src', 'app.ts'), 1);
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout), 'fresh ledger should not warn');
  });

  it('silent when everything is verified', () => {
    const dir = mkProject(V2_LEDGER_ALL_VERIFIED);
    const ledger = path.join(dir, '.plan-enforcer', 'ledger.md');
    setFileMtime(ledger, 1);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout), 'no pending rows => no warning');
  });

  it('silent when no src files exist', () => {
    const dir = mkProject(V2_LEDGER_WITH_PENDING);
    const ledger = path.join(dir, '.plan-enforcer', 'ledger.md');
    setFileMtime(ledger, 1);
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout), 'no src => no comparison');
  });

  it('silent on v1 ledger (stale check is v2-only)', () => {
    const v1 = V2_LEDGER_WITH_PENDING.replace('<!-- schema: v2 -->\n', '');
    const dir = mkProject(v1);
    const ledger = path.join(dir, '.plan-enforcer', 'ledger.md');
    setFileMtime(ledger, 1);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    const r = runStart(dir);
    assert.ok(!/STALE LEDGER WARNING/.test(r.stdout), 'v1 ledger skips stale check');
  });
});

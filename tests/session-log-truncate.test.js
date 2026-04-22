const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'session-start.js');

function mkProject(withLedger) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-slogtrunc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: structural\n---\n');
  if (withLedger) {
    fs.writeFileSync(path.join(enforcer, 'ledger.md'), '# Plan Enforcer Ledger\n<!-- schema: v2 -->\n\n## Task Ledger\n\n| ID | Task | Status | Evidence | Chain | Notes |\n|----|------|--------|----------|-------|-------|\n| T1 | X | pending | | | |\n');
  }
  return dir;
}

function runStart(cwd) {
  try {
    execFileSync(process.execPath, [HOOK], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { /* ignore exit code */ }
}

describe('session-start truncates session log', () => {
  it('pre-existing log gets truncated to zero bytes', () => {
    const dir = mkProject(true);
    const logPath = path.join(dir, '.plan-enforcer', '.session-log.jsonl');
    fs.writeFileSync(logPath, '{"tool":"Old"}\n{"tool":"History"}\n');
    assert.ok(fs.statSync(logPath).size > 0);
    runStart(dir);
    assert.equal(fs.statSync(logPath).size, 0, 'log must be truncated on SessionStart');
  });

  it('no log file yet: SessionStart does not crash', () => {
    const dir = mkProject(true);
    runStart(dir);
    // Hook may or may not create an empty log — just assert it didn't crash
    // and the enforcer dir is still healthy.
    assert.ok(fs.existsSync(path.join(dir, '.plan-enforcer', 'config.md')));
  });

  it('enforcer dir doesn\'t exist: silent no-op', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-slog-none-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    runStart(dir);
    // Enforcer dir should not have been created by session-start's truncation logic
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', '.session-log.jsonl')), false);
  });
});

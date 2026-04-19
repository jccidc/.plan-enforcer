const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'post-tool.js');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-slog-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: structural\n---\n');
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), '# Plan Enforcer Ledger\n<!-- schema: v2 -->\n\n## Task Ledger\n\n| ID | Task | Status | Evidence | Chain | Notes |\n|----|------|--------|----------|-------|-------|\n| T1 | X | pending | | | |\n');
  return dir;
}

function runHook(cwd, payload) {
  try {
    execFileSync(process.execPath, [HOOK], {
      cwd,
      input: JSON.stringify(payload),
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (e) {
    // post-tool.js normally exits 0; ignore any error
  }
}

describe('session-log append', () => {
  it('writes a JSONL record per tool call', () => {
    const dir = mkProject();
    runHook(dir, {
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.ts', new_string: 'x' },
      tool_response: { ok: true }
    });
    const logPath = path.join(dir, '.plan-enforcer', '.session-log.jsonl');
    assert.ok(fs.existsSync(logPath), 'session log should exist after a tool call');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.tool, 'Edit');
    assert.equal(record.input.file_path, 'src/app.ts');
    assert.equal(record.response.ok, true);
    assert.ok(record.ts);
  });

  it('appends across multiple calls', () => {
    const dir = mkProject();
    runHook(dir, { tool_name: 'Read', tool_input: { file_path: 'a.md' }, tool_response: null });
    runHook(dir, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: 'a\n' } });
    runHook(dir, { tool_name: 'Edit', tool_input: { file_path: 'b.ts', new_string: '' }, tool_response: null });
    const lines = fs.readFileSync(path.join(dir, '.plan-enforcer', '.session-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).tool, 'Read');
    assert.equal(JSON.parse(lines[1]).tool, 'Bash');
    assert.equal(JSON.parse(lines[2]).tool, 'Edit');
  });

  it('does nothing when no enforcer dir present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-noslog-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    runHook(dir, { tool_name: 'Read', tool_input: { file_path: 'a' }, tool_response: null });
    // No log file should be created anywhere
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer')), false);
  });

  it('handles missing tool_response gracefully', () => {
    const dir = mkProject();
    runHook(dir, { tool_name: 'Read', tool_input: { file_path: 'a' } }); // no tool_response
    const lines = fs.readFileSync(path.join(dir, '.plan-enforcer', '.session-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.response, null);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function mkHookFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-statusline-hook-'));
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'hooks', 'statusline.js'), path.join(dir, 'hooks', 'statusline.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'statusline-state.js'), path.join(dir, 'src', 'statusline-state.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'ledger-parser.js'), path.join(dir, 'src', 'ledger-parser.js'));
  return dir;
}

function runHook(hookPath, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [hookPath], {
    cwd,
    input: JSON.stringify({ workspace: { current_dir: cwd } }),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv
    }
  });
}

describe('statusline hook', () => {
  it('renders discuss stage from packet fallback', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'discuss.md'), '# Packet\n');

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[ENFORCER: 1-DISCUSS\]/);
  });

  it('renders task progress from ledger', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'ledger.md'), [
      '# Plan Enforcer Ledger',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | one  | pending | | | |',
      '| T2  | two  | verified | done | | |'
    ].join('\n'));

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[ENFORCER: 1\/2\]/);
  });

  it('delegates to prior statusline command when present', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const baseScript = path.join(fixture, 'base-statusline.js');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'discuss.md'), '# Packet\n');
    fs.writeFileSync(baseScript, 'process.stdout.write("[BASE]")\n');
    fs.writeFileSync(
      path.join(fixture, 'hooks', '.statusline-base-command'),
      `${process.execPath} "${baseScript.replace(/\\/g, '/')}"\n`
    );

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.match(result.stdout.replace(/\x1B\[[0-9;]*m/g, ''), /\[ENFORCER: 1-DISCUSS\] \[BASE\]/);
  });

  it('auto-discovers the standard Claude statusline hook when no base command was captured', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const claudeDir = path.join(fixture, '.claude');
    const claudeHooks = path.join(claudeDir, 'hooks');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(claudeHooks, { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'discuss.md'), '# Packet\n');
    fs.writeFileSync(
      path.join(claudeHooks, 'statusline.js'),
      'process.stdout.write("[AUTO]")\n'
    );

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project, {
      CLAUDE_CONFIG_DIR: claudeDir
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout.replace(/\x1B\[[0-9;]*m/g, ''), /\[ENFORCER: 1-DISCUSS\] \[AUTO\]/);
  });
});

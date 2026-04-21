const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { STATUSLINE_SESSION_BRIDGE } = require('../src/statusline-state');

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
    input: JSON.stringify({ workspace: { current_dir: cwd }, session_id: 's1' }),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv
    }
  });
}

describe('statusline hook', () => {
  it('renders discuss stage from explicit state', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's1'
    }, null, 2));

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[ENFORCER: 1-DISCUSS\]/);
  });

  it('renders discuss stage from a live discuss packet when no ledger exists', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'discuss.md'), '# Launch packet\n');

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[ENFORCER: 1-DISCUSS\]/);
  });

  it('does not render discuss stage from packet alone after an archive exists', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const archiveDir = path.join(project, '.plan-enforcer', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'discuss.md'), '# Packet\n');
    fs.writeFileSync(path.join(archiveDir, '2026-04-21-run.md'), '# Archived ledger\n');

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /\[ENFORCER:/);
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
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's1'
    }, null, 2));
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
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's1'
    }, null, 2));
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

  it('still discovers real .statusline hooks that mention PE chained markers', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const claudeDir = path.join(fixture, '.claude');
    const claudeHooks = path.join(claudeDir, 'hooks');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(claudeHooks, { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's1'
    }, null, 2));
    fs.writeFileSync(
      path.join(claudeHooks, 'statusline.js'),
      [
        'if (process.env.PLAN_ENFORCER_STATUSLINE_CHAINED === "1") {}',
        'const file = ".plan-enforcer/statusline-state.json";',
        'process.stdout.write("[AUTO-CHAIN]")'
      ].join('\n')
    );

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project, {
      CLAUDE_CONFIG_DIR: claudeDir
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.replace(/\x1B\[[0-9;]*m/g, ''), '[ENFORCER: 1-DISCUSS] [AUTO-CHAIN]');
  });

  it('pads caption rows when the base statusline emits multiple lines', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const baseScript = path.join(fixture, 'base-multiline-statusline.js');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's1'
    }, null, 2));
    fs.writeFileSync(baseScript, 'process.stdout.write("[BASE]\\ncaption")\n');
    fs.writeFileSync(
      path.join(fixture, 'hooks', '.statusline-base-command'),
      `${process.execPath} "${baseScript.replace(/\\/g, '/')}"\n`
    );

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    const clean = result.stdout.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(result.status, 0);
    assert.match(clean, /^\[ENFORCER: 1-DISCUSS\] \[BASE\]\n\s+caption$/);
  });

  it('lets an enforcer-aware base statusline own the segment and captions', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const baseScript = path.join(fixture, 'base-enforcer-statusline.js');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's1'
    }, null, 2));
    fs.writeFileSync(baseScript, [
      'const file = ".plan-enforcer/statusline-state.json";',
      'if (process.env.PLAN_ENFORCER_STATUSLINE_CHAINED === "1") process.exit(9);',
      'process.stdout.write("[ENFORCER: 1-DISCUSS] [BASE]\\ncaption")'
    ].join('\n'));
    fs.writeFileSync(
      path.join(fixture, 'hooks', '.statusline-base-command'),
      `${process.execPath} "${baseScript.replace(/\\/g, '/')}"\n`
    );

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    const clean = result.stdout.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(result.status, 0);
    assert.equal(clean, '[ENFORCER: 1-DISCUSS] [BASE]\ncaption');
  });

  it('ignores explicit stage when the current session differs', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 'stale-session'
    }, null, 2));

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /\[ENFORCER:/);
  });

  it('does not inherit a home-level .plan-enforcer badge in unrelated folders', () => {
    const fixture = mkHookFixture();
    const fakeHome = path.join(fixture, 'home');
    const project = path.join(fakeHome, 'My Drive', 'projects', 'random');
    fs.mkdirSync(path.join(fakeHome, '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'draft',
      label: '2-DRAFT',
      sessionId: 's1'
    }, null, 2));

    const result = runHook(path.join(fixture, 'hooks', 'statusline.js'), project, {
      HOME: fakeHome,
      USERPROFILE: fakeHome
    });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /\[ENFORCER:/);
  });

  it('keeps the active stage when the same session drifts to another cwd', () => {
    const fixture = mkHookFixture();
    const project = path.join(fixture, 'project');
    const unrelated = path.join(fixture, 'elsewhere');
    const previousBridge = fs.existsSync(STATUSLINE_SESSION_BRIDGE)
      ? fs.readFileSync(STATUSLINE_SESSION_BRIDGE, 'utf8')
      : null;
    fs.mkdirSync(path.join(project, '.plan-enforcer'), { recursive: true });
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(project, '.plan-enforcer', 'statusline-state.json'), JSON.stringify({
      stage: 'discuss',
      label: '1-DISCUSS',
      sessionId: 's-bridge'
    }, null, 2));
    fs.writeFileSync(STATUSLINE_SESSION_BRIDGE, JSON.stringify({
      sessionId: 's-bridge',
      projectRoot: project
    }, null, 2));

    try {
      const result = spawnSync(process.execPath, [path.join(fixture, 'hooks', 'statusline.js')], {
        cwd: unrelated,
        input: JSON.stringify({ workspace: { current_dir: unrelated }, session_id: 's-bridge' }),
        encoding: 'utf8'
      });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /\[ENFORCER: 1-DISCUSS\]/);
    } finally {
      if (previousBridge == null) {
        try { fs.unlinkSync(STATUSLINE_SESSION_BRIDGE); } catch (_error) {}
      } else {
        fs.writeFileSync(STATUSLINE_SESSION_BRIDGE, previousBridge, 'utf8');
      }
    }
  });
});

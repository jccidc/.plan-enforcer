const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const doctorBin = path.resolve(__dirname, '..', 'src', 'doctor-cli.js');

const REQUIRED_SKILLS = [
  'plan-enforcer',
  'plan-enforcer-discuss',
  'plan-enforcer-draft',
  'plan-enforcer-review',
  'plan-enforcer-status',
  'plan-enforcer-logs',
  'plan-enforcer-config',
  'plan-enforcer-report'
];

const REQUIRED_RUNTIME_MODULES = [
  'plan-enforcer-cli.js',
  'doctor-cli.js',
  'config.js',
  'discuss-cli.js',
  'git-worktree.js',
  'statusline-state.js',
  'status-cli.js',
  'logs-cli.js',
  'report-cli.js',
  'import-cli.js'
];

function seedInstalledSurface(homeDir, opts = {}) {
  const hooks = opts.hooks || ['session-start.js', 'statusline.js', 'user-message.js'];
  const runtimeModules = opts.runtimeModules || REQUIRED_RUNTIME_MODULES;
  const skillsDir = path.join(homeDir, '.claude', 'skills');
  REQUIRED_SKILLS.forEach((skill) => fs.mkdirSync(path.join(skillsDir, skill), { recursive: true }));
  const root = path.join(skillsDir, 'plan-enforcer');
  const hooksDir = path.join(root, 'hooks');
  const runtimeDir = path.join(root, 'src');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  hooks.forEach((file) => fs.writeFileSync(path.join(hooksDir, file), '// hook\n'));
  runtimeModules.forEach((file) => fs.writeFileSync(path.join(runtimeDir, file), '// runtime\n'));
}

function writeProjectSettings(projectDir, hooks, statusLineCommand = 'node ~/.claude/skills/plan-enforcer/hooks/statusline.js') {
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    statusLine: {
      type: 'command',
      command: statusLineCommand
    },
    hooks
  }, null, 2));
}

describe('doctor-cli', () => {
  it('reports a healthy structural install and onboarding next step', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-doctor-ok-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    seedInstalledSurface(homeDir);
    fs.mkdirSync(path.join(projectDir, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.plan-enforcer', 'config.md'), [
      '---',
      'tier: structural',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: soft',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));
    writeProjectSettings(projectDir, {
      SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/.claude/skills/plan-enforcer/hooks/session-start.js' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node ~/.claude/skills/plan-enforcer/hooks/user-message.js' }] }]
    });

    try {
      const result = spawnSync(process.execPath, [doctorBin, '--json'], {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8'
      });

      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.tier, 'structural');
      assert.equal(payload.checks.skills.status, 'ok');
      assert.equal(payload.checks.runtime.status, 'ok');
      assert.equal(payload.checks.hooks.status, 'ok');
      assert.equal(payload.checks.settings.status, 'ok');
      assert.equal(payload.checks.statusline.status, 'ok');
      assert.equal(payload.checks.config.status, 'ok');
      assert.match(payload.next[0], /start with discuss/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when enforced install is missing hook files and hook settings', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-doctor-fail-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    seedInstalledSurface(homeDir, {
      hooks: ['session-start.js', 'user-message.js'],
      runtimeModules: REQUIRED_RUNTIME_MODULES.filter((file) => file !== 'doctor-cli.js')
    });
    fs.mkdirSync(path.join(projectDir, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.plan-enforcer', 'config.md'), [
      '---',
      'tier: enforced',
      'reconcile_interval: 25',
      'stale_threshold: 10',
      'completion_gate: soft',
      'ledger_path: .plan-enforcer/ledger.md',
      '---'
    ].join('\n'));
    writeProjectSettings(projectDir, {
      SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/.claude/skills/plan-enforcer/hooks/session-start.js' }] }]
    });

    try {
      const result = spawnSync(process.execPath, [doctorBin, '--json'], {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8'
      });

      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.tier, 'enforced');
      assert.equal(payload.checks.runtime.status, 'fail');
      assert.equal(payload.checks.hooks.status, 'fail');
      assert.equal(payload.checks.settings.status, 'fail');
      assert.equal(payload.checks.statusline.status, 'fail');
      assert.match(payload.next[0], /rerun \.\/install\.sh/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

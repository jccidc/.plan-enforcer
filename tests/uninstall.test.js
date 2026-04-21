const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const uninstallBin = path.join(ROOT, 'uninstall.sh');
const bashBin = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files/Git/usr/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/usr/bin/bash.exe'
].find((candidate) => fs.existsSync(candidate)) || 'bash';

const INSTALLED_SKILLS = [
  'plan-enforcer',
  'plan-enforcer-discuss',
  'plan-enforcer-draft',
  'plan-enforcer-review',
  'plan-enforcer-status',
  'plan-enforcer-logs',
  'plan-enforcer-config',
  'plan-enforcer-report'
];

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function seedInstalledSkills(homeDir) {
  const skillsDir = path.join(homeDir, '.claude', 'skills');
  INSTALLED_SKILLS.forEach((skill) => fs.mkdirSync(path.join(skillsDir, skill), { recursive: true }));
  const hooksDir = path.join(skillsDir, 'plan-enforcer', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, '.statusline-base-command'), 'node "~/.claude/hooks/statusline.js"\n', 'utf8');
  return { skillsDir, hooksDir };
}

describe('uninstall.sh', () => {
  it('removes PE skills, restores base statusline, cleans PE hooks, and preserves .plan-enforcer history', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-uninstall-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    const { skillsDir } = seedInstalledSkills(homeDir);

    const peStatusline = 'node "~/.claude/skills/plan-enforcer/hooks/statusline.js"';
    const peSession = 'node "~/.claude/skills/plan-enforcer/hooks/session-start.js"';
    const pePrompt = 'node "~/.claude/skills/plan-enforcer/hooks/user-message.js"';
    const foreignHook = 'node "~/.claude/hooks/other.js"';

    writeJson(path.join(homeDir, '.claude', 'settings.json'), {
      statusLine: { type: 'command', command: peStatusline },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: peSession }, { type: 'command', command: foreignHook }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: pePrompt }] }]
      }
    });
    writeJson(path.join(projectDir, '.claude', 'settings.json'), {
      statusLine: { type: 'command', command: peStatusline },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: peSession }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: foreignHook }] }]
      }
    });

    fs.mkdirSync(path.join(projectDir, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.plan-enforcer', 'ledger.md'), '# ledger\n', 'utf8');

    try {
      const result = spawnSync(bashBin, [uninstallBin], {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8'
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      INSTALLED_SKILLS.forEach((skill) => {
        assert.equal(fs.existsSync(path.join(skillsDir, skill)), false, `skill still exists: ${skill}`);
      });

      const globalSettings = JSON.parse(fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'));
      const projectSettings = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));

      assert.equal(globalSettings.statusLine.command, 'node "~/.claude/hooks/statusline.js"');
      assert.equal(projectSettings.statusLine.command, 'node "~/.claude/hooks/statusline.js"');
      assert.equal(JSON.stringify(globalSettings).includes('plan-enforcer'), false);
      assert.equal(JSON.stringify(projectSettings).includes('plan-enforcer'), false);
      assert.equal(JSON.stringify(globalSettings).includes('other.js'), true);
      assert.equal(JSON.stringify(projectSettings).includes('other.js'), true);
      assert.equal(fs.existsSync(path.join(projectDir, '.plan-enforcer', 'ledger.md')), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

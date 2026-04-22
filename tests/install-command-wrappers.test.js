const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const installBin = path.join(ROOT, 'install.sh');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const bashBin = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files/Git/usr/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/usr/bin/bash.exe'
].find((candidate) => fs.existsSync(candidate)) || 'bash';

describe('install.sh command wrappers', () => {
  it('installs runnable shell wrappers and skips local config for --global', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-install-wrap-'));
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    try {
      const install = spawnSync(bashBin, [installBin, '--global'], {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8'
      });

      assert.equal(install.status, 0, install.stderr || install.stdout);

      const binDir = path.join(homeDir, '.local', 'bin');
      for (const name of Object.keys(pkg.bin)) {
        assert.equal(fs.existsSync(path.join(binDir, name)), true, `missing shell wrapper ${name}`);
        assert.equal(fs.existsSync(path.join(binDir, `${name}.cmd`)), true, `missing cmd wrapper ${name}.cmd`);
      }

      assert.equal(fs.existsSync(path.join(projectDir, '.plan-enforcer', 'config.md')), false);

      const doctor = spawnSync(
        bashBin,
        ['-lc', 'export PATH="$HOME/.local/bin:$PATH"; plan-enforcer-doctor --json'],
        {
          cwd: projectDir,
          env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
          encoding: 'utf8'
        }
      );

      assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
      const payload = JSON.parse(doctor.stdout);
      assert.equal(payload.checks.skills.status, 'ok');
      assert.equal(payload.checks.statusline.status, 'ok');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

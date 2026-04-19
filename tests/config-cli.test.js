const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

describe('config-cli', () => {
  it('prints defaults for a missing config path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-config-cli-'));
    const configPath = path.join(tempDir, 'config.md');

    const result = spawnSync(process.execPath, ['src/config-cli.js', configPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /tier: structural/);
    assert.equal(fs.existsSync(configPath), false);
  });

  it('writes updates and prints merged config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-config-cli-'));
    const configPath = path.join(tempDir, 'config.md');

    const result = spawnSync(
      process.execPath,
      ['src/config-cli.js', configPath, '--tier', 'enforced', '--stale-threshold', '14', '--completion-gate', 'hard'],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /tier: enforced/);
    assert.match(result.stdout, /stale_threshold: 14/);
    assert.match(result.stdout, /completion_gate: hard/);
    const written = fs.readFileSync(configPath, 'utf8');
    assert.match(written, /tier: enforced/);
  });

  it('fails on invalid option values', () => {
    const result = spawnSync(process.execPath, ['src/config-cli.js', '--tier', 'bad'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid tier/);
  });
});

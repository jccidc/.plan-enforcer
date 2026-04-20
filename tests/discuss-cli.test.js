const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'src', 'discuss-cli.js');

describe('discuss-cli', () => {
  it('writes discuss packet, legacy packet, and statusline state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-discuss-cli-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');

    const result = spawnSync(process.execPath, [BIN, 'make the launch install path safe'], {
      cwd: dir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', 'discuss.md')), true);
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', 'combobulate.md')), true);
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', 'statusline-state.json')), true);
    assert.match(result.stdout, /Discuss packet written to:/);

    const state = JSON.parse(fs.readFileSync(path.join(dir, '.plan-enforcer', 'statusline-state.json'), 'utf8'));
    assert.equal(state.stage, 'discuss');
    assert.equal(state.label, 'DISCUSS');
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliBin = path.join(__dirname, '..', 'src', 'statusline-stage-cli.js');

describe('statusline-stage-cli', () => {
  it('writes named statusline stages', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-stage-cli-'));
    const dir = path.join(tempRoot, 'project');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, '.plan-enforcer'), { recursive: true });
      const result = spawnSync(process.execPath, [cliBin, 'draft', '--label', '2-DRAFT'], {
        cwd: dir,
        encoding: 'utf8'
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const statePath = path.join(dir, '.plan-enforcer', 'statusline-state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.equal(state.stage, 'draft');
      assert.equal(state.label, '2-DRAFT');
      assert.equal(state.source, 'statusline-stage-cli');
      assert.equal(fs.existsSync(path.join(tempRoot, '.plan-enforcer', 'statusline-state.json')), false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('clears statusline state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-stage-cli-clear-'));
    const statePath = path.join(dir, '.plan-enforcer', 'statusline-state.json');
    try {
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '{"stage":"discuss","label":"1-DISCUSS"}\n', 'utf8');

      const result = spawnSync(process.execPath, [cliBin, '--clear'], {
        cwd: dir,
        encoding: 'utf8'
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(fs.existsSync(statePath), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

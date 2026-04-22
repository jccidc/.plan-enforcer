const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function run(args, cwd) {
  return spawnSync(process.execPath, ['src/import-cli.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PE_IMPORT_CWD: cwd }
  });
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-import-cli-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fixture"}\n');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  return dir;
}

describe('import-cli', () => {
  it('imports an explicit plan path into a ledger', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, 'docs', 'plans', 'sample.md'), [
      '# Sample plan',
      '',
      '## Must-Haves',
      '',
      '- MH1: ship the route',
      '',
      '### Task 1: Add route',
      '- [ ] Implement route',
      '- [ ] Verification: npm test'
    ].join('\n'));

    const result = spawnSync(process.execPath, [
      'src/import-cli.js',
      '--cwd', dir,
      'docs/plans/sample.md'
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const ledger = fs.readFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), 'utf8');
    assert.match(ledger, /<!-- source: docs\/plans\/sample.md -->/);
    assert.match(ledger, /\| T1\s+\| Add route/);
    assert.match(result.stdout, /Must-haves: 1/);
  });

  it('auto-detects a plan when no path is passed', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, 'docs', 'plans', 'detected.md'), [
      '# Detected plan',
      '',
      '### Task 1: Add status output',
      '- [ ] Implement output',
      '- [ ] Verification: npm test'
    ].join('\n'));

    const result = spawnSync(process.execPath, [
      'src/import-cli.js',
      '--cwd', dir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Plan: docs\/plans\/detected.md/);
  });

  it('refuses to overwrite a live ledger without --force', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, 'docs', 'plans', 'sample.md'), [
      '# Sample plan',
      '',
      '### Task 1: Add route',
      '- [ ] Implement route'
    ].join('\n'));
    fs.mkdirSync(path.join(dir, '.plan-enforcer'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), 'existing');

    const result = spawnSync(process.execPath, [
      'src/import-cli.js',
      '--cwd', dir,
      'docs/plans/sample.md'
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Ledger already exists/);
  });
});

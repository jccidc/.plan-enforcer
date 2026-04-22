const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { validateEvidence, resolveFile, resolveTestName } = require('../src/evidence');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-evedge-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  execSync('git init -q && git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
  return dir;
}

describe('evidence edge cases — T7 closure', () => {
  it('rejects directory path (must be file)', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    assert.equal(resolveFile('src', dir), null);
  });

  it('deep test directory traversal finds nested test', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'tests', 'unit', 'auth'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests', 'unit', 'auth', 'login.test.js'),
      "describe('login flow', () => { it('works', () => {}); });"
    );
    const hit = resolveTestName('login flow', dir);
    assert.ok(hit);
    assert.match(hit, /login\.test\.js/);
  });

  it('short commit sha (7 chars) resolves alongside long sha', () => {
    const dir = mkRepo();
    const short = execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim();
    const long = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    const r1 = validateEvidence(`ref ${short}`, { projectRoot: dir });
    const r2 = validateEvidence(`ref ${long}`, { projectRoot: dir });
    assert.equal(r1.valid, true);
    assert.equal(r2.valid, true);
  });

  it('multiple file paths accumulate into signals', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x');
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'x');
    const r = validateEvidence('touched src/a.ts and src/b.ts', { projectRoot: dir });
    const fileSigs = r.signals.filter((s) => s.type === 'file');
    assert.ok(fileSigs.length >= 2);
  });

  it('URL containing path-like string is not a file signal', () => {
    const dir = mkRepo();
    const r = validateEvidence('see https://docs.example.com/src/app.ts', { projectRoot: dir });
    // Even if src/app.ts did exist, the URL form should not match
    assert.equal(r.valid, false);
  });

  it('empty Evidence after trim flagged as empty', () => {
    const r = validateEvidence('   \n\t  ', { projectRoot: '/tmp' });
    assert.equal(r.valid, false);
    assert.match(r.warnings[0], /empty/i);
  });
});

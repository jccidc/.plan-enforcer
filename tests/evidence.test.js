const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const {
  resolveFile,
  resolveSessionLog,
  resolveTestName,
  validateEvidence
} = require('../src/evidence');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ev-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  execSync('git init -q', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
  return dir;
}

describe('resolveFile', () => {
  it('returns relative path when file exists', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;');
    assert.equal(resolveFile('src/app.ts', dir), 'src/app.ts');
  });

  it('returns null when file does not exist', () => {
    const dir = mkRepo();
    assert.equal(resolveFile('src/missing.ts', dir), null);
  });

  it('normalizes leading ./', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    assert.equal(resolveFile('./src/app.ts', dir), 'src/app.ts');
  });
});

describe('resolveTestName', () => {
  it('finds a test name inside tests/ directory', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests', 'sample.test.js'),
      "it('does the thing', () => {});\n"
    );
    assert.match(resolveTestName('does the thing', dir), /tests\/sample\.test\.js/);
  });

  it('returns null when no test file has the name', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'sample.test.js'), "it('other', () => {});");
    assert.equal(resolveTestName('not a real test', dir), null);
  });
});

describe('resolveSessionLog', () => {
  it('returns matching record when evidence snippet appears in log blob', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-evlog-'));
    const log = path.join(dir, '.session-log.jsonl');
    const records = [
      { ts: '2026-04-12T00:00:00Z', tool: 'Bash', input: { command: 'npm test' }, response: { stdout: '243 tests pass', exit: 0 } },
      { ts: '2026-04-12T00:00:01Z', tool: 'Edit', input: { file_path: 'src/app.ts' }, response: null }
    ];
    fs.writeFileSync(log, records.map((r) => JSON.stringify(r)).join('\n'));
    const match = resolveSessionLog('243 tests pass', log);
    assert.ok(match);
    assert.equal(match.tool, 'Bash');
  });

  it('returns null when no record matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-evlog2-'));
    const log = path.join(dir, '.session-log.jsonl');
    fs.writeFileSync(log, JSON.stringify({ tool: 'Read', input: { file_path: 'x' }, response: null }) + '\n');
    assert.equal(resolveSessionLog('completely unrelated claim about things', log), null);
  });

  it('null when log file does not exist', () => {
    assert.equal(resolveSessionLog('anything', '/nonexistent/path/to/log.jsonl'), null);
  });
});

describe('validateEvidence — composite', () => {
  it('rejects empty evidence', () => {
    const r = validateEvidence('', { projectRoot: '/tmp' });
    assert.equal(r.valid, false);
    assert.equal(r.signals.length, 0);
    assert.ok(r.warnings.length > 0);
  });

  it('accepts evidence with an existing file path', () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    const r = validateEvidence('implemented in src/app.ts', { projectRoot: dir });
    assert.equal(r.valid, true);
    assert.ok(r.signals.some((s) => s.type === 'file'));
  });

  it('accepts evidence with a real commit SHA', () => {
    const dir = mkRepo();
    const sha = execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim();
    const r = validateEvidence(`ships as ${sha}`, { projectRoot: dir });
    assert.equal(r.valid, true);
    assert.ok(r.signals.some((s) => s.type === 'commit' && s.value === sha));
  });

  it('rejects evidence with a plausible-sounding but nonexistent file', () => {
    const dir = mkRepo();
    const r = validateEvidence('edited src/ghost.ts to fix bug', { projectRoot: dir });
    assert.equal(r.valid, false);
  });

  it('rejects evidence that is pure prose claim', () => {
    const dir = mkRepo();
    const r = validateEvidence('tests pass and it works great', { projectRoot: dir });
    assert.equal(r.valid, false);
  });

  it('accepts evidence backed by a session-log tool call', () => {
    const dir = mkRepo();
    const enforcerDir = path.join(dir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir);
    const log = path.join(enforcerDir, '.session-log.jsonl');
    fs.writeFileSync(log, JSON.stringify({
      ts: '2026-04-12T00:00:00Z',
      tool: 'Bash',
      input: { command: 'npm test' },
      response: { stdout: '243 tests pass\n', exit: 0 }
    }) + '\n');
    const r = validateEvidence('243 tests pass (npm test output)', { projectRoot: dir, enforcerDir });
    assert.equal(r.valid, true);
    assert.ok(r.signals.some((s) => s.type === 'tool'));
  });

  it('multiple signals stack', () => {
    const dir = mkRepo();
    const sha = execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'x');
    const r = validateEvidence(`commit ${sha}, src/app.ts updated`, { projectRoot: dir });
    assert.equal(r.valid, true);
    assert.equal(r.signals.length >= 2, true);
  });

  it('URL in evidence is ignored (not a file)', () => {
    const dir = mkRepo();
    const r = validateEvidence('see https://example.com/docs/foo.md for details', { projectRoot: dir });
    assert.equal(r.valid, false);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assessExecutedVerification,
  detectPackageCommand,
  detectSessionLogCommand,
  detectVerificationCommand,
  parseEvidenceCommand,
  readLatestExecutedVerification,
  runExecutedVerification
} = require('../src/executed-verification');

function mkProject(scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-execverify-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 't',
    scripts: scripts || {}
  }, null, 2));
  const enforcerDir = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcerDir);
  return { dir, enforcerDir };
}

describe('parseEvidenceCommand', () => {
  it('extracts npm test from evidence text', () => {
    assert.equal(parseEvidenceCommand('verified via npm test before close'), 'npm test');
  });

  it('extracts npm run script command from evidence text', () => {
    assert.equal(parseEvidenceCommand('ran npm run typecheck and saved output'), 'npm run typecheck');
  });

  it('extracts broader command shapes from evidence text', () => {
    assert.equal(parseEvidenceCommand('validated with pnpm lint before verify'), 'pnpm lint');
    assert.equal(parseEvidenceCommand('green after python -m pytest -q'), 'python -m pytest');
    assert.equal(parseEvidenceCommand('reran bun test before close'), 'bun test');
    assert.equal(parseEvidenceCommand('passed after uv run pytest -q'), 'uv run pytest');
  });
});

describe('detectVerificationCommand', () => {
  it('prefers explicit config check_cmd', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: { check_cmd: 'npm run lint' },
      evidenceText: 'npm test'
    });
    assert.equal(found.command, 'npm run lint');
    assert.equal(found.source, 'config:check_cmd');
  });

  it('falls back to package.json test script', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'npm test');
    assert.equal(found.source, 'package.json:test');
  });

  it('falls back to verify/check-style scripts when test is absent', () => {
    const project = mkProject({ verify: 'node -e "process.exit(0)"' });
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'npm run verify');
    assert.equal(found.source, 'package.json:verify');
  });

  it('falls back to a recent session-log verification command when config/evidence/package miss', () => {
    const project = mkProject({});
    const sessionLogPath = path.join(project.enforcerDir, '.session-log.jsonl');
    fs.writeFileSync(sessionLogPath, [
      JSON.stringify({
        ts: '2026-04-19T10:00:00Z',
        tool: 'Bash',
        input: { command: 'node --test tests/verify-cli.test.js' },
        response: { exit: 0, stdout: 'ok 1 - verify-cli' }
      })
    ].join('\n'));
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'tests/verify-cli.test.js',
      sessionLogPath
    });
    assert.equal(found.command, 'node --test');
    assert.equal(found.source, 'session-log:matched-verification');
  });
});

describe('detectSessionLogCommand', () => {
  it('prefers the command whose session-log payload overlaps evidence hints', () => {
    const project = mkProject({});
    const sessionLogPath = path.join(project.enforcerDir, '.session-log.jsonl');
    fs.writeFileSync(sessionLogPath, [
      JSON.stringify({
        ts: '2026-04-19T10:00:00Z',
        tool: 'Bash',
        input: { command: 'npm run lint' },
        response: { exit: 0, stdout: 'lint ok' }
      }),
      JSON.stringify({
        ts: '2026-04-19T10:05:00Z',
        tool: 'Bash',
        input: { command: 'node --test tests/status-logs-cli.test.js' },
        response: { exit: 0, stdout: 'status-logs-cli ok' }
      })
    ].join('\n'));
    const found = detectSessionLogCommand(project.dir, 'tests/status-logs-cli.test.js', sessionLogPath);
    assert.equal(found.command, 'node --test');
    assert.equal(found.source, 'session-log:matched-verification');
  });
});

describe('runExecutedVerification', () => {
  it('writes sidecars and latest index on passing command', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T1',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'npm test');
    assert.ok(fs.existsSync(path.join(project.dir, result.logPath)));
    assert.ok(fs.existsSync(path.join(project.dir, result.jsonPath)));
    const latest = readLatestExecutedVerification(project.enforcerDir, 'T1');
    assert.equal(latest.ok, true);
    assert.equal(latest.command, 'npm test');
  });

  it('records failing command result', () => {
    const project = mkProject({ test: 'node -e "process.exit(1)"' });
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T2',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    const latest = readLatestExecutedVerification(project.enforcerDir, 'T2');
    assert.equal(latest.ok, false);
    assert.equal(latest.exitCode, 1);
  });

  it('returns undetected when no command source exists', () => {
    const project = mkProject({});
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T3',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.detected, false);
  });
});

describe('assessExecutedVerification', () => {
  it('reports missing when a command is expected but no sidecar exists', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T4',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'missing');
    assert.equal(result.command, 'npm test');
  });

  it('reports stale when expected command differs from latest sidecar', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' });
    const checksDir = path.join(project.enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      T5: { taskId: 'T5', command: 'npm test', ok: true, exitCode: 0 }
    }, null, 2));
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T5',
      evidenceText: 'package.json',
      config: { check_cmd: 'npm run lint' }
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'stale');
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildVerdict,
  extractPhasePlanFromPrompt,
  formatVerdictReport,
  latestArchivePath,
  main,
  parsePhaseContext,
  resolvePlanPath,
  writeVerdict
} = require('../src/phase-verify-cli');

function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.plan-enforcer', 'archive'), { recursive: true });
  return dir;
}

function writeArchive(projectDir, name, body) {
  const archivePath = path.join(projectDir, '.plan-enforcer', 'archive', name);
  fs.writeFileSync(archivePath, body);
  return archivePath;
}

describe('phase-verify-cli', () => {
  it('resolves the latest archive by filename order', () => {
    const projectDir = mkTmp('pe-phase-verify-latest-');
    writeArchive(projectDir, '2026-04-15-old.md', '---\nplan: a\ncompleted: 2026-04-15T00:00:00Z\nresult: clean\n---\n');
    const latest = writeArchive(projectDir, '2026-04-16-new.md', '---\nplan: b\ncompleted: 2026-04-16T00:00:00Z\nresult: clean\n---\n');
    assert.equal(latestArchivePath(path.join(projectDir, '.plan-enforcer', 'archive')), latest);
  });

  it('parses phase-context focus files and verification labels', () => {
    const projectDir = mkTmp('pe-phase-verify-context-');
    const contextPath = path.join(projectDir, '.plan-enforcer', 'phase-context.md');
    fs.writeFileSync(contextPath, [
      '# Phase Context',
      '',
      '- Source: docs/plans/shared-execution-plan.md',
      '- Tier: structural',
      '- Archive: archive/2026-04-16-shared-execution-plan.md',
      '- Completed rows: 4',
      '- Focus files: src/app.js; test/app.test.js',
      '- Verification: npm test; curl /health',
      '- Decisions: D1 [deviation] src/app.js'
    ].join('\n'));
    const parsed = parsePhaseContext(contextPath);
    assert.deepEqual(parsed.focus_files, ['src/app.js', 'test/app.test.js']);
    assert.deepEqual(parsed.verification, ['npm test', 'curl /health']);
  });

  it('falls back to sibling plan.md when source path is not present', () => {
    const projectDir = mkTmp('pe-phase-verify-plan-fallback-');
    const phaseDir = path.join(projectDir, 'phase-06');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'plan.md'), '# Phase\n');
    const context = { path: path.join(phaseDir, 'phase-context.md') };
    assert.equal(resolvePlanPath('docs/plans/shared-execution-plan.md', projectDir, context), path.join(phaseDir, 'plan.md'));
  });

  it('extracts embedded phase plan text from prompt.txt', () => {
    const projectDir = mkTmp('pe-phase-verify-prompt-');
    const phaseDir = path.join(projectDir, 'phase-04');
    fs.mkdirSync(phaseDir, { recursive: true });
    const promptPath = path.join(phaseDir, 'prompt.txt');
    fs.writeFileSync(promptPath, [
      'header',
      '---PHASE PLAN START---',
      '# Phase',
      '',
      '## Outputs',
      '- `src/app.js` exists',
      '---PHASE PLAN END---',
      'footer'
    ].join('\n'));
    const plan = extractPhasePlanFromPrompt(promptPath);
    assert.match(plan, /# Phase/);
    assert.match(plan, /src\/app\.js/);
  });

  it('builds a passing structured verdict from archive + context', () => {
    const projectDir = mkTmp('pe-phase-verify-pass-');
    fs.mkdirSync(path.join(projectDir, 'docs', 'plans'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'app.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(projectDir, 'test', 'app.test.js'), 'test("ok", () => {});\n');
    fs.writeFileSync(path.join(projectDir, 'docs', 'plans', 'shared-execution-plan.md'), [
      '# Phase 01',
      '',
      '## Tasks',
      '',
      '### Task 1: Add app',
      '### Task 2: Add test',
      '',
      '## Outputs',
      '',
      '- `src/app.js` exists',
      '- `test/app.test.js` exists',
      '',
      '## Verification',
      '',
      '- `npm test` passes'
    ].join('\n'));

    const archivePath = writeArchive(projectDir, '2026-04-16-shared-execution-plan.md', [
      '---',
      'plan: docs/plans/shared-execution-plan.md',
      'tier: structural',
      'tasks: 2',
      'verified: 2',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 1',
      'reconciliations: 1',
      'started: 2026-04-16T10:00:00Z',
      'completed: 2026-04-16T10:30:00Z',
      'result: clean',
      '---',
      '',
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/shared-execution-plan.md -->',
      '<!-- tier: structural -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Add app | verified | src/app.js | C:abc1234 | |',
      '| T2  | Add test | verified | test/app.test.js | C:def5678 | |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '| D1 | deviation | src/app.js | used express | commit abc1234 |'
    ].join('\n'));

    const contextPath = path.join(projectDir, '.plan-enforcer', 'phase-context.md');
    fs.writeFileSync(contextPath, [
      '# Phase Context',
      '',
      '- Source: docs/plans/shared-execution-plan.md',
      '- Tier: structural',
      '- Archive: archive/2026-04-16-shared-execution-plan.md',
      '- Completed rows: 2',
      '- Focus files: src/app.js; test/app.test.js',
      '- Verification: npm test'
    ].join('\n'));

    const verdict = buildVerdict(archivePath, projectDir, parsePhaseContext(contextPath));
    assert.equal(verdict.pass, true);
    assert.equal(verdict.totals.verified, 2);
    assert.equal(verdict.tasks[0].evidence_files[0].exists, true);
    assert.equal(verdict.context.focus_files[0].exists, true);
    assert.equal(verdict.plan.task_name_matches.every((entry) => entry.matches), true);
    assert.equal(verdict.plan.outputs[0].artifacts[0].exists, true);
    assert.equal(verdict.plan.verification[0].commands[0].seen_in_context, true);
  });

  it('returns exit 1 when archive still contains unfinished rows', () => {
    const projectDir = mkTmp('pe-phase-verify-fail-');
    writeArchive(projectDir, '2026-04-16-shared-execution-plan.md', [
      '---',
      'plan: docs/plans/shared-execution-plan.md',
      'tier: structural',
      'tasks: 1',
      'verified: 0',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 0',
      'reconciliations: 0',
      'started: 2026-04-16T10:00:00Z',
      'completed: 2026-04-16T10:30:00Z',
      'result: clean',
      '---',
      '',
      '# Plan Enforcer Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/shared-execution-plan.md -->',
      '<!-- tier: structural -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Add app | pending |  |  | |',
      '',
      '## Decision Log',
      '',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|'
    ].join('\n'));

    const prevCwd = process.cwd();
    try {
      process.chdir(projectDir);
      const code = main(['--json']);
      assert.equal(code, 1);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('writes both machine and human-readable verdict artifacts', () => {
    const projectDir = mkTmp('pe-phase-verify-write-');
    const verdict = {
      archive: path.join(projectDir, '.plan-enforcer', 'archive', '2026-04-17-sample.md'),
      source: 'docs/plans/sample.md',
      tier: 'structural',
      pass: true,
      totals: { verified: 2, total_tasks: 2, unfinished: 0 },
      tasks: [],
      decisions: [],
      warnings: [],
      context: { focus_files: [], verification: [] }
    };

    const written = writeVerdict(path.join(projectDir, '.plan-enforcer'), verdict);
    assert.equal(fs.existsSync(written.jsonPath), true);
    assert.equal(fs.existsSync(written.reportPath), true);
    assert.match(fs.readFileSync(written.reportPath, 'utf8'), /# Phase Verify Report/);
    assert.match(formatVerdictReport(verdict), /Verified rows: 2\/2/);
  });
});

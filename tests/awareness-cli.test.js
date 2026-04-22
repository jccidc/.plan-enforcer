const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-awareness-cli-'));
  fs.mkdirSync(path.join(dir, '.plan-enforcer'), { recursive: true });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [path.join('src', 'awareness-cli.js'), ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env }
  });
}

describe('awareness-cli', () => {
  it('lists intents from a temp project', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay honest | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|'
    ].join('\n'));

    const result = run(['list', '--json', '--cwd', dir], dir);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.intents[0].id, 'I1');
  });

  it('reports orphan intents', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay honest | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I2 | export explicit closure | test | 2026-04-19 |',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|'
    ].join('\n'));
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Ship replay honest bundle | verified | src/replay-honest.js | A:I1 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = run(['orphans', '--json', '--cwd', dir], dir);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.orphans.map((row) => row.id), ['I2']);
  });

  it('shows linked intents for a task and supports add/link', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep snapshot truth | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|'
    ].join('\n'));
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Ship snapshot truth dossier | verified | docs/snapshot-truth-dossier.md | A:I1 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const taskResult = run(['task', 'T1', '--cwd', dir], dir);
    assert.equal(taskResult.status, 0);
    assert.match(taskResult.stdout, /I1: keep snapshot truth/);

    const addResult = run(['add', '--intent', 'keep the audit dossier explicit', '--cwd', dir], dir);
    assert.equal(addResult.status, 0);
    assert.match(addResult.stdout, /Added I2/);

    const linkResult = run(['link', 'T1', 'I2', '--cwd', dir], dir);
    assert.equal(linkResult.status, 0);
    const ledger = fs.readFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), 'utf8');
    assert.match(ledger, /A:I1, A:I2/);
  });

  it('captures the latest raw user prompt and skips with --if-empty', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', '.user-messages.jsonl'), [
      JSON.stringify({
        index: 1,
        ts: '2026-04-19T10:00:00.000Z',
        session_id: 's1',
        prompt: 'first ask'
      }),
      JSON.stringify({
        index: 2,
        ts: '2026-04-19T10:05:00.000Z',
        session_id: 's1',
        prompt: 'ship the audit dossier explicit'
      })
    ].join('\n') + '\n');

    const capture = run(['capture-latest', '--json', '--cwd', dir], dir);
    assert.equal(capture.status, 0);
    const payload = JSON.parse(capture.stdout);
    assert.equal(payload.id, 'I1');
    assert.equal(payload.source, 'msg:2');
    assert.equal(payload.quote, 'ship the audit dossier explicit');
    assert.equal(payload.captured, '2026-04-19');

    const skip = run(['capture-latest', '--if-empty', '--json', '--cwd', dir], dir);
    assert.equal(skip.status, 0);
    const skipped = JSON.parse(skip.stdout);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'awareness-not-empty');
  });
});

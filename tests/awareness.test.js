const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  addIntent,
  assessAwarenessQuoteVerification,
  captureLatestIntent,
  currentIntents,
  extractAwarenessRefs,
  orphanIntents,
  summarizeAwareness,
  taskAwareness
} = require('../src/awareness');
const { parseAwareness } = require('../src/awareness-parser');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-awareness-'));
  fs.mkdirSync(path.join(dir, '.plan-enforcer'), { recursive: true });
  return dir;
}

describe('awareness runtime', () => {
  it('extracts awareness refs from chain tokens including carried ids', () => {
    assert.deepEqual(
      extractAwarenessRefs(['D1', 'A:I3', 'I5', 'C:abc1234', 'A:R1']),
      ['I3', 'I5', 'R1']
    );
  });

  it('marks superseded intents inactive while preserving narrowed rows', () => {
    const state = parseAwareness([
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay safe | test | 2026-04-19 |',
      '| I2 | keep export explicit | test | 2026-04-19 |',
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
      '|----|------|------|------|----------|',
      '| C1 | supersede | I1 | replaced | 2026-04-19 |',
      '| C2 | narrow | I2 | removed: implicit export | 2026-04-19 |'
    ].join('\n'));

    const intents = currentIntents(state);
    assert.deepEqual(intents.map((row) => row.id), ['I2']);
    assert.equal(intents[0].narrowed.length, 1);
  });

  it('finds orphan intents and task-linked intent rows from ledger chain', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep stored snapshot truth | test | 2026-04-19 |',
      '| I2 | keep analyst explanation explicit | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I3 | add replay dossier | test | 2026-04-19 |',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '| R1 | replay safety bundle | I1, I2 | 2026-04-19 |',
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
      '| T1  | Build replay dossier with stored snapshot analyst explanation | verified | docs/replay-dossier-stored-snapshot-analyst-explanation.md | A:R1, I3 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const state = parseAwareness(fs.readFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), 'utf8'));
    const task = taskAwareness('T1', state, path.join(dir, '.plan-enforcer', 'ledger.md'));
    const orphans = orphanIntents(state, path.join(dir, '.plan-enforcer', 'ledger.md'));

    assert.deepEqual(task.refs, ['R1', 'I3']);
    assert.deepEqual(task.intents.map((row) => row.id), ['I1', 'I2', 'I3']);
    assert.equal(orphans.length, 0);
  });

  it('creates an awareness file and appends a new intent row', () => {
    const dir = mkProject();
    const added = addIntent({ cwd: dir, quote: 'keep the resume dossier intact', source: 'manual' });
    const content = fs.readFileSync(added.awarenessPath, 'utf8');
    assert.equal(added.id, 'I1');
    assert.match(content, /\| I1 \| keep the resume dossier intact \| manual \|/);
  });

  it('verifies non-manual intent quotes against captured user messages', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay dossier explicit | session-2026-04-19 | 2026-04-19 |',
      '| I2 | keep export split from attest | manual | 2026-04-19 |',
      '| I3 | legacy carryover note | pre-capture | 2026-04-19 |',
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
    fs.writeFileSync(path.join(dir, '.plan-enforcer', '.user-messages.jsonl'), [
      JSON.stringify({ index: 1, prompt: 'please keep replay dossier explicit and visible in the final report' })
    ].join('\n') + '\n');

    const state = parseAwareness(fs.readFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), 'utf8'));
    const assessment = assessAwarenessQuoteVerification(state, { projectRoot: dir });

    assert.equal(assessment.issues.length, 0);
  });

  it('flags non-pre-capture intent quotes missing from user-message log', () => {
    const state = parseAwareness([
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay dossier explicit | session-2026-04-19 | 2026-04-19 |',
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

    const assessment = assessAwarenessQuoteVerification(state, { projectRoot: mkProject() });

    assert.equal(assessment.issues.length, 1);
    assert.equal(assessment.issues[0].code, 'AWARENESS_QUOTE_UNVERIFIED');
    assert.match(assessment.issues[0].message, /I1/);
  });

  it('captures latest prompt into a new intent row with msg source', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', '.user-messages.jsonl'), [
      JSON.stringify({ index: 1, ts: '2026-04-19T11:40:00.000Z', prompt: 'keep replay honest' }),
      JSON.stringify({ index: 2, ts: '2026-04-19T11:41:00.000Z', prompt: 'ship awareness verify composition' })
    ].join('\n') + '\n');

    const captured = captureLatestIntent({ cwd: dir });

    assert.equal(captured.id, 'I1');
    assert.equal(captured.source, 'msg:2');
    assert.equal(captured.quote, 'ship awareness verify composition');
    assert.equal(captured.captured, '2026-04-19');
  });

  it('summarizes live, linked, orphan, and quote issue counts', () => {
    const dir = mkProject();
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay honest | session-2026-04-19 | 2026-04-19 |',
      '| I2 | export explicit closure | session-2026-04-19 | 2026-04-19 |',
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
      '| T1  | Keep replay honest bundle | verified | src/replay.js | A:I1 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));
    fs.writeFileSync(path.join(dir, '.plan-enforcer', '.user-messages.jsonl'), [
      JSON.stringify({ index: 1, prompt: 'please keep replay honest in the final result' })
    ].join('\n') + '\n');

    const summary = summarizeAwareness({ cwd: dir });

    assert.equal(summary.initialized, true);
    assert.equal(summary.liveIntents.length, 2);
    assert.equal(summary.linkedCount, 1);
    assert.deepEqual(summary.orphanRows.map((row) => row.id), ['I2']);
    assert.deepEqual(summary.quoteIssues.map((issue) => issue.row), ['I2']);
  });
});

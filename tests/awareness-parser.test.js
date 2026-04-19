const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseAwareness, readAwareness } = require('../src/awareness-parser');

describe('awareness-parser', () => {
  it('parses the repo hand-authored awareness fixture', () => {
    const filePath = path.join(__dirname, '..', '.plan-enforcer', 'awareness.md');
    const state = readAwareness(filePath);
    assert.equal(state.schema, 'v0-handauthored');
    assert.equal(state.intents.length >= 11, true);
    assert.equal(state.restates.length >= 4, true);
    assert.equal(state.corrections.length, 0);
    assert.equal(state.intents[0].id, 'I1');
  });

  it('normalizes ids and refs to uppercase', () => {
    const state = parseAwareness([
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| i1 | keep auth safe | test | 2026-04-19 |',
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
      '| r1 | auth-safe replay | i1 | 2026-04-19 |',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|',
      '| c1 | supersede | i1 | replaced | 2026-04-19 |'
    ].join('\n'));

    assert.equal(state.intents[0].id, 'I1');
    assert.deepEqual(state.restates[0].refs, ['I1']);
    assert.deepEqual(state.corrections[0].refs, ['I1']);
  });
});

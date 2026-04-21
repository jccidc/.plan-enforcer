const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  TIERS,
  VIOLATIONS,
  ACTIONS,
  DEFAULT_TIER,
  DELETE_THRESHOLD,
  MATRIX,
  decide,
  readTier,
  formatViolation,
  shouldBlock
} = require('../src/tier');

describe('tier constants', () => {
  it('exports three tiers', () => {
    assert.deepEqual(TIERS, ['advisory', 'structural', 'enforced']);
  });
  it('exports eight violation types', () => {
    assert.deepEqual(VIOLATIONS, ['unplanned_edit', 'unlogged_delete', 'missing_evidence', 'bulk_task_closure', 'missing_awareness_link', 'unverified_awareness_quote', 'orphan_intent', 'phase_pivot']);
  });
  it('exports four action types', () => {
    assert.deepEqual(ACTIONS, ['allow', 'audit', 'warn', 'block']);
  });
  it('default tier is structural (safe middle)', () => {
    assert.equal(DEFAULT_TIER, 'structural');
  });
  it('DELETE_THRESHOLD is 0.5', () => {
    assert.equal(DELETE_THRESHOLD, 0.5);
  });
});

describe('decide — awareness-aware matrix', () => {
  const expected = {
    advisory: {
      unplanned_edit: 'audit',
      unlogged_delete: 'audit',
      missing_evidence: 'audit',
      bulk_task_closure: 'audit',
      missing_awareness_link: 'audit',
      unverified_awareness_quote: 'audit',
      orphan_intent: 'audit',
      phase_pivot: 'audit'
    },
    structural: {
      unplanned_edit: 'warn',
      unlogged_delete: 'block',
      missing_evidence: 'block',
      bulk_task_closure: 'block',
      missing_awareness_link: 'warn',
      unverified_awareness_quote: 'warn',
      orphan_intent: 'warn',
      phase_pivot: 'warn'
    },
    enforced: {
      unplanned_edit: 'block',
      unlogged_delete: 'block',
      missing_evidence: 'block',
      bulk_task_closure: 'block',
      missing_awareness_link: 'block',
      unverified_awareness_quote: 'block',
      orphan_intent: 'block',
      phase_pivot: 'block'
    }
  };

  for (const tier of TIERS) {
    for (const v of VIOLATIONS) {
      it(`${tier} × ${v} -> ${expected[tier][v]}`, () => {
        const r = decide(tier, v);
        assert.equal(r.action, expected[tier][v], `MATRIX mismatch: tier=${tier} v=${v}`);
        assert.equal(r.action, MATRIX[tier][v], 'decide result must match exposed MATRIX');
      });
    }
  }
});

describe('decide — messaging', () => {
  it('block action produces a message containing [block]', () => {
    const r = decide('enforced', 'unplanned_edit');
    assert.match(r.message, /\[block\]/);
    assert.match(r.message, /unplanned edit/);
  });

  it('warn action produces a message containing [warn]', () => {
    const r = decide('structural', 'unplanned_edit');
    assert.match(r.message, /\[warn\]/);
  });

  it('audit action produces a message containing [audit]', () => {
    const r = decide('advisory', 'unplanned_edit');
    assert.match(r.message, /\[audit\]/);
  });

  it('ctx.detail is appended to the message when provided', () => {
    const r = decide('enforced', 'unplanned_edit', { detail: 'Target: src/new.ts' });
    assert.match(r.message, /Target: src\/new\.ts/);
  });

  it('unknown violation defaults to audit (conservative)', () => {
    const r = decide('enforced', 'not-a-real-violation');
    assert.equal(r.action, 'audit');
    assert.match(r.message, /unknown violation/);
  });

  it('unknown tier falls back to default (structural)', () => {
    const r = decide('chaotic', 'unplanned_edit');
    assert.equal(r.action, 'warn', 'unknown tier should resolve to structural');
  });
});

describe('readTier', () => {
  function mkEnforcerDir(configContent) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-tier-'));
    if (configContent !== null) {
      fs.writeFileSync(path.join(dir, 'config.md'), configContent);
    }
    return dir;
  }

  it('reads tier=enforced', () => {
    const dir = mkEnforcerDir(`---\ntier: enforced\n---\n`);
    assert.equal(readTier(dir), 'enforced');
  });

  it('reads tier=advisory', () => {
    const dir = mkEnforcerDir(`---\ntier: advisory\nreconcile_interval: 25\n---\n`);
    assert.equal(readTier(dir), 'advisory');
  });

  it('reads tier=structural', () => {
    const dir = mkEnforcerDir(`---\ntier: structural\n---\n`);
    assert.equal(readTier(dir), 'structural');
  });

  it('is case-insensitive on value', () => {
    const dir = mkEnforcerDir(`---\ntier: ENFORCED\n---\n`);
    assert.equal(readTier(dir), 'enforced');
  });

  it('missing file defaults to structural', () => {
    const dir = mkEnforcerDir(null);
    assert.equal(readTier(dir), 'structural');
  });

  it('malformed tier value defaults to structural', () => {
    const dir = mkEnforcerDir(`---\ntier: chaos\n---\n`);
    assert.equal(readTier(dir), 'structural');
  });

  it('config without tier: line defaults to structural', () => {
    const dir = mkEnforcerDir(`---\nreconcile_interval: 25\n---\n`);
    assert.equal(readTier(dir), 'structural');
  });

  it('null/empty input defaults to structural', () => {
    assert.equal(readTier(null), 'structural');
    assert.equal(readTier(''), 'structural');
  });
});

describe('shouldBlock', () => {
  it('only block is blocking', () => {
    assert.equal(shouldBlock('block'), true);
    assert.equal(shouldBlock('warn'), false);
    assert.equal(shouldBlock('audit'), false);
    assert.equal(shouldBlock('allow'), false);
  });
});

describe('formatViolation', () => {
  it('produces human-readable labels', () => {
    assert.equal(formatViolation('unplanned_edit'), 'unplanned edit');
    assert.equal(formatViolation('unlogged_delete'), 'unlogged deletion');
    assert.equal(formatViolation('missing_evidence'), 'missing evidence on verified row');
    assert.equal(formatViolation('bulk_task_closure'), 'bulk pending closure');
    assert.equal(formatViolation('missing_awareness_link'), 'missing awareness link on verified row');
    assert.equal(formatViolation('unverified_awareness_quote'), 'unverified awareness quote');
    assert.equal(formatViolation('orphan_intent'), 'orphan user intent');
    assert.equal(formatViolation('phase_pivot'), 'phase pivot');
  });
  it('passes through unknown violation strings', () => {
    assert.equal(formatViolation('custom_violation'), 'custom_violation');
  });
});

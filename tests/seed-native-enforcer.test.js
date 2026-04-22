const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getBenchmarkProfile } = require('../benchmarks/framework-comparison/scripts/seed-native-enforcer');

describe('seed-native-enforcer benchmark tier profiles', () => {
  it('advisory is materially lighter than enforced for normal execution', () => {
    const advisory = getBenchmarkProfile('advisory', false);
    const enforced = getBenchmarkProfile('enforced', false);
    assert.equal(advisory.completion_gate, 'soft');
    assert.equal(enforced.completion_gate, 'hard');
    assert.ok(advisory.stale_threshold > enforced.stale_threshold);
    assert.ok(advisory.reconcile_interval > enforced.reconcile_interval);
  });

  it('continuity scenarios tighten reconcile cadence without forcing stale_threshold zero', () => {
    const structural = getBenchmarkProfile('structural', true);
    const enforced = getBenchmarkProfile('enforced', true);
    assert.equal(structural.reconcile_interval, 10);
    assert.equal(enforced.reconcile_interval, 10);
    assert.equal(structural.stale_threshold, 25);
    assert.equal(enforced.stale_threshold, 25);
  });

  it('unknown tiers fall back to structural profile', () => {
    const fallback = getBenchmarkProfile('wild', false);
    assert.deepEqual(fallback, {
      reconcile_interval: 25,
      stale_threshold: 25,
      completion_gate: 'soft'
    });
  });
});

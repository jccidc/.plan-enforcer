const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  statePath,
  loadState,
  appendInvocation,
  summarizeState,
  removeState
} = require('../benchmarks/framework-comparison/scripts/phased-session-state');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('phased-session-state', () => {
  it('returns an empty state by default', () => {
    const cellDir = mkTmp('pe-phased-state-empty-');
    assert.deepEqual(loadState(cellDir), { invocations: [] });
    assert.deepEqual(summarizeState(loadState(cellDir)), {
      sessions_counted: 0,
      wall_clock_ms: 0,
      session_1_wall_clock_ms: null,
      session_2_wall_clock_ms: null,
      interrupted: false,
      invocations: []
    });
  });

  it('appends invocations and aggregates wall clock across resume', () => {
    const cellDir = mkTmp('pe-phased-state-record-');
    appendInvocation(cellDir, {
      wall_clock_ms: 1200,
      start_phase: 1,
      end_phase: 5,
      interrupted: true
    });
    appendInvocation(cellDir, {
      wall_clock_ms: 3400,
      start_phase: 6,
      end_phase: 8,
      interrupted: false
    });

    const summary = summarizeState(loadState(cellDir));
    assert.equal(summary.sessions_counted, 2);
    assert.equal(summary.wall_clock_ms, 4600);
    assert.equal(summary.session_1_wall_clock_ms, 1200);
    assert.equal(summary.session_2_wall_clock_ms, 3400);
    assert.equal(summary.interrupted, true);
    assert.equal(summary.invocations[0].end_phase, 5);
    assert.equal(summary.invocations[1].start_phase, 6);
  });

  it('can clear the state file after finalization', () => {
    const cellDir = mkTmp('pe-phased-state-clear-');
    appendInvocation(cellDir, {
      wall_clock_ms: 500,
      start_phase: 1,
      end_phase: 2,
      interrupted: true
    });
    assert.equal(fs.existsSync(statePath(cellDir)), true);
    removeState(cellDir);
    assert.equal(fs.existsSync(statePath(cellDir)), false);
  });
});

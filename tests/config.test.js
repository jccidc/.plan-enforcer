const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { applyConfigUpdates, DEFAULTS, formatConfig, readConfig, readTier, writeConfig } = require('../src/config');

describe('DEFAULTS', () => {
  it('has expected default values', () => {
    assert.equal(DEFAULTS.tier, 'structural');
    assert.equal(DEFAULTS.reconcile_interval, 25);
    assert.equal(DEFAULTS.stale_threshold, 10);
    assert.equal(DEFAULTS.completion_gate, 'soft');
  });
});

describe('readConfig', () => {
  it('returns defaults for missing file', () => {
    const config = readConfig('/nonexistent/path/config.md');
    assert.deepEqual(config, DEFAULTS);
  });

  it('reads config from file and merges with defaults', () => {
    const tmpFile = path.join(os.tmpdir(), `pe-test-config-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, '---\ntier: enforced\nreconcile_interval: 10\ncheck_cmd: npm test\n---\n');
    try {
      const config = readConfig(tmpFile);
      assert.equal(config.tier, 'enforced');
      assert.equal(config.reconcile_interval, 10);
      assert.equal(config.stale_threshold, 10); // default preserved
      assert.equal(config.completion_gate, 'soft'); // default preserved
      assert.equal(config.check_cmd, 'npm test');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('handles partial config (only tier)', () => {
    const tmpFile = path.join(os.tmpdir(), `pe-test-config-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, 'tier: advisory\n');
    try {
      const config = readConfig(tmpFile);
      assert.equal(config.tier, 'advisory');
      assert.equal(config.reconcile_interval, 25);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('readTier', () => {
  it('returns default tier for missing file', () => {
    assert.equal(readTier('/nonexistent'), 'structural');
  });

  it('reads tier from file', () => {
    const tmpFile = path.join(os.tmpdir(), `pe-test-tier-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, 'tier: enforced\n');
    try {
      assert.equal(readTier(tmpFile), 'enforced');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('writeConfig', () => {
  it('writes config with all fields', () => {
    const tmpFile = path.join(os.tmpdir(), `pe-test-write-${Date.now()}.md`);
    try {
      writeConfig(tmpFile, { tier: 'enforced', reconcile_interval: 15 });
      const content = fs.readFileSync(tmpFile, 'utf8');
      assert.ok(content.includes('tier: enforced'));
      assert.ok(content.includes('reconcile_interval: 15'));
      assert.ok(content.includes('stale_threshold: 10')); // default filled in
      assert.ok(content.includes('completion_gate: soft'));
      assert.ok(!content.includes('check_cmd:'), 'blank check_cmd should be omitted');
      assert.ok(content.includes('ledger_path:'));
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('round-trips through write then read', () => {
    const tmpFile = path.join(os.tmpdir(), `pe-test-roundtrip-${Date.now()}.md`);
    try {
      const original = { tier: 'advisory', reconcile_interval: 50, stale_threshold: 60, completion_gate: 'hard' };
      writeConfig(tmpFile, original);
      const config = readConfig(tmpFile);
      assert.equal(config.tier, 'advisory');
      assert.equal(config.reconcile_interval, 50);
      assert.equal(config.stale_threshold, 60);
      assert.equal(config.completion_gate, 'hard');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('formatConfig', () => {
  it('renders the shared config display', () => {
    const output = formatConfig(DEFAULTS);
    assert.match(output, /Plan Enforcer Config/);
    assert.match(output, /tier: structural/);
    assert.match(output, /stale_threshold: 10/);
    assert.match(output, /check_cmd: \(auto\)/);
  });
});

describe('applyConfigUpdates', () => {
  it('applies valid updates on top of current config', () => {
    const next = applyConfigUpdates(DEFAULTS, { tier: 'enforced', stale_threshold: '12' });
    assert.equal(next.tier, 'enforced');
    assert.equal(next.stale_threshold, 12);
    assert.equal(next.reconcile_interval, 25);
  });

  it('throws on invalid tier', () => {
    assert.throws(() => applyConfigUpdates(DEFAULTS, { tier: 'wild' }), /Invalid tier/);
  });

  it('throws on invalid completion gate', () => {
    assert.throws(() => applyConfigUpdates(DEFAULTS, { completion_gate: 'maybe' }), /Invalid completion_gate/);
  });

  it('accepts check_cmd updates', () => {
    const next = applyConfigUpdates(DEFAULTS, { check_cmd: 'npm test' });
    assert.equal(next.check_cmd, 'npm test');
  });
});

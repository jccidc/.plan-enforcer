// Plan Enforcer — Config Reader/Writer
// Reads and writes .plan-enforcer/config.md with sensible defaults.

const fs = require('fs');

const DEFAULTS = {
  tier: 'structural',
  reconcile_interval: 25,
  stale_threshold: 10,
  completion_gate: 'soft',
  check_cmd: ''
};

const VALID_TIERS = new Set(['advisory', 'structural', 'enforced']);
const VALID_GATES = new Set(['soft', 'hard', 'audit']);

/**
 * Read config from a file path, merging with defaults.
 * @param {string} configPath - Absolute path to config.md
 * @returns {{ tier: string, reconcile_interval: number, stale_threshold: number, completion_gate: string, check_cmd: string }}
 */
function readConfig(configPath) {
  const config = { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const tierMatch = raw.match(/^tier:\s*(\w+)/m);
    const reconMatch = raw.match(/^reconcile_interval:\s*(\d+)/m);
    const staleMatch = raw.match(/^stale_threshold:\s*(\d+)/m);
    const gateMatch = raw.match(/^completion_gate:\s*(\w+)/m);
    const checkMatch = raw.match(/^check_cmd:\s*(.+)$/m);
    if (tierMatch) config.tier = tierMatch[1];
    if (reconMatch) config.reconcile_interval = parseInt(reconMatch[1]);
    if (staleMatch) config.stale_threshold = parseInt(staleMatch[1]);
    if (gateMatch) config.completion_gate = gateMatch[1];
    if (checkMatch) config.check_cmd = checkMatch[1].trim();
  } catch (e) {}
  return config;
}

/**
 * Read just the tier from config.
 * @param {string} configPath
 * @returns {string}
 */
function readTier(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const match = raw.match(/^tier:\s*(\w+)/m);
    return match ? match[1] : DEFAULTS.tier;
  } catch (e) {
    return DEFAULTS.tier;
  }
}

/**
 * Write config to file.
 * @param {string} configPath
 * @param {object} config
 */
function writeConfig(configPath, config) {
  const merged = { ...DEFAULTS, ...config };
  const checkLine = merged.check_cmd ? `check_cmd: ${merged.check_cmd}\n` : '';
  const content = `---\ntier: ${merged.tier}\nreconcile_interval: ${merged.reconcile_interval}\nstale_threshold: ${merged.stale_threshold}\ncompletion_gate: ${merged.completion_gate}\n${checkLine}ledger_path: .plan-enforcer/ledger.md\n---\n`;
  fs.writeFileSync(configPath, content);
}

function formatConfig(config) {
  const merged = { ...DEFAULTS, ...config };
  return [
    '---Plan Enforcer Config ----------------------------',
    ` tier: ${merged.tier}`,
    ` reconcile_interval: ${merged.reconcile_interval}`,
    ` stale_threshold: ${merged.stale_threshold}`,
    ` completion_gate: ${merged.completion_gate}`,
    ` check_cmd: ${merged.check_cmd || '(auto)'}`,
    ' ledger_path: .plan-enforcer/ledger.md',
    '---------------------------------------------------'
  ].join('\n');
}

function applyConfigUpdates(currentConfig, updates) {
  const next = { ...DEFAULTS, ...currentConfig };

  if (updates.tier !== undefined) {
    if (!VALID_TIERS.has(updates.tier)) {
      throw new Error(`Invalid tier: ${updates.tier}`);
    }
    next.tier = updates.tier;
  }

  if (updates.reconcile_interval !== undefined) {
    const value = Number(updates.reconcile_interval);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid reconcile_interval: ${updates.reconcile_interval}`);
    }
    next.reconcile_interval = value;
  }

  if (updates.stale_threshold !== undefined) {
    const value = Number(updates.stale_threshold);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid stale_threshold: ${updates.stale_threshold}`);
    }
    next.stale_threshold = value;
  }

  if (updates.completion_gate !== undefined) {
    if (!VALID_GATES.has(updates.completion_gate)) {
      throw new Error(`Invalid completion_gate: ${updates.completion_gate}`);
    }
    next.completion_gate = updates.completion_gate;
  }

  if (updates.check_cmd !== undefined) {
    const value = String(updates.check_cmd || '').trim();
    next.check_cmd = value;
  }

  return next;
}

module.exports = {
  applyConfigUpdates,
  DEFAULTS,
  formatConfig,
  readConfig,
  readTier,
  VALID_GATES,
  VALID_TIERS,
  writeConfig
};

// Plan Enforcer — Tier Helper
//
// Centralizes tier-aware decision logic so hooks don't copy-paste the
// 3-tier × N-violation branching. Every new enforcement point calls
// decide() with a violation type; tier.js owns the matrix.
//
// Tiers:
//   advisory   — audit-only; log violations, never block
//   structural — warn for most; block only hard integrity breaks
//                (unlogged deletion, verified-without-evidence)
//   enforced   — block every violation type until resolved
//
// Violations:
//   unplanned_edit     — Edit/Write to a file not in the planned set
//   unlogged_delete    — deletion without a typed `delete` D-row
//   missing_evidence   — row flipped to verified without structural evidence
//   bulk_task_closure  — many pending rows terminalized in one ledger edit
//   phase_pivot        — tool call against a phase that isn't active
//
// Actions:
//   allow  — no-op, proceed
//   audit  — append to audit log, proceed
//   warn   — print a warning to stderr, proceed
//   block  — non-zero exit, refuse the tool call

const fs = require('fs');
const path = require('path');

const TIERS = Object.freeze(['advisory', 'structural', 'enforced']);
const DEFAULT_TIER = 'structural';
const VIOLATIONS = Object.freeze([
  'unplanned_edit',
  'unlogged_delete',
  'missing_evidence',
  'bulk_task_closure',
  'missing_awareness_link',
  'unverified_awareness_quote',
  'orphan_intent',
  'phase_pivot'
]);
const ACTIONS = Object.freeze(['allow', 'audit', 'warn', 'block']);

// Tier × violation matrix. Rows = tiers; columns = violations.
// advisory: audit everything, block nothing
// structural: warn on soft, block on hard integrity breaks
// enforced: block every violation
const MATRIX = Object.freeze({
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
});

// Threshold used by delete-guard to classify "this edit counts as a deletion."
// A MultiEdit or Edit that removes >= this fraction of the original file is
// treated as a deletion and requires a typed delete D-row.
const DELETE_THRESHOLD = 0.5;

/**
 * Read the configured tier from a .plan-enforcer/config.md file.
 * Falls back to DEFAULT_TIER on any read or parse failure — we never want
 * a malformed config to brick hooks; we default to the safer 'structural'
 * mode and let the user surface the issue.
 *
 * @param {string} enforcerDir - path to the .plan-enforcer/ directory
 * @returns {'advisory' | 'structural' | 'enforced'}
 */
function readTier(enforcerDir) {
  if (!enforcerDir) return DEFAULT_TIER;
  const configPath = path.join(enforcerDir, 'config.md');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const m = raw.match(/^tier:\s*(\w+)/m);
    if (!m) return DEFAULT_TIER;
    const t = m[1].toLowerCase();
    return TIERS.includes(t) ? t : DEFAULT_TIER;
  } catch (e) {
    return DEFAULT_TIER;
  }
}

/**
 * Decide what action a hook should take given a tier and a violation type.
 * Returns the action plus a human-readable message the hook can print.
 *
 * @param {'advisory' | 'structural' | 'enforced'} tier
 * @param {'unplanned_edit' | 'unlogged_delete' | 'missing_evidence' | 'bulk_task_closure' | 'missing_awareness_link' | 'unverified_awareness_quote' | 'orphan_intent' | 'phase_pivot'} violation
 * @param {{ detail?: string }} [ctx] - optional context merged into the message
 * @returns {{ action: 'allow' | 'audit' | 'warn' | 'block', message: string }}
 */
function decide(tier, violation, ctx) {
  const resolvedTier = TIERS.includes(tier) ? tier : DEFAULT_TIER;
  const rowAction = (MATRIX[resolvedTier] || {})[violation];

  if (!rowAction) {
    // Unknown violation — be conservative and audit. Never block on
    // something we don't recognize; that would risk hard-blocking the
    // agent on an enforcer bug.
    return {
      action: 'audit',
      message: `Plan Enforcer: unknown violation "${violation}" at tier=${resolvedTier}. Defaulting to audit.`
    };
  }

  const detail = ctx && ctx.detail ? ctx.detail : '';
  const label = formatViolation(violation);
  const tail = detail ? ` ${detail}` : '';
  let message;
  switch (rowAction) {
    case 'allow':
      message = '';
      break;
    case 'audit':
      message = `Plan Enforcer [audit]: ${label} at tier=${resolvedTier}.${tail}`;
      break;
    case 'warn':
      message = `Plan Enforcer [warn]: ${label} at tier=${resolvedTier}.${tail} (consider adding a Decision Log row)`;
      break;
    case 'block':
      message = `Plan Enforcer [block]: ${label} blocked at tier=${resolvedTier}.${tail}`;
      break;
    default:
      message = '';
  }

  return { action: rowAction, message };
}

/**
 * Human-readable name for a violation enum.
 * @param {string} violation
 * @returns {string}
 */
function formatViolation(violation) {
  switch (violation) {
    case 'unplanned_edit': return 'unplanned edit';
    case 'unlogged_delete': return 'unlogged deletion';
    case 'missing_evidence': return 'missing evidence on verified row';
    case 'bulk_task_closure': return 'bulk pending closure';
    case 'missing_awareness_link': return 'missing awareness link on verified row';
    case 'unverified_awareness_quote': return 'unverified awareness quote';
    case 'orphan_intent': return 'orphan user intent';
    case 'phase_pivot': return 'phase pivot';
    default: return violation;
  }
}

/**
 * Convenience predicate: does this action mean the tool call should
 * be blocked? Used by PreToolUse hooks to decide on exit code.
 * @param {string} action
 * @returns {boolean}
 */
function shouldBlock(action) {
  return action === 'block';
}

module.exports = {
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
};

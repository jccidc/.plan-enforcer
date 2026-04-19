#!/usr/bin/env node
// plan-enforcer-export — Machine-readable ledger dump.
//
// Stable versioned schema (EXPORT_SCHEMA_VERSION). Downstream dashboards
// and CI gates parse this instead of re-implementing the ledger parser.
// Only --format=json for now; yaml can slot in later without a bump.
//
// Usage:
//   plan-enforcer-export [--ledger <path>] [--cwd <path>] [--format=json] [--pretty]
//   plan-enforcer-export --help
//
// Exit codes:
//   0  exported successfully
//   2  config error (no ledger, bad format)

const fs = require('fs');
const path = require('path');
const {
  parseTaskRows,
  parseDecisionLog,
  parseReconciliationHistory,
  parseMetadata,
  parseLedger
} = require('./ledger-parser');

const EXPORT_SCHEMA_VERSION = 1;

/**
 * Build a fully structured export object from ledger content.
 * Pure — no fs, no git, safe to call from tests with a string ledger.
 *
 * @param {string} ledgerContent - raw ledger markdown
 * @param {{ ledgerPath?: string, now?: Date }} [ctx]
 * @returns {object}
 */
function buildExport(ledgerContent, ctx) {
  ctx = ctx || {};
  const meta = parseMetadata(ledgerContent);
  const stats = parseLedger(ledgerContent);
  const tasks = parseTaskRows(ledgerContent);
  const decisions = parseDecisionLog(ledgerContent);
  const reconciliations = parseReconciliationHistory(ledgerContent).map((r) => ({
    id: r.id,
    cols: r.cols
  }));

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: (ctx.now || new Date()).toISOString(),
    ledger: {
      path: ctx.ledgerPath || null,
      schema: meta.schema,
      source: meta.source,
      tier: meta.tier,
      created: meta.created
    },
    stats: {
      total: stats.total,
      done: stats.doneCount,
      remaining: stats.remaining,
      drift: stats.drift,
      counts: stats.counts
    },
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      evidence: t.evidence,
      chain: t.chain,
      notes: t.notes
    })),
    decisions: decisions.map((d) => ({
      id: d.id,
      type: d.type,
      scope: d.scope,
      reason: d.reason,
      evidence: d.evidence
    })),
    reconciliations
  };
}

function parseArgs(argv) {
  const args = { format: 'json', pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') args.ledger = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a.startsWith('--format=')) args.format = a.slice('--format='.length);
    else if (a === '--pretty') args.pretty = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer-export [--ledger <path>] [--cwd <path>] [--format=json] [--pretty]',
    '',
    'Dumps the active ledger as a single structured JSON blob with a',
    `stable schema (schemaVersion: ${EXPORT_SCHEMA_VERSION}). Includes`,
    'metadata, stats, tasks, decisions, reconciliations.',
    '',
    'Use --pretty to indent; default is compact single-line JSON fit',
    'for jq / shell pipes.',
    '',
    'Exit 0 on success, 2 on config error.'
  ].join('\n');
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  if (args.format !== 'json') {
    console.error(`Unsupported --format "${args.format}". Only json is supported.`);
    return 2;
  }

  const cwd = args.cwd || process.cwd();
  const ledgerPath = args.ledger || path.join(cwd, '.plan-enforcer', 'ledger.md');
  if (!fs.existsSync(ledgerPath)) {
    console.error(`Ledger not found at ${ledgerPath}`);
    return 2;
  }

  const ledgerContent = fs.readFileSync(ledgerPath, 'utf8');
  const payload = buildExport(ledgerContent, { ledgerPath });
  const out = args.pretty
    ? JSON.stringify(payload, null, 2)
    : JSON.stringify(payload);
  process.stdout.write(`${out}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, buildExport, parseArgs, usage, EXPORT_SCHEMA_VERSION };

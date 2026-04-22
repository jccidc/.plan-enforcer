#!/usr/bin/env node
// plan-enforcer-why — Reverse lookup: given a file path, print every
// ledger Decision Log row and task row that references it.
//
// Usage:
//   plan-enforcer-why <file-path> [--ledger <path>] [--cwd <path>] [--json]
//   plan-enforcer-why --help
//
// Exit codes:
//   0  at least one row references the file
//   1  no rows reference the file (clean result, not an error)
//   2  config error (no ledger, bad args)

const { resolveWhy } = require('./why');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') args.ledger = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer-why <file-path> [--ledger <path>] [--cwd <path>] [--json]',
    '',
    'Reverse lookup. Scans the active ledger for every Decision Log row',
    'and task row that references the given file path (substring or',
    'basename match). Answers "why is this code here?"',
    '',
    'Exit 0 when the file has hits, 1 when the file has none (still a',
    'clean exit — nothing logged about this file), 2 on config error.'
  ].join('\n');
}

function renderText(result) {
  const lines = [];
  lines.push(`Why ${result.filePath}:`);
  lines.push(`  ledger: ${result.ledgerPath} (schema ${result.schema})`);
  lines.push('');

  lines.push(`Decisions (${result.decisions.length}):`);
  if (result.decisions.length === 0) {
    lines.push('  (no D-row scopes this file)');
  } else {
    for (const d of result.decisions) {
      lines.push(`  ${d.id} [${d.type}] scope: ${d.scope}`);
      if (d.reason) lines.push(`    reason: ${d.reason}`);
      if (d.evidence) lines.push(`    evidence: ${d.evidence}`);
    }
  }
  lines.push('');

  lines.push(`Tasks (${result.tasks.length}):`);
  if (result.tasks.length === 0) {
    lines.push('  (no task row cites this file in evidence or notes)');
  } else {
    for (const t of result.tasks) {
      lines.push(`  ${t.id} [${t.status}] ${t.name}`);
      if (t.evidence) lines.push(`    evidence: ${t.evidence}`);
      if (t.notes) lines.push(`    notes: ${t.notes}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of result.warnings) lines.push(`  ${w}`);
  }

  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  const target = args._[0];
  if (!target) {
    console.error('Missing <file-path>. Example: plan-enforcer-why src/chain.js');
    console.error('');
    console.error(usage());
    return 2;
  }

  const result = resolveWhy(target, { ledgerPath: args.ledger, cwd: args.cwd });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }

  if (result.warnings.some((w) => w.startsWith('Ledger not found'))) return 2;
  if (result.decisions.length === 0 && result.tasks.length === 0) return 1;
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, parseArgs, usage, renderText };

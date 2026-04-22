#!/usr/bin/env node
// plan-enforcer-audit — Ledger integrity check.
//
// Usage:
//   plan-enforcer-audit [--ledger <path>] [--cwd <path>] [--strict] [--json]
//   plan-enforcer-audit --help
//
// Exit codes:
//   0  clean, or warnings only (soft mode)
//   1  --strict + any finding, or errors in either mode
//   2  config error (no ledger)

const { auditLedger } = require('./audit');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') args.ledger = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer-audit [--ledger <path>] [--cwd <path>] [--strict] [--json]',
    '',
    'Structural integrity check on the active ledger:',
    '  - unique task IDs and decision IDs',
    '  - Chain D-refs resolve to real decisions',
    '  - Chain commit SHAs resolve via git',
    '  - verified rows carry evidence with at least one resolved signal',
    '  - done rows with resolvable evidence flagged for promotion',
    '',
    'Exit 0 when clean (or warnings only in soft mode), 1 on any error',
    'or any finding in --strict mode (use in CI), 2 on config error.'
  ].join('\n');
}

function renderText(result, strict) {
  const lines = [];
  lines.push(`Plan Enforcer Audit — ${result.ledgerPath} (schema ${result.schema})`);
  lines.push(`  ${result.counts.tasks} task(s), ${result.counts.decisions} decision(s)`);
  lines.push(`  ${result.counts.errors} error(s), ${result.counts.warnings} warning(s)`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('Clean. No integrity issues.');
    return lines.join('\n');
  }

  for (const f of result.findings) {
    const tag = f.severity === 'error' ? 'ERROR' : 'WARN ';
    const rowBit = f.row ? ` (${f.row})` : '';
    lines.push(`  ${tag} [${f.code}]${rowBit} ${f.message}`);
  }

  lines.push('');
  if (strict && result.findings.length > 0) {
    lines.push('Strict mode: exit 1 on any finding.');
  } else if (result.counts.errors > 0) {
    lines.push('Errors present — exit 1.');
  } else {
    lines.push('Warnings only — exit 0 (pass --strict to fail CI).');
  }
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  const result = auditLedger({ ledgerPath: args.ledger, cwd: args.cwd });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result, args.strict));
  }

  if (result.findings.some((f) => f.code === 'NO_LEDGER')) return 2;
  if (args.strict && result.findings.length > 0) return 1;
  if (result.counts.errors > 0) return 1;
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, parseArgs, usage, renderText };

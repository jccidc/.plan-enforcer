#!/usr/bin/env node
// plan-enforcer - Unified dispatcher.
//
// Routes `plan-enforcer <sub> [args...]` to the corresponding sub-CLI's
// main(argv) function. Exists to contain CLI sprawl: users discover the
// full surface via `plan-enforcer --help` instead of hunting for 10+
// separate bins. The per-subcommand bins still exist for shell muscle
// memory and --version is a pass-through to the package.
//
// Design: minimal. Routing + help only. No new behavior.

const path = require('path');
const fs = require('fs');

const SUBCOMMANDS = {
  awareness: { module: './awareness-cli', blurb: 'Intent rows, orphan asks, task-to-intent lookup' },
  discuss: { module: './discuss-cli', blurb: 'Discuss/clarify a request into an intent packet' },
  status: { module: './status-cli', blurb: 'Scoreboard + current task + unverified rows' },
  logs: { module: './logs-cli', blurb: 'Skipped tasks, drift events, reconciliation history' },
  report: { module: './report-cli', blurb: 'End-of-session summary report' },
  review: { module: './review-cli', blurb: 'Static review of a plan file for drafting gaps' },
  verify: { module: './verify-cli', blurb: 'Goal-backward must-have verifier' },
  'phase-verify': { module: './phase-verify-cli', blurb: 'Phase archive/context verifier from disk artifacts' },
  config: { module: './config-cli', blurb: 'Read / write tier + reconcile + gate settings' },
  chain: { module: './chain-cli', blurb: 'Full audit trail for a task ID' },
  why: { module: './why-cli', blurb: 'Reverse lookup: every D-row touching a file' },
  audit: { module: './audit-cli', blurb: 'Ledger integrity check (--strict for CI)' },
  export: { module: './export-cli', blurb: 'Machine-readable JSON dump of the ledger' },
  lint: { module: './lint-cli', blurb: 'Ledger schema shape validator' }
};

function version() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch (_e) {
    return 'unknown';
  }
}

function usage() {
  const lines = [
    `plan-enforcer ${version()} - unified CLI`,
    '',
    'Usage:',
    '  plan-enforcer <subcommand> [args...]',
    '  plan-enforcer --help',
    '  plan-enforcer --version',
    '',
    'Subcommands:'
  ];
  const width = Math.max(...Object.keys(SUBCOMMANDS).map((k) => k.length));
  for (const [name, meta] of Object.entries(SUBCOMMANDS)) {
    lines.push(`  ${name.padEnd(width)}  ${meta.blurb}`);
  }
  lines.push('');
  lines.push('Run `plan-enforcer <subcommand> --help` for subcommand detail.');
  return lines.join('\n');
}

function main(argv) {
  argv = argv || process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(usage());
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(version());
    return 0;
  }

  const sub = argv[0];
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    console.error(`Unknown subcommand "${sub}". Run \`plan-enforcer --help\` for the list.`);
    return 2;
  }

  const mod = require(entry.module);
  if (typeof mod.main !== 'function') {
    console.error(`Subcommand "${sub}" does not expose a main() function.`);
    return 2;
  }

  const savedArgv = process.argv;
  const subArgs = argv.slice(1);
  process.argv = [savedArgv[0], entry.module, ...subArgs];
  try {
    return mod.main(subArgs);
  } finally {
    process.argv = savedArgv;
  }
}

if (require.main === module) {
  Promise.resolve(main())
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message || String(error));
      process.exit(1);
    });
}

module.exports = { main, usage, SUBCOMMANDS, version };

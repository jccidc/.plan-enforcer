#!/usr/bin/env node
// plan-enforcer-analyze — Objective counts for a plan file.
//
// Usage:
//   plan-enforcer-analyze <plan-file> [--json]
//   plan-enforcer-analyze --help
//
// Exit codes:
//   0  success
//   2  config error (no file, bad args)

const fs = require('fs');
const { analyzePlan } = require('./plan-analyzer');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer-analyze <plan-file> [--json]',
    '',
    'Objective counts over a plan: unique file paths named, test',
    'assertions referenced, dependency declarations. Per-task',
    'breakdown included. Complements subjective plan review.',
    '',
    'Exit 0 on success, 2 on missing file / bad args.'
  ].join('\n');
}

function renderText(result) {
  const lines = [];
  lines.push('Plan Analyzer');
  lines.push(`  file paths named: ${result.file_paths.total}`);
  lines.push(`  test assertions:  ${result.test_assertions}`);
  lines.push(`  dependencies:     ${result.dependencies}`);
  lines.push(`  tasks:            ${result.per_task.length}`);
  lines.push('');
  if (result.per_task.length > 0) {
    lines.push('Per-task breakdown (files / tests / deps):');
    result.per_task.forEach((t, i) => {
      lines.push(`  T${i + 1} [${t.file_paths} / ${t.test_assertions} / ${t.dependencies}]  ${t.title}`);
    });
  }
  if (result.file_paths.unique.length > 0) {
    lines.push('');
    lines.push('Unique file paths:');
    for (const p of result.file_paths.unique) lines.push(`  ${p}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  const path = args._[0];
  if (!path) {
    console.error('Missing <plan-file>. Example: plan-enforcer-analyze docs/plans/foo.md');
    console.error('');
    console.error(usage());
    return 2;
  }
  if (!fs.existsSync(path)) {
    console.error(`Plan file not found: ${path}`);
    return 2;
  }

  const text = fs.readFileSync(path, 'utf8');
  const result = analyzePlan(text);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, parseArgs, usage, renderText };

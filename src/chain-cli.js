#!/usr/bin/env node
// plan-enforcer-chain — Print the full audit trail for a task.
//
// Usage:
//   plan-enforcer-chain <taskId> [--ledger <path>] [--cwd <path>] [--json]
//   plan-enforcer-chain --help
//
// Exit codes:
//   0  task found and rendered
//   1  task not found in ledger
//   2  config error (no ledger, bad args)

const { resolveChain } = require('./chain');

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
    'Usage: plan-enforcer-chain <taskId> [--ledger <path>] [--cwd <path>] [--json]',
    '',
    'Prints the full audit trail for a single task:',
    '  - the ledger task row (status, evidence, notes)',
    '  - every Decision Log entry scoped to the task',
    '  - Chain column references (decisions, commits, verifications, awareness)',
    '  - each chain-referenced commit resolved against git log',
    '  - structural signals parsed from the Evidence cell',
    '',
    'Exit 0 when the task is found, 1 when not found, 2 on config error.'
  ].join('\n');
}

function renderText(result) {
  const lines = [];
  const t = result.task;
  lines.push(`Chain for ${result.taskId}: ${t.name}`);
  lines.push(`  status: ${t.status}`);
  lines.push(`  ledger: ${result.ledgerPath} (schema ${result.schema})`);
  lines.push('');

  lines.push('Evidence:');
  if (!t.evidence) {
    lines.push('  (empty)');
  } else {
    lines.push(`  ${t.evidence}`);
    if (result.evidence && result.evidence.signals.length > 0) {
      for (const s of result.evidence.signals) {
        lines.push(`    ${s.type}: ${s.value} -> ${s.resolution}`);
      }
    }
    if (result.evidence && result.evidence.warnings.length > 0) {
      for (const w of result.evidence.warnings) lines.push(`    ! ${w}`);
    }
  }
  lines.push('');

  lines.push('Chain refs:');
  const refs = result.chainRefs;
  if (refs.decisions.length === 0 && refs.commits.length === 0 && refs.verifications.length === 0 && refs.awareness.length === 0 && refs.unknown.length === 0) {
    lines.push('  (none)');
  } else {
    if (refs.decisions.length > 0) lines.push(`  decisions: ${refs.decisions.join(', ')}`);
    if (refs.commits.length > 0) lines.push(`  commits:   ${refs.commits.join(', ')}`);
    if (refs.verifications.length > 0) lines.push(`  verifs:    ${refs.verifications.join(', ')}`);
    if (refs.awareness.length > 0) lines.push(`  awareness: ${refs.awareness.join(', ')}`);
    if (refs.unknown.length > 0) lines.push(`  unknown:   ${refs.unknown.join(', ')}`);
  }
  lines.push('');

  lines.push('Decisions:');
  if (result.decisions.length === 0) {
    lines.push('  (none — no D-row scopes this task and no D-ref in Chain)');
  } else {
    for (const d of result.decisions) {
      lines.push(`  ${d.id} [${d.type}] ${d.scope}`);
      if (d.reason) lines.push(`    reason: ${d.reason}`);
      if (d.evidence) lines.push(`    evidence: ${d.evidence}`);
    }
  }
  lines.push('');

  lines.push('Commits:');
  if (result.commits.length === 0) {
    lines.push('  (none)');
  } else {
    for (const c of result.commits) {
      if (c.found) {
        const shortSha = c.sha.slice(0, 7);
        lines.push(`  ${shortSha}  ${c.date.slice(0, 10)}  ${c.subject}`);
      } else {
        lines.push(`  ${c.raw}  (NOT FOUND in git log)`);
      }
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

  const taskId = args._[0];
  if (!taskId) {
    console.error('Missing <taskId>. Example: plan-enforcer-chain T5');
    console.error('');
    console.error(usage());
    return 2;
  }
  if (!/^T\d+$/i.test(taskId)) {
    console.error(`Invalid task ID "${taskId}". Expected format: T<number> (e.g. T5).`);
    return 2;
  }

  const result = resolveChain(taskId, { ledgerPath: args.ledger, cwd: args.cwd });

  if (!result.found) {
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(result.warnings.join('\n') || `Task ${taskId} not found.`);
    }
    return 1;
  }

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

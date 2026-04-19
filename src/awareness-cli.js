#!/usr/bin/env node

const {
  addIntent,
  appendAwarenessRefsToTask,
  captureLatestIntent,
  currentIntents,
  loadAwarenessState,
  orphanIntents,
  taskAwareness
} = require('./awareness');

function usage() {
  return [
    'Usage:',
    '  plan-enforcer-awareness list [--all] [--json] [--cwd <path>] [--awareness <path>]',
    '  plan-enforcer-awareness orphans [--json] [--cwd <path>] [--awareness <path>] [--ledger <path>]',
    '  plan-enforcer-awareness task <Tn> [--json] [--cwd <path>] [--awareness <path>] [--ledger <path>]',
    '  plan-enforcer-awareness capture-latest [--if-empty] [--json] [--cwd <path>] [--awareness <path>] [--user-messages <path>]',
    '  plan-enforcer-awareness add --intent "<quote>" [--source <source>] [--json] [--cwd <path>] [--awareness <path>]',
    '  plan-enforcer-awareness link <Tn> <Im>[,In] [--json] [--cwd <path>] [--ledger <path>]',
    '',
    'Commands:',
    '  list     Show current awareness intents',
    '  orphans  Show intents with no linked ledger task',
    '  task     Show awareness refs behind a task ID',
    '  capture-latest  Append the latest captured raw prompt as a new intent row',
    '  add      Append a new this-session intent row',
    '  link     Append awareness refs to a task Chain cell'
  ].join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--if-empty') args.ifEmpty = true;
    else if (arg === '--cwd') args.cwd = argv[++i];
    else if (arg === '--awareness') args.awarenessPath = argv[++i];
    else if (arg === '--ledger') args.ledgerPath = argv[++i];
    else if (arg === '--user-messages') args.userMessagesPath = argv[++i];
    else if (arg === '--intent') args.intent = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else args._.push(arg);
  }
  args.command = args._[0] || '';
  return args;
}

function renderIntents(intents) {
  if (intents.length === 0) return 'No awareness intents.';
  const lines = [];
  for (const intent of intents) {
    const tags = [];
    tags.push(intent.scope);
    if (!intent.active) tags.push('superseded');
    if ((intent.narrowed || []).length > 0) tags.push(`narrowed:${intent.narrowed.length}`);
    lines.push(`${intent.id} [${tags.join(', ')}] ${intent.quote}`);
    lines.push(`  source: ${intent.source || 'unknown'}  captured: ${intent.captured || 'unknown'}`);
  }
  return lines.join('\n');
}

function renderTask(result, taskId) {
  if (!result) return `Task ${taskId} not found in ledger.`;
  const lines = [
    `${result.task.id}: ${result.task.name}`,
    `  status: ${result.task.status}`,
    `  awareness refs: ${result.refs.length > 0 ? result.refs.join(', ') : '(none)'}`
  ];
  if (result.restates.length > 0) {
    lines.push('  restates:');
    for (const restate of result.restates) {
      lines.push(`    ${restate.id}: ${restate.summary}`);
    }
  }
  if (result.intents.length > 0) {
    lines.push('  intents:');
    for (const intent of result.intents) {
      lines.push(`    ${intent.id}: ${intent.quote}`);
    }
  }
  if (result.issues.length > 0) {
    lines.push('  issues:');
    for (const issue of result.issues) {
      lines.push(`    ${issue.code}: ${issue.message}`);
    }
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    console.log(usage());
    return 0;
  }

  const opts = {
    cwd: args.cwd,
    awarenessPath: args.awarenessPath,
    ledgerPath: args.ledgerPath,
    userMessagesPath: args.userMessagesPath
  };

  if (args.command === 'list') {
    const loaded = loadAwarenessState(opts);
    const intents = currentIntents(loaded.state, { includeSuperseded: args.all });
    if (args.json) {
      console.log(JSON.stringify({
        awarenessPath: loaded.awarenessPath,
        schema: loaded.state.schema,
        intents
      }, null, 2));
    } else {
      console.log(renderIntents(intents));
    }
    return 0;
  }

  if (args.command === 'orphans') {
    const loaded = loadAwarenessState(opts);
    const orphans = orphanIntents(loaded.state, loaded.ledgerPath);
    if (args.json) {
      console.log(JSON.stringify({
        awarenessPath: loaded.awarenessPath,
        ledgerPath: loaded.ledgerPath,
        orphans
      }, null, 2));
    } else {
      console.log(renderIntents(orphans));
    }
    return 0;
  }

  if (args.command === 'task') {
    const taskId = args._[1];
    if (!taskId) {
      console.error('Missing task ID. Example: plan-enforcer-awareness task T5');
      return 2;
    }
    const loaded = loadAwarenessState(opts);
    const result = taskAwareness(taskId, loaded.state, loaded.ledgerPath);
    if (args.json) {
      console.log(JSON.stringify({
        awarenessPath: loaded.awarenessPath,
        ledgerPath: loaded.ledgerPath,
        result
      }, null, 2));
    } else {
      console.log(renderTask(result, taskId));
    }
    return result ? 0 : 1;
  }

  if (args.command === 'add') {
    if (!args.intent) {
      console.error('Missing --intent "<quote>"');
      return 2;
    }
    const row = addIntent({
      cwd: args.cwd,
      awarenessPath: args.awarenessPath,
      quote: args.intent,
      source: args.source || 'manual'
    });
    if (args.json) {
      console.log(JSON.stringify(row, null, 2));
    } else {
      console.log(`Added ${row.id} to ${row.awarenessPath}`);
    }
    return 0;
  }

  if (args.command === 'capture-latest') {
    try {
      const result = captureLatestIntent({
        cwd: args.cwd,
        awarenessPath: args.awarenessPath,
        userMessagesPath: args.userMessagesPath,
        ifEmpty: args.ifEmpty,
        source: args.source
      });
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.skipped) {
        console.log(`Skipped capture-latest; awareness already has ${result.existingIntents} intent(s)`);
      } else {
        console.log(`Captured ${result.id} from ${result.source} into ${result.awarenessPath}`);
      }
      return 0;
    } catch (error) {
      console.error(error.message);
      return 1;
    }
  }

  if (args.command === 'link') {
    const taskId = args._[1];
    const refs = args._[2];
    if (!taskId || !refs) {
      console.error('Missing args. Example: plan-enforcer-awareness link T5 I3,I4');
      return 2;
    }
    const result = appendAwarenessRefsToTask(taskId, refs, opts);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Linked ${result.refs.join(', ')} to ${result.taskId} in ${result.ledgerPath}`);
    }
    return 0;
  }

  console.error(`Unknown command "${args.command}"`);
  console.error('');
  console.error(usage());
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  parseArgs,
  renderIntents,
  renderTask,
  usage
};

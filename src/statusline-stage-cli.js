#!/usr/bin/env node

const path = require('path');
const { clearStatuslineState, writeNamedStatuslineStage } = require('./statusline-state');

function usage() {
  return [
    'Usage: node statusline-stage-cli.js <stage> [--label <text>] [--title <text>] [--cwd <path>]',
    '       node statusline-stage-cli.js --clear [--cwd <path>]',
    '',
    'Examples:',
    '  node statusline-stage-cli.js discuss --label 1-DISCUSS',
    '  node statusline-stage-cli.js draft --label 2-DRAFT --title README relaunch',
    '  node statusline-stage-cli.js review --label 3-REVIEW --title docs/plans/my-plan.md',
    '  node statusline-stage-cli.js --clear'
  ].join('\n');
}

function parseArgs(argv = []) {
  const args = {
    stage: '',
    label: '',
    title: '',
    cwd: process.cwd(),
    clear: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--clear') args.clear = true;
    else if (arg === '--label') args.label = argv[++i] || '';
    else if (arg === '--title') args.title = argv[++i] || '';
    else if (arg === '--cwd') args.cwd = path.resolve(process.cwd(), argv[++i] || '');
    else if (!args.stage) args.stage = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 1;
  }

  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (args.clear) {
    clearStatuslineState({ cwd: args.cwd });
    return 0;
  }

  if (!args.stage) {
    console.error('Missing stage.');
    console.error(usage());
    return 1;
  }

  writeNamedStatuslineStage(args.stage, {
    cwd: args.cwd,
    label: args.label || String(args.stage).toUpperCase(),
    title: args.title || null,
    source: 'statusline-stage-cli'
  });
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  parseArgs,
  usage
};

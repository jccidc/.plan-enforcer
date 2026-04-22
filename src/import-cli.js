#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { generateLedger, extractMustHaveRows, extractTasks, findPlanFile } = require('./plan-detector');
const { DEFAULTS, readConfig, writeConfig } = require('./config');

function usage() {
  return [
    'Usage: plan-enforcer-import [plan-path] [--plan <path>] [--cwd <path>] [--tier advisory|structural|enforced] [--force]',
    '',
    'Imports an existing markdown plan into .plan-enforcer/ledger.md.',
    'If no plan path is provided, Plan Enforcer auto-detects one from the project root.'
  ].join('\n');
}

function parseArgs(argv = []) {
  const args = {
    plan: '',
    cwd: process.cwd(),
    tier: '',
    force: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--cwd') args.cwd = path.resolve(process.cwd(), argv[++i]);
    else if (arg === '--plan') args.plan = argv[++i];
    else if (arg === '--tier') args.tier = argv[++i];
    else if (!args.plan) args.plan = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function resolvePlanPath(args) {
  if (args.plan) {
    const explicit = path.resolve(args.cwd, args.plan);
    if (!fs.existsSync(explicit)) {
      throw new Error(`Plan path not found: ${explicit}`);
    }
    return explicit;
  }

  const detected = findPlanFile(args.cwd);
  if (!detected) {
    throw new Error('No plan file found. Pass a plan path or add one under docs/plans/, PLAN.md, docs/PLAN.md, or .planning/*/PLAN.md.');
  }
  return path.resolve(args.cwd, detected);
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(usage());
    console.error(error.message);
    return 1;
  }

  if (args.help) {
    console.log(usage());
    return 0;
  }

  try {
    const planPath = resolvePlanPath(args);
    const extracted = extractTasks(planPath);
    if (!extracted || extracted.tasks.length === 0) {
      throw new Error(`No executable tasks found in ${planPath}. Use a supported plan shape before importing.`);
    }

    const projectRoot = args.cwd;
    const enforcerDir = path.join(projectRoot, '.plan-enforcer');
    const ledgerPath = path.join(enforcerDir, 'ledger.md');
    if (fs.existsSync(ledgerPath) && !args.force) {
      throw new Error(`Ledger already exists at ${ledgerPath}. Re-run with --force to replace it.`);
    }

    fs.mkdirSync(enforcerDir, { recursive: true });

    const relativePlan = path.relative(projectRoot, planPath).replace(/\\/g, '/');
    const configPath = path.join(enforcerDir, 'config.md');
    const currentConfig = readConfig(configPath);
    const tier = args.tier || currentConfig.tier || DEFAULTS.tier;
    const nextConfig = { ...currentConfig, tier };
    const ledger = generateLedger(relativePlan, extracted.taskRows, tier);
    fs.writeFileSync(ledgerPath, ledger);
    writeConfig(configPath, nextConfig);

    const mustHaves = extractMustHaveRows(fs.readFileSync(planPath, 'utf8'));
    console.log('---Plan Enforcer Import ----------------------------');
    console.log(` Plan: ${relativePlan}`);
    console.log(` Format: ${extracted.format}`);
    console.log(` Tasks: ${extracted.tasks.length}`);
    console.log(` Must-haves: ${mustHaves.length}`);
    console.log(` Tier: ${tier}`);
    console.log(` Ledger: .plan-enforcer/ledger.md`);
    console.log('---------------------------------------------------');
    console.log('Next:');
    console.log('  plan-enforcer status');
    console.log('  plan-enforcer review <plan-path>   # if you want one more plan check');
    console.log('  claude                            # then execute the imported plan');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  parseArgs,
  resolvePlanPath,
  usage
};

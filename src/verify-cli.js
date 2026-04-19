#!/usr/bin/env node
// plan-enforcer-verify - Goal-backward phase verifier.
//
// Reads the active ledger's must-haves (plan source `## Must-Haves`
// section) and reports on each. Structural mode asks whether the
// current task / decision state covers the must-have. Awareness mode
// (`--with-awareness`) also asks whether each must-have is explicitly
// tied back to user-intent rows and whether live intents have any
// must-have or task target.

const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');
const { parseDecisionLog, parseTaskRows, parseMetadata } = require('./ledger-parser');
const { extractMustHaveRows } = require('./plan-detector');
const { currentIntents, expandIntentRefs, resolveTaskAwareness } = require('./awareness');
const { readAwareness } = require('./awareness-parser');

function resolveDefaults(args) {
  const cwd = process.cwd();
  let ledger = args.ledger;
  if (!ledger) {
    const candidate = path.join(cwd, '.plan-enforcer', 'ledger.md');
    if (fs.existsSync(candidate)) ledger = candidate;
  }
  if (!ledger || !fs.existsSync(ledger)) {
    return { error: 'No ledger found. Run with --ledger <path> or from a project root with .plan-enforcer/ledger.md.' };
  }

  let plan = args.plan;
  if (!plan) {
    const ledgerContent = fs.readFileSync(ledger, 'utf8');
    const meta = parseMetadata(ledgerContent);
    if (meta.source && meta.source !== 'unknown') {
      const projectRoot = path.dirname(path.dirname(ledger));
      const maybe = path.isAbsolute(meta.source) ? meta.source : path.join(projectRoot, meta.source);
      if (fs.existsSync(maybe)) plan = maybe;
    }
  }
  if (!plan || !fs.existsSync(plan)) {
    return { error: `No plan found. Ledger referenced "${args.plan || 'source from metadata'}". Run with --plan <path>.` };
  }

  return { ledger, plan };
}

function resolveAwarenessContext(args, ledgerPath) {
  const projectRoot = path.dirname(path.dirname(ledgerPath));
  const awarenessPath = args.awareness
    ? path.resolve(process.cwd(), args.awareness)
    : path.join(projectRoot, '.plan-enforcer', 'awareness.md');
  const configPath = path.join(projectRoot, '.plan-enforcer', 'config.md');
  return {
    awarenessPath,
    config: readConfig(configPath),
    state: readAwareness(awarenessPath)
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') args.ledger = argv[++i];
    else if (a === '--plan') args.plan = argv[++i];
    else if (a === '--awareness') args.awareness = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--with-awareness') args.withAwareness = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer-verify [--ledger <path>] [--plan <path>] [--with-awareness] [--awareness <path>] [--json]',
    '',
    'Reads the plan\'s `## Must-Haves` section and reports goal-backward',
    'satisfaction against the current ledger. Exit 0 when all pass, 1',
    'when any fail, 2 on configuration errors.',
    '',
    '--with-awareness adds two checks:',
    '  - each must-have needs at least one linked A:I<n> / A:R<n> ref',
    '  - each live intent needs a must-have or task target'
  ].join('\n');
}

function normalizeMustHaveRow(mh, index) {
  if (mh && typeof mh === 'object' && !Array.isArray(mh)) {
    return {
      tag: String(mh.tag || `MH${index + 1}`).toUpperCase(),
      text: String(mh.text || '').trim(),
      awarenessRefs: Array.isArray(mh.awarenessRefs) ? mh.awarenessRefs : []
    };
  }
  return {
    tag: `MH${index + 1}`,
    text: String(mh || '').trim(),
    awarenessRefs: []
  };
}

function scoreMustHave(mh, index, taskRows, decisionRows, opts = {}) {
  const row = normalizeMustHaveRow(mh, index);
  const tagRe = new RegExp(`\\b${row.tag}\\b`, 'i');

  const coveringTasks = taskRows.filter((r) => {
    if (tagRe.test(r.evidence) || tagRe.test(r.notes)) return true;
    if (r.chain && r.chain.some((c) => tagRe.test(c))) return true;
    return false;
  });
  const coveringDecisions = decisionRows.filter((d) => tagRe.test(d.reason) || tagRe.test(d.evidence) || tagRe.test(d.scope));

  const anyVerified = coveringTasks.some((r) => r.status === 'verified');
  const anyCovering = coveringTasks.length + coveringDecisions.length > 0;

  let verdict;
  if (anyVerified) verdict = 'PASS';
  else if (anyCovering) verdict = 'PARTIAL';
  else verdict = 'UNKNOWN';

  const awarenessIssues = [];
  let linkedIntents = [];
  if (opts.awarenessState && opts.awarenessState.schema !== 'missing') {
    const activeIntentIds = new Set(currentIntents(opts.awarenessState).map((intent) => intent.id));
    linkedIntents = expandIntentRefs(row.awarenessRefs, opts.awarenessState)
      .filter((id) => activeIntentIds.has(id));
    if (linkedIntents.length === 0) {
      awarenessIssues.push({
        code: 'MH_NO_INTENT_LINK',
        message: `${row.tag} has no linked awareness intent`,
        row: row.tag
      });
    }
  }

  return {
    tag: row.tag,
    text: row.text,
    verdict,
    covering_tasks: coveringTasks.map((r) => ({ id: r.id, status: r.status })),
    covering_decisions: coveringDecisions.map((d) => ({ id: d.id, type: d.type })),
    awareness_refs: row.awarenessRefs,
    linked_intents: linkedIntents,
    awareness_issues: awarenessIssues,
    pass_with_awareness: verdict === 'PASS' && awarenessIssues.length === 0
  };
}

function buildAwarenessCoverage(mustHaves, taskRows, awarenessState, opts = {}) {
  if (!awarenessState || awarenessState.schema === 'missing') {
    return {
      initialized: false,
      issues: [],
      must_have_targets: {},
      task_targets: {},
      warning: 'Awareness not initialized; skipping awareness-target checks.'
    };
  }

  const liveIntents = currentIntents(awarenessState);
  const liveIntentIds = new Set(liveIntents.map((intent) => intent.id));
  const mustHaveTargets = {};
  const targetedByMustHave = new Set();
  for (let i = 0; i < mustHaves.length; i++) {
    const row = normalizeMustHaveRow(mustHaves[i], i);
    const refs = expandIntentRefs(row.awarenessRefs, awarenessState)
      .filter((id) => liveIntentIds.has(id));
    mustHaveTargets[row.tag] = refs;
    refs.forEach((id) => targetedByMustHave.add(id));
  }

  const taskTargets = {};
  const targetedByTask = new Set();
  for (const task of taskRows) {
    const assessment = resolveTaskAwareness(task, awarenessState, { config: opts.config });
    const refs = assessment.validIntentIds.filter((id) => liveIntentIds.has(id));
    taskTargets[task.id] = refs;
    refs.forEach((id) => targetedByTask.add(id));
  }

  const issues = [];
  for (const intent of liveIntents) {
    if (targetedByMustHave.has(intent.id) || targetedByTask.has(intent.id)) continue;
    issues.push({
      code: 'INTENT_NO_TARGET',
      message: `Intent ${intent.id} has no must-have or task target`,
      row: intent.id,
      quote: intent.quote
    });
  }

  return {
    initialized: true,
    issues,
    must_have_targets: mustHaveTargets,
    task_targets: taskTargets,
    warning: ''
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  const resolved = resolveDefaults(args);
  if (resolved.error) {
    console.error(resolved.error);
    return 2;
  }

  const ledger = fs.readFileSync(resolved.ledger, 'utf8');
  const plan = fs.readFileSync(resolved.plan, 'utf8');

  const mustHaveRows = extractMustHaveRows(plan);
  const taskRows = parseTaskRows(ledger);
  const decisionRows = parseDecisionLog(ledger);

  if (mustHaveRows.length === 0) {
    const msg = `No ## Must-Haves section found in ${resolved.plan}. Add one to enable verify.`;
    if (args.json) console.log(JSON.stringify({ mustHaves: [], warning: msg }, null, 2));
    else console.error(msg);
    return 2;
  }

  const awareness = args.withAwareness
    ? resolveAwarenessContext(args, resolved.ledger)
    : null;
  const results = mustHaveRows.map((mh, i) => scoreMustHave(mh, i, taskRows, decisionRows, {
    awarenessState: awareness ? awareness.state : null
  }));
  const awarenessCoverage = args.withAwareness
    ? buildAwarenessCoverage(mustHaveRows, taskRows, awareness.state, { config: awareness.config })
    : null;

  const failingResults = results.filter((result) =>
    result.verdict !== 'PASS' || (args.withAwareness && result.awareness_issues.length > 0)
  );
  const passCount = results.length - failingResults.length;
  const awarenessIssues = awarenessCoverage ? awarenessCoverage.issues : [];
  const hasFailure = failingResults.length > 0 || awarenessIssues.length > 0;

  if (args.json) {
    console.log(JSON.stringify({
      ledger: resolved.ledger,
      plan: resolved.plan,
      pass: passCount,
      total: results.length,
      results,
      awareness: awarenessCoverage
        ? {
            enabled: true,
            path: awareness.awarenessPath,
            ...awarenessCoverage
          }
        : {
            enabled: false
          }
    }, null, 2));
    return hasFailure ? 1 : 0;
  }

  console.log(`Plan Enforcer Verify - ${resolved.plan}`);
  console.log(`Ledger: ${resolved.ledger}`);
  if (awarenessCoverage) {
    const suffix = awarenessCoverage.initialized ? '' : ' (missing)';
    console.log(`Awareness: ${awareness.awarenessPath}${suffix}`);
  }
  console.log('');
  console.log(`${passCount}/${results.length} must-haves verified${args.withAwareness ? ' with awareness' : ''}.`);
  console.log('');
  for (const result of results) {
    console.log(`[${result.verdict}] ${result.tag}  ${result.text}`);
    if (result.covering_tasks.length > 0) {
      console.log(`    tasks: ${result.covering_tasks.map((task) => `${task.id}(${task.status})`).join(', ')}`);
    }
    if (result.covering_decisions.length > 0) {
      console.log(`    decisions: ${result.covering_decisions.map((decision) => `${decision.id}(${decision.type})`).join(', ')}`);
    }
    if (args.withAwareness) {
      if (result.linked_intents.length > 0) {
        console.log(`    awareness: ${result.linked_intents.join(', ')}`);
      }
      for (const issue of result.awareness_issues) {
        console.log(`    ${issue.code}: ${issue.message}`);
      }
    }
  }
  console.log('');
  if (awarenessCoverage && awarenessCoverage.warning) {
    console.log(`Awareness note: ${awarenessCoverage.warning}`);
    console.log('');
  }
  if (!hasFailure) {
    console.log('All must-haves PASS. Phase can close.');
    return 0;
  }

  console.log('Needs attention:');
  for (const result of failingResults) {
    if (result.verdict !== 'PASS') {
      console.log(`  ${result.tag}: ${result.verdict}. Add a verified task row citing ${result.tag} in evidence/chain, or a Decision Log scope referencing ${result.tag}.`);
    }
    for (const issue of result.awareness_issues) {
      console.log(`  ${result.tag}: ${issue.code}. Add A:I<n> / A:R<n> refs to the must-have line.`);
    }
  }
  for (const issue of awarenessIssues) {
    console.log(`  ${issue.row}: ${issue.code}. Link the intent from a must-have or a task Chain cell.`);
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  buildAwarenessCoverage,
  main,
  normalizeMustHaveRow,
  parseArgs,
  resolveAwarenessContext,
  resolveDefaults,
  scoreMustHave,
  usage
};

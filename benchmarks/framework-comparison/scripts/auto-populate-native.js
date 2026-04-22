#!/usr/bin/env node
// Auto-populate the objective fields of the native scorecard from ledger data.
//
// Usage:
//   node auto-populate-native.js <results-dir>
//
// For each results/<scenario>/native/ directory with a ledger.md:
// - parse completion %, verified %, skipped, done-unverified, decisions, reconciliations
// - emit a scorecard.json with objective fields filled in
// - leave rubric scores at 0 for human judge

const fs = require('fs');
const path = require('path');

// Locate the shared ledger parser — works both in-repo and when the benchmark ships
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const parserPath = path.join(REPO_ROOT, 'src', 'ledger-parser.js');
if (!fs.existsSync(parserPath)) {
  console.error(`Cannot find ledger parser at ${parserPath}`);
  process.exit(1);
}
const { parseLedger, parseDecisionLog, parseReconciliationHistory } = require(parserPath);
const { summarizeLogsForDir } = require('./audit-native-ledger-ops.js');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'scorecard.json');

function populateForRun(runDir, scenarioId, size) {
  const ledgerPath = path.join(runDir, 'ledger.md');
  const outPath = path.join(runDir, 'scorecard.json');
  const objectivesPath = path.join(runDir, 'objectives.json');
  const metaPath = path.join(runDir, 'meta.json');
  const archiveDir = path.join(runDir, 'archive');

  const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  template.scenario_id = scenarioId;
  template.system = path.basename(runDir);
  if (!size && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      size = meta.size || null;
    } catch (_e) {}
  }
  if (size) template.plan_size = size;

  const objectives = {
    has_ledger: false,
    total_tasks: 0,
    verified: 0,
    done_unverified: 0,
    skipped: 0,
    blocked: 0,
    pending: 0,
    in_progress: 0,
    completion_pct: 0,
    verified_pct: 0,
    decisions_count: 0,
    reconciliations_count: 0,
    source_plan: null
  };

  const archiveLedgers = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md')).sort()
    : [];

  if (archiveLedgers.length > 0) {
    const archiveLedger = fs.readFileSync(path.join(archiveDir, archiveLedgers[archiveLedgers.length - 1]), 'utf8');
    const stats = parseFlexibleLedger(archiveLedger);
    objectives.has_ledger = true;
    objectives.total_tasks = stats.total;
    objectives.verified = stats.counts.verified;
    objectives.done_unverified = stats.counts.done;
    objectives.skipped = stats.counts.skipped + stats.counts.superseded;
    objectives.blocked = stats.counts.blocked;
    objectives.pending = stats.counts.pending;
    objectives.in_progress = stats.counts['in-progress'];
    const completed = stats.counts.verified + stats.counts.done + objectives.skipped + objectives.blocked;
    objectives.completion_pct = stats.total > 0 ? Math.round((completed / stats.total) * 100) : 0;
    const donePlusVerified = stats.counts.verified + stats.counts.done;
    objectives.verified_pct = donePlusVerified > 0 ? Math.round((stats.counts.verified / donePlusVerified) * 100) : 0;
    objectives.decisions_count = parseFlexibleDecisions(archiveLedger).length;
    objectives.reconciliations_count = parseFlexibleReconciliations(archiveLedger).length;
    objectives.source_plan = stats.source;
    objectives.note = 'Ledger was auto-archived during run; stats pulled from archive';
  } else if (fs.existsSync(ledgerPath)) {
    const ledger = fs.readFileSync(ledgerPath, 'utf8');
    const stats = parseFlexibleLedger(ledger);
    const decisions = parseFlexibleDecisions(ledger);
    const recons = parseFlexibleReconciliations(ledger);

    objectives.has_ledger = true;
    objectives.total_tasks = stats.total;
    objectives.verified = stats.counts.verified;
    objectives.done_unverified = stats.counts.done;
    objectives.skipped = stats.counts.skipped + stats.counts.superseded;
    objectives.blocked = stats.counts.blocked;
    objectives.pending = stats.counts.pending;
    objectives.in_progress = stats.counts['in-progress'];
    const completed = stats.counts.verified + stats.counts.done + objectives.skipped + objectives.blocked;
    objectives.completion_pct = stats.total > 0 ? Math.round((completed / stats.total) * 100) : 0;
    const donePlusVerified = stats.counts.verified + stats.counts.done;
    objectives.verified_pct = donePlusVerified > 0 ? Math.round((stats.counts.verified / donePlusVerified) * 100) : 0;
    objectives.decisions_count = decisions.length;
    objectives.reconciliations_count = recons.length;
    objectives.source_plan = stats.source;
  }

  const logDir = path.join(runDir, 'session-logs');
  const logSummary = summarizeLogsForDir(logDir);
  if (logSummary) {
    objectives.session_logs_count = logSummary.sessions.length;
    objectives.total_tool_calls = logSummary.totals.total_tool_calls;
    objectives.ledger_ops = logSummary.totals.ledger_ops;
    objectives.src_ops = logSummary.totals.src_ops;
    objectives.code_write_ops = logSummary.totals.code_write_ops;
    objectives.bash_glob_grep_ops = logSummary.totals.bash_glob_grep_ops;
    objectives.ledger_ratio = logSummary.totals.ledger_ratio;
  } else {
    objectives.session_logs_count = 0;
    objectives.total_tool_calls = null;
    objectives.ledger_ops = null;
    objectives.ledger_ratio = null;
  }

  const recoveryRe = /=== NATIVE RECOVERY PASS \d+ ===/g;
  const countRecoveries = (filePath) => {
    if (!fs.existsSync(filePath)) return 0;
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const matches = text.match(recoveryRe);
      return matches ? matches.length : 0;
    } catch (_e) {
      return 0;
    }
  };
  const outputTxtPath = path.join(runDir, 'output.txt');
  const outputResumedPath = path.join(runDir, 'output-resumed.txt');
  if (fs.existsSync(outputTxtPath) || fs.existsSync(outputResumedPath)) {
    objectives.recovery_passes = countRecoveries(outputTxtPath) + countRecoveries(outputResumedPath);
  } else {
    objectives.recovery_passes = null;
  }

  objectives.first_pass_clean = (objectives.recovery_passes === 0);

  const hardGateRe = /PLAN ENFORCER \[hard gate\]: session close refused/g;
  const countHardGate = (filePath) => {
    if (!fs.existsSync(filePath)) return 0;
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const matches = text.match(hardGateRe);
      return matches ? matches.length : 0;
    } catch (_e) {
      return 0;
    }
  };
  objectives.silent_completion_caught = countHardGate(outputTxtPath) + countHardGate(outputResumedPath);

  const usageSummaryPath = path.join(runDir, 'usage-summary.json');
  if (fs.existsSync(usageSummaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(usageSummaryPath, 'utf8'));
      objectives.input_tokens = summary.input_tokens;
      objectives.output_tokens = summary.output_tokens;
      objectives.cache_read_input_tokens = summary.cache_read_input_tokens;
      objectives.cache_creation_input_tokens = summary.cache_creation_input_tokens;
      objectives.total_tokens = summary.total_tokens;
      objectives.total_cost_usd = summary.total_cost_usd;
      objectives.sessions_counted = summary.sessions_counted;
    } catch (_e) {
      objectives.total_cost_usd = null;
    }
  }

  fs.writeFileSync(objectivesPath, JSON.stringify(objectives, null, 2));

  const findings = [
    `Completion: ${objectives.completion_pct}%`,
    `Verified: ${objectives.verified_pct}%`,
    `Total tasks: ${objectives.total_tasks}`,
    `Decisions logged: ${objectives.decisions_count}`,
    `Reconciliations: ${objectives.reconciliations_count}`,
    `Done but not verified: ${objectives.done_unverified}`,
    `Skipped/superseded: ${objectives.skipped}`
  ];
  if (objectives.ledger_ratio != null) {
    const pct = Math.round(objectives.ledger_ratio * 100);
    const alarm = pct >= 50 ? ' [BURN]' : '';
    findings.push(`Ledger-op ratio: ${objectives.ledger_ops}/${objectives.total_tool_calls} (${pct}%)${alarm}`);
  }
  if (objectives.recovery_passes != null) {
    const alarm = objectives.recovery_passes > 0 ? ' [DIRTY]' : '';
    findings.push(`Recovery passes: ${objectives.recovery_passes}${alarm}`);
  }
  if (typeof objectives.first_pass_clean === 'boolean') {
    findings.push(`First-pass clean: ${objectives.first_pass_clean ? 'yes' : 'no'}`);
  }
  if (typeof objectives.silent_completion_caught === 'number' && objectives.silent_completion_caught > 0) {
    findings.push(`Silent-completion attempts caught by hard gate: ${objectives.silent_completion_caught}`);
  }
  if (objectives.total_cost_usd != null) {
    const fmt = (n) => n == null ? '?' : n.toLocaleString();
    const costStr = `$${objectives.total_cost_usd.toFixed(4)}`;
    findings.push(`Tokens: ${fmt(objectives.input_tokens)} in / ${fmt(objectives.output_tokens)} out / ${fmt(objectives.cache_read_input_tokens)} cache-read / ${fmt(objectives.cache_creation_input_tokens)} cache-create`);
    findings.push(`Billable cost: ${costStr} (${objectives.sessions_counted || 0} session(s))`);
  }
  template.findings = findings;
  fs.writeFileSync(outPath, JSON.stringify(template, null, 2));
  console.log(`  ${scenarioId}/native: ${objectives.completion_pct}% complete, ${objectives.verified} verified, ${objectives.decisions_count} decisions`);
}

function findNativeRuns(rootDir) {
  const runs = [];
  if (!fs.existsSync(rootDir)) return runs;

  const topEntries = fs.readdirSync(rootDir).filter((e) => fs.statSync(path.join(rootDir, e)).isDirectory());
  const nativeVariants = ['native', 'native-advisory', 'native-structural', 'native-enforced'];

  for (const top of topEntries) {
    const topPath = path.join(rootDir, top);
    let pushedFlat = false;
    for (const variant of nativeVariants) {
      const flat = path.join(topPath, variant);
      if (fs.existsSync(path.join(flat, 'meta.json'))) {
        runs.push({ dir: flat, label: `${top}/${variant}`, scenarioId: top });
        pushedFlat = true;
      }
    }
    if (pushedFlat) continue;
    const scenarioEntries = fs.readdirSync(topPath).filter((e) => fs.statSync(path.join(topPath, e)).isDirectory());
    for (const scenario of scenarioEntries) {
      for (const variant of nativeVariants) {
        const nested = path.join(topPath, scenario, variant);
        if (fs.existsSync(path.join(nested, 'meta.json'))) {
          runs.push({ dir: nested, label: `${top}/${scenario}/${variant}`, scenarioId: scenario, size: top });
        }
      }
    }
  }

  return runs;
}

function main() {
  const resultsDir = process.argv[2] || path.resolve(__dirname, '..', 'results');
  if (!fs.existsSync(resultsDir)) {
    console.error(`Results dir not found: ${resultsDir}`);
    process.exit(1);
  }

  console.log(`Scanning ${resultsDir} for native runs...`);
  const runs = findNativeRuns(resultsDir);
  if (runs.length === 0) {
    console.log('No native runs found.');
    return;
  }

  for (const run of runs) {
    populateForRun(run.dir, run.scenarioId, run.size);
  }

  console.log(`Done (${runs.length} native run(s)). Human judge can now fill rubric 0-5 scores in each scorecard.json.`);
}

if (require.main === module) {
  main();
}

module.exports = { populateForRun };

function splitRowCells(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (ch === '`') { inCode = !inCode; cur += ch; continue; }
    if (ch === '|' && !inCode) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  const trimmed = cells.map((c) => c.trim());
  if (trimmed.length >= 2 && trimmed[0] === '') trimmed.shift();
  if (trimmed.length >= 1 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed;
}

function normalizeStatus(raw) {
  return raw.trim().toLowerCase().replace(/\s*\(.*$/, '').trim();
}

function parseFlexibleLedger(ledger) {
  const parsed = parseLedger(ledger);
  if (parsed.total > 0) return parsed;

  const counts = { pending: 0, 'in-progress': 0, done: 0, verified: 0, skipped: 0, blocked: 0, superseded: 0 };
  const lines = ledger.split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*\|\s*#\s*\|/i.test(line)) continue;
    if (/^\s*\|\s*:?-+/.test(line)) continue;
    if (!/^\s*\|\s*\d+\s*\|/.test(line)) continue;
    const cells = splitRowCells(line.trim());
    if (cells.length < 3) continue;
    const status = normalizeStatus(cells[2] || '');
    if (status === 'verified') counts.verified += 1;
    else if (status === 'done') counts.done += 1;
    else if (status === 'not started' || status === 'pending') counts.pending += 1;
    else if (status === 'in progress' || status === 'in-progress') counts['in-progress'] += 1;
    else if (status === 'blocked') counts.blocked += 1;
    else if (status === 'skipped') counts.skipped += 1;
    else if (status === 'superseded') counts.superseded += 1;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const doneCount = counts.done + counts.verified;
  const remaining = counts.pending + counts['in-progress'];
  const sourceMatch = ledger.match(/\*\*Plan:\*\*\s*(.+)$/m) || ledger.match(/^Plan:\s*(.+)$/m);

  return {
    counts,
    total,
    doneCount,
    remaining,
    drift: /\bdrift\b/i.test(ledger) ? 1 : 0,
    source: sourceMatch ? sourceMatch[1].trim() : 'unknown'
  };
}

function parseFlexibleDecisions(ledger) {
  const parsed = parseDecisionLog(ledger);
  if (parsed.length > 0) return parsed;
  if (/\(no deviations\)|\(none yet\)/i.test(ledger)) return [];
  const bulletLines = (ledger.match(/^\s*-\s*\*\*D\d+\b/gm) || []);
  return bulletLines.map((line, index) => ({ id: `D${index + 1}`, cols: [line] }));
}

function parseFlexibleReconciliations(ledger) {
  const parsed = parseReconciliationHistory(ledger);
  if (parsed.length > 0) return parsed;
  const section = (ledger.match(/##+\s*Reconciliation[\s\S]*?(?=\n##+\s|$)/i) || [])[0] || '';
  const scan = section || ledger;
  const bulletLines = (scan.match(/^\s*-\s*\*\*(After Task \d+|R\d+|Sweep \d+|Round \d+|Pass \d+)\b/gm) || []);
  return bulletLines.map((line, index) => ({ id: `R${index + 1}`, cols: [line] }));
}

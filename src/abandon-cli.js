#!/usr/bin/env node
// Plan Enforcer -- Abandon CLI
//
// Retire an in-flight plan in one shot. Marks every non-terminal task row as
// superseded (evidence: "abandoned: <reason>"), appends a pivot-typed
// Decision Log row citing those T-IDs, emits a closure receipt into the
// walkable chain for the plan-slug, archives the resulting ledger content to
// .plan-enforcer/archive/<iso>-<slug>.md, and removes the active
// .plan-enforcer/ledger.md. --reason is required and is sole authorization.

const fs = require('fs');
const path = require('path');

const {
  parseMetadata,
  parseTaskRows,
  parseDecisionLog,
  parseLedger
} = require('./ledger-parser');
const {
  archiveLedger,
  cleanupWorkingFiles
} = require('./archive');
const receipt = require('./receipt-cli');

const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);
const EVIDENCE_REASON_MAX = 40;

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

function printUsage() {
  const msg = [
    'Usage: plan-enforcer-abandon --reason "<text>"',
    '',
    'Options:',
    '  --reason <text>    Required. Why the plan is being abandoned.',
    '                     Recorded in the Decision Log and in each row evidence.',
    '  --help             Show this message.'
  ];
  process.stderr.write(msg.join('\n') + '\n');
}

function parseArgs(argv) {
  const opts = { help: false, reason: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--reason') {
      opts.reason = argv[++i] || null;
    } else if (arg.startsWith('--')) {
      process.stderr.write(`plan-enforcer-abandon: unknown flag ${arg}\n`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function preflight(projectRoot, opts) {
  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const ledgerPath = path.join(enforcerDir, 'ledger.md');
  if (!fs.existsSync(ledgerPath)) {
    return { ok: false, errMsg: 'plan-enforcer-abandon: no active plan to abandon (ledger.md missing)' };
  }
  let content;
  try {
    content = fs.readFileSync(ledgerPath, 'utf8');
  } catch (err) {
    return { ok: false, errMsg: `plan-enforcer-abandon: cannot read ledger: ${err.message || err}` };
  }
  const rows = parseTaskRows(content);
  if (rows.length === 0) {
    return { ok: false, errMsg: 'plan-enforcer-abandon: no active plan to abandon (empty task ledger)' };
  }
  const nonTerminal = rows.filter((r) => !TERMINAL_STATUSES.has(r.status));
  if (nonTerminal.length === 0) {
    return { ok: false, errMsg: 'plan-enforcer-abandon: no active plan to abandon (every row already terminal)' };
  }
  const reason = (opts && opts.reason ? String(opts.reason) : '').trim();
  if (!reason) {
    return { ok: false, errMsg: 'plan-enforcer-abandon: --reason required' };
  }
  const meta = parseMetadata(content);
  const slug = receipt.deriveSlug(meta.source);
  return {
    ok: true,
    ledgerPath,
    enforcerDir,
    content,
    rows,
    nonTerminalIds: nonTerminal.map((r) => r.id),
    meta,
    slug,
    reason
  };
}

// ---------------------------------------------------------------------------
// Ledger transformation
// ---------------------------------------------------------------------------

function markAllNonTerminalSuperseded(ledgerContent, reason) {
  const reasonSnippet = String(reason || '').trim().slice(0, EVIDENCE_REASON_MAX);
  const evidenceText = `abandoned: ${reasonSnippet}`;
  const mutatedIds = [];

  const lines = ledgerContent.split(/\r?\n/);
  const outLines = lines.map((line) => {
    // Match task rows only: | Tnn | <name> | <status> | <evidence> | <chain> | <notes> |
    const m = line.match(/^(\|\s*)(T\d+)(\s*\|[^|]+\|\s*)([a-z-]+)\s*\|\s*([^|]*)\|(.*)$/i);
    if (!m) return line;
    const status = m[4].toLowerCase();
    if (TERMINAL_STATUSES.has(status)) return line;
    mutatedIds.push(m[2]);
    return `${m[1]}${m[2]}${m[3]}superseded | ${evidenceText} |${m[6]}`;
  });
  return { content: outLines.join('\n'), mutatedIds };
}

function injectAbandonDecisionRow(ledgerContent, taskIds, reason) {
  const lines = ledgerContent.split(/\r?\n/);
  // Locate the Decision Log section and its trailing row range.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+Decision Log\s*$/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('Decision Log section not found in ledger');
  }
  // Find the last D-row index (or the end of the Decision Log table).
  let lastRowIdx = -1;
  let nextMaxId = 0;
  let tableSeparatorIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break; // next section
    if (/^\|-[-|\s]+-\|\s*$/.test(line)) {
      tableSeparatorIdx = i;
      continue;
    }
    const m = line.match(/^\|\s*D(\d+)\s*\|/);
    if (m) {
      lastRowIdx = i;
      const n = parseInt(m[1], 10);
      if (n > nextMaxId) nextMaxId = n;
    }
  }
  const newId = `D${nextMaxId + 1}`;
  const scope = taskIds.join(', ');
  const reasonText = `Plan abandoned: ${String(reason || '').trim()}`;
  const evidenceText = `plan-enforcer-abandon invocation ${new Date().toISOString()}`;
  const newRow = `| ${newId} | pivot | ${scope} | ${reasonText} | ${evidenceText} |`;

  const insertIdx = lastRowIdx >= 0 ? lastRowIdx + 1 : (tableSeparatorIdx >= 0 ? tableSeparatorIdx + 1 : headerIdx + 3);
  const out = lines.slice(0, insertIdx).concat([newRow]).concat(lines.slice(insertIdx));
  return { content: out.join('\n'), decisionId: newId };
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

function readTierOrDefault(enforcerDir) {
  try {
    const configPath = path.join(enforcerDir, 'config.md');
    if (!fs.existsSync(configPath)) return 'structural';
    const raw = fs.readFileSync(configPath, 'utf8');
    const m = raw.match(/^tier:\s*([a-z]+)\s*$/mi);
    return (m && m[1]) ? m[1].toLowerCase() : 'structural';
  } catch (_err) {
    return 'structural';
  }
}

function archiveAndClear(projectRoot, transformedContent, now) {
  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const tier = readTierOrDefault(enforcerDir);
  const stats = parseLedger(transformedContent);
  const result = archiveLedger(enforcerDir, transformedContent, stats, tier, now || new Date());
  cleanupWorkingFiles(enforcerDir);
  return { archivePath: result.archivePath, archiveName: result.archiveName };
}

function emitAbandonReceipt(projectRoot, transformedContent, now) {
  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  fs.mkdirSync(enforcerDir, { recursive: true });
  const scratchPath = path.join(enforcerDir, `.abandon-scratch-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(scratchPath, transformedContent, 'utf8');
  let result;
  try {
    result = receipt.writeReceipt(projectRoot, { ledgerPath: scratchPath, now: now || new Date() });
  } finally {
    try { fs.unlinkSync(scratchPath); } catch (_err) { /* best effort */ }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sanityCheckAllTerminal(content) {
  const rows = parseTaskRows(content);
  const bad = rows.filter((r) => !TERMINAL_STATUSES.has(r.status));
  if (bad.length > 0) {
    const ids = bad.map((r) => `${r.id}(${r.status})`).join(', ');
    throw new Error(`abandon transformation failed sanity: non-terminal rows remain: ${ids}`);
  }
}

function main(argv) {
  const opts = parseArgs(argv || []);
  if (opts.help) {
    printUsage();
    return 0;
  }
  const projectRoot = process.cwd();
  const pre = preflight(projectRoot, opts);
  if (!pre.ok) {
    process.stderr.write(pre.errMsg + '\n');
    return 2;
  }

  const now = new Date();
  // 1. Transform: mark non-terminal rows as superseded.
  const marked = markAllNonTerminalSuperseded(pre.content, pre.reason);
  // 2. Inject the pivot Decision Log row citing those rows.
  const withDecision = injectAbandonDecisionRow(marked.content, marked.mutatedIds, pre.reason);
  // 3. Sanity: confirm every row is now terminal.
  try {
    sanityCheckAllTerminal(withDecision.content);
  } catch (err) {
    process.stderr.write(`plan-enforcer-abandon: ${err.message || err}\n`);
    return 1;
  }

  // 4. Emit the receipt against the transformed content (scratch file so
  //    receipt-cli reads the post-abandon state without us touching the
  //    canonical ledger.md first).
  let receiptResult;
  try {
    receiptResult = emitAbandonReceipt(projectRoot, withDecision.content, now);
  } catch (err) {
    process.stderr.write(`plan-enforcer-abandon: receipt emission failed: ${err.message || err}\n`);
    return 1;
  }

  // 5. Archive + clear: write the archive file, remove active ledger.
  let archiveResult;
  try {
    archiveResult = archiveAndClear(projectRoot, withDecision.content, now);
  } catch (err) {
    process.stderr.write(`plan-enforcer-abandon: archive failed: ${err.message || err}\n`);
    return 1;
  }

  process.stdout.write(`archive: ${archiveResult.archivePath}\n`);
  process.stdout.write(`receipt: ${receiptResult.path}\n`);
  return 0;
}

module.exports = {
  TERMINAL_STATUSES,
  EVIDENCE_REASON_MAX,
  printUsage,
  parseArgs,
  preflight,
  markAllNonTerminalSuperseded,
  injectAbandonDecisionRow,
  readTierOrDefault,
  archiveAndClear,
  emitAbandonReceipt,
  sanityCheckAllTerminal,
  main
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)) || 0);
}

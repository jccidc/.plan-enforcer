#!/usr/bin/env node
// Plan Enforcer -- Closure Receipt CLI
//
// Emit a markdown closure receipt against the current ledger. Receipts live
// at .plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md. Every emission is
// its own file; receipts for the same plan-slug form a walkable chain via
// the "Prior closure" section (see HC8 in the discuss packet).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  parseDecisionLog,
  parseLedger,
  parseMetadata,
  parseReconciliationHistory,
  parseTaskRows
} = require('./ledger-parser');

const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);
const PENDING_STATUSES = (status) => !TERMINAL_STATUSES.has(status);

// Section order rendered by renderReceipt. Each entry names the heading and
// the renderer key on RENDERERS below.
const SECTION_ORDER = [
  { heading: null, key: 'header' },
  { heading: '## Prior closure', key: 'priorClosure' },
  { heading: '## Status', key: 'status' },
  { heading: '## Task ledger', key: 'taskLedger' },
  { heading: '## Decision Log summary', key: 'decisionLog' },
  { heading: '## Reconciliation history', key: 'reconciliation' },
  { heading: '## Files changed', key: 'filesChanged' },
  { heading: '## Blocked / open coordination', key: 'blocked' },
  { heading: '## Proof artifacts', key: 'proofArtifacts' },
  { heading: '## Plan-specific extras', key: 'planSpecific' }
];

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

function deriveSlug(planSourcePath) {
  if (!planSourcePath) return 'unknown-plan';
  const base = path.basename(String(planSourcePath)).replace(/\.md$/i, '');
  // Strip leading YYYY-MM-DD- prefix if present.
  const dated = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return dated ? dated[1] : base;
}

function filenameSafeIso(date) {
  const d = date instanceof Date ? date : new Date();
  // 2026-04-22T03:45:12.000Z -> 2026-04-22T03-45-12Z
  const iso = d.toISOString();
  return iso.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function findPriorClosure(proofDir, slug) {
  try {
    const entries = fs.readdirSync(proofDir);
    const prefix = `closure-${slug}-`;
    const matches = entries
      .filter((name) => name.startsWith(prefix) && name.endsWith('.md'))
      .sort();
    if (matches.length === 0) return null;
    // Latest lexical = latest ISO (ISO-8601 sorts correctly).
    return matches[matches.length - 1];
  } catch (_err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// State loaders
// ---------------------------------------------------------------------------

function loadLedgerState(ledgerPath) {
  const content = fs.readFileSync(ledgerPath, 'utf8');
  const metadata = parseMetadata(content);
  const rows = parseTaskRows(content);
  const decisions = parseDecisionLog(content);
  const reconciliations = parseReconciliationHistory(content);
  const scoreboard = parseLedger(content);
  return { content, metadata, rows, decisions, reconciliations, scoreboard };
}

function gatherGitInfo(projectRoot) {
  try {
    const diffStat = execSync('git diff --stat HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const shortSha = execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return {
      available: true,
      diffStat: diffStat || '(no uncommitted changes)',
      headSha: shortSha
    };
  } catch (err) {
    return { available: false, reason: (err && err.message) || 'git unavailable' };
  }
}

function listProofArtifacts(proofDir, excludeFilename) {
  try {
    const entries = fs.readdirSync(proofDir);
    return entries
      .filter((name) => name !== excludeFilename && !name.startsWith('.'))
      .sort();
  } catch (_err) {
    return [];
  }
}

function readPlanMustHavesAndProof(projectRoot, planSourcePath) {
  if (!planSourcePath) return null;
  const planPath = path.isAbsolute(planSourcePath)
    ? planSourcePath
    : path.join(projectRoot, planSourcePath);
  let planBody;
  try {
    planBody = fs.readFileSync(planPath, 'utf8');
  } catch (_err) {
    return null;
  }
  const mustHaves = extractSection(planBody, /^##\s+Must-Haves\s*$/mi);
  const proof = extractSection(planBody, /^##\s+Proof Requirements\s*$/mi);
  if (!mustHaves && !proof) return null;
  return { mustHaves, proof };
}

function extractSection(markdown, headingRegex) {
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingRegex.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim() || null;
}

// ---------------------------------------------------------------------------
// Renderers (each returns a string block; no leading heading -- caller adds it)
// ---------------------------------------------------------------------------

function renderHeader(state, closedAt, opts) {
  const slug = opts.slug;
  const source = (state.metadata && state.metadata.source) || '(no source metadata)';
  const tier = (state.metadata && state.metadata.tier) || 'structural';
  const open = hasPending(state.rows);
  const openNote = open ? ' (plan still open at emission time -- mid-flight snapshot)' : '';
  return [
    `# Closure Receipt -- ${slug}${openNote}`,
    '',
    `**Plan source:** ${source}`,
    `**Closed at (UTC):** ${closedAt}`,
    `**Tier:** ${tier}`
  ].join('\n');
}

function renderPriorClosure(state, closedAt, opts) {
  if (opts.priorClosureFilename) {
    return `- [${opts.priorClosureFilename}](./${opts.priorClosureFilename})`;
  }
  return '- none (first close of this plan)';
}

function renderStatus(state) {
  const rows = state.rows || [];
  const counts = {
    total: rows.length,
    verified: rows.filter((r) => r.status === 'verified').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
    blocked: rows.filter((r) => r.status === 'blocked').length,
    superseded: rows.filter((r) => r.status === 'superseded').length,
    remaining: rows.filter((r) => !TERMINAL_STATUSES.has(r.status)).length,
    drift: (state.decisions || []).filter((d) => ['deviation', 'unplanned', 'pivot'].includes((d.type || '').toLowerCase())).length
  };
  return [
    '```',
    `${counts.verified}/${counts.total} verified  |  ${counts.blocked} blocked  |  ${counts.skipped} skipped  |  ${counts.superseded} superseded  |  ${counts.remaining} remaining`,
    `drift: ${counts.drift}`,
    '```'
  ].join('\n');
}

function renderTaskLedger(state) {
  const active = state.rows.filter((r) => r.status !== 'superseded');
  if (active.length === 0) return '_(no active tasks)_';
  const lines = [
    '| ID | Task | Status | Evidence |',
    '|----|------|--------|----------|'
  ];
  for (const row of active) {
    const evidence = (row.evidence || '').slice(0, 80).replace(/\|/g, '\\|');
    const name = row.name.replace(/\|/g, '\\|');
    lines.push(`| ${row.id} | ${name} | ${row.status} | ${evidence} |`);
  }
  return lines.join('\n');
}

function renderDecisionLog(state) {
  if (!state.decisions || state.decisions.length === 0) return '_(no decision log entries)_';
  const lines = [
    '| ID | Type | Scope | Reason (short) |',
    '|----|------|-------|----------------|'
  ];
  for (const d of state.decisions) {
    const reason = (d.reason || '').slice(0, 120).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const scope = (d.scope || '').slice(0, 60).replace(/\|/g, '\\|');
    lines.push(`| ${d.id} | ${d.type} | ${scope} | ${reason} |`);
  }
  return lines.join('\n');
}

function renderReconciliation(state) {
  if (!state.reconciliations || state.reconciliations.length === 0) {
    return '_(no reconciliation rounds recorded)_';
  }
  const lines = [
    '| Round | Tasks | Gaps | Action |',
    '|-------|-------|------|--------|'
  ];
  for (const r of state.reconciliations) {
    const tasks = (r.tasks || '').slice(0, 40).replace(/\|/g, '\\|');
    const gaps = (r.gaps || '').slice(0, 60).replace(/\|/g, '\\|');
    const action = (r.action || '').slice(0, 40).replace(/\|/g, '\\|');
    lines.push(`| ${r.round} | ${tasks} | ${gaps} | ${action} |`);
  }
  return lines.join('\n');
}

function renderFilesChanged(gitInfo) {
  if (!gitInfo || !gitInfo.available) {
    const reason = (gitInfo && gitInfo.reason) || 'git not present or repo not in a git state';
    return `_files changed: unavailable (${reason})_`;
  }
  return ['```', `HEAD: ${gitInfo.headSha}`, '', gitInfo.diffStat, '```'].join('\n');
}

function renderBlocked(state) {
  const blocked = state.rows.filter((r) => r.status === 'blocked');
  if (blocked.length === 0) return '_(nothing blocked)_';
  const lines = [];
  for (const row of blocked) {
    lines.push(`- **${row.id}** ${row.name}`);
    if (row.notes) lines.push(`  - note: ${row.notes}`);
    if (row.evidence) lines.push(`  - evidence: ${row.evidence}`);
  }
  return lines.join('\n');
}

function renderProofArtifacts(_state, closedAt, opts) {
  const entries = listProofArtifacts(opts.proofDir, opts.selfFilename);
  if (entries.length === 0) return '_(no prior proof artifacts)_';
  return entries.map((name) => `- [${name}](./${name})`).join('\n');
}

function renderPlanSpecific(_state, closedAt, opts) {
  if (!opts.planExtras) return null; // signal to omit section entirely
  const blocks = [];
  if (opts.planExtras.mustHaves) {
    blocks.push('### Must-Haves (from plan)');
    blocks.push(opts.planExtras.mustHaves);
  }
  if (opts.planExtras.proof) {
    blocks.push('### Proof Requirements (from plan)');
    blocks.push(opts.planExtras.proof);
  }
  return blocks.join('\n\n');
}

const RENDERERS = {
  header: renderHeader,
  priorClosure: renderPriorClosure,
  status: renderStatus,
  taskLedger: renderTaskLedger,
  decisionLog: renderDecisionLog,
  reconciliation: renderReconciliation,
  filesChanged: (_state, _closedAt, opts) => renderFilesChanged(opts.gitInfo),
  blocked: renderBlocked,
  proofArtifacts: renderProofArtifacts,
  planSpecific: renderPlanSpecific
};

// ---------------------------------------------------------------------------
// Top-level assembly
// ---------------------------------------------------------------------------

function hasPending(rows) {
  const active = rows.filter((r) => r.status !== 'superseded');
  return active.some((r) => PENDING_STATUSES(r.status));
}

function renderReceipt(state, opts) {
  const closedAt = opts.closedAt || new Date().toISOString();
  const out = [];
  for (const section of SECTION_ORDER) {
    const fn = RENDERERS[section.key];
    if (!fn) continue;
    const body = fn(state, closedAt, opts);
    if (body === null || body === undefined) continue; // renderer may opt out
    if (section.heading) out.push(section.heading);
    out.push(body);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function writeReceipt(projectRoot, options) {
  options = options || {};
  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const ledgerPath = options.ledgerPath || path.join(enforcerDir, 'ledger.md');
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`ledger not found at ${ledgerPath}`);
  }
  const state = loadLedgerState(ledgerPath);
  const planSource = options.planSource || (state.metadata && state.metadata.source) || null;
  const slug = options.slug || deriveSlug(planSource);
  const now = options.now || new Date();
  const iso = filenameSafeIso(now);
  const proofDir = path.join(enforcerDir, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  const priorClosureFilename = findPriorClosure(proofDir, slug);
  const gitInfo = gatherGitInfo(projectRoot);
  const planExtras = planSource ? readPlanMustHavesAndProof(projectRoot, planSource) : null;

  let filename = `closure-${slug}-${iso}.md`;
  let outPath = path.join(proofDir, filename);
  let suffix = 2;
  while (fs.existsSync(outPath)) {
    filename = `closure-${slug}-${iso}-${suffix}.md`;
    outPath = path.join(proofDir, filename);
    suffix += 1;
  }

  const closedAt = now.toISOString();
  const body = renderReceipt(state, {
    slug,
    gitInfo,
    priorClosureFilename,
    proofDir,
    selfFilename: filename,
    planExtras,
    closedAt
  });

  fs.writeFileSync(outPath, body, 'utf8');
  return { path: outPath, filename, slug, iso, planOpen: hasPending(state.rows) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  const msg = [
    'Usage: plan-enforcer-receipt [options]',
    '',
    'Options:',
    '  --plan-slug <slug>   Override plan-slug derivation',
    '  --out <path>         Write receipt to explicit path (bypasses proof-dir logic)',
    '  --closed-only        Exit non-zero if plan still has pending rows',
    '  --open-ok            Tolerate open ledger; emit partial snapshot (default)',
    '  --help               Show this message'
  ];
  process.stderr.write(msg.join('\n') + '\n');
}

function parseArgs(argv) {
  const opts = { closedOnly: false, openOk: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--plan-slug') {
      opts.slug = argv[++i];
    } else if (arg === '--out') {
      opts.out = argv[++i];
    } else if (arg === '--closed-only') {
      opts.closedOnly = true;
    } else if (arg === '--open-ok') {
      opts.openOk = true;
    }
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv || []);
  if (opts.help) {
    printUsage();
    return 0;
  }
  const projectRoot = process.cwd();
  try {
    if (opts.out) {
      // Explicit --out: still derive via writeReceipt, then move the file.
      const result = writeReceipt(projectRoot, opts);
      if (path.resolve(result.path) !== path.resolve(opts.out)) {
        fs.mkdirSync(path.dirname(opts.out), { recursive: true });
        fs.renameSync(result.path, opts.out);
      }
      if (opts.closedOnly && result.planOpen) {
        process.stderr.write('plan still open; --closed-only requested\n');
        return 2;
      }
      process.stdout.write(opts.out + '\n');
      return 0;
    }
    const result = writeReceipt(projectRoot, opts);
    if (opts.closedOnly && result.planOpen) {
      process.stderr.write('plan still open; --closed-only requested\n');
      return 2;
    }
    process.stdout.write(result.path + '\n');
    return 0;
  } catch (err) {
    process.stderr.write(`plan-enforcer-receipt: ${err.message || err}\n`);
    return 1;
  }
}

module.exports = {
  SECTION_ORDER,
  TERMINAL_STATUSES,
  deriveSlug,
  filenameSafeIso,
  findPriorClosure,
  loadLedgerState,
  gatherGitInfo,
  listProofArtifacts,
  readPlanMustHavesAndProof,
  extractSection,
  renderHeader,
  renderPriorClosure,
  renderStatus,
  renderTaskLedger,
  renderDecisionLog,
  renderReconciliation,
  renderFilesChanged,
  renderBlocked,
  renderProofArtifacts,
  renderPlanSpecific,
  renderReceipt,
  writeReceipt,
  hasPending,
  main
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)) || 0);
}

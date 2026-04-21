#!/usr/bin/env node
// plan-enforcer-lint — Ledger schema shape validator.
//
// Complements audit-cli. audit checks semantics (refs resolve, rows
// consistent). lint checks shape (correct sections, header rows, cell
// counts per schema version). A ledger that lints passes the parser
// reliably — the smallest unit of "well-formed."
//
// Usage:
//   plan-enforcer-lint [--ledger <path>] [--cwd <path>] [--json]
//   plan-enforcer-lint --help
//
// Exit codes:
//   0  well-formed
//   1  one or more lint errors
//   2  config error (no ledger)

const fs = require('fs');
const path = require('path');
const { parseMetadata, splitRow } = require('./ledger-parser');
const { assessAwarenessQuoteVerification } = require('./awareness');
const { readAwareness } = require('./awareness-parser');

const V1_TASK_HEADER = ['ID', 'Task', 'Status', 'Evidence', 'Notes'];
const V2_TASK_HEADER = ['ID', 'Task', 'Status', 'Evidence', 'Chain', 'Notes'];
const V1_D_HEADER    = ['ID', 'Task Ref', 'Decision', 'Reason'];
const V2_D_HEADER    = ['ID', 'Type', 'Scope', 'Reason', 'Evidence'];

function addFinding(out, code, message, line) {
  out.push({ code, message, line: line || null });
}

/**
 * Locate a section header line number. Returns 1-based line or -1.
 */
function sectionLine(ledger, heading) {
  const lines = ledger.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === heading.toLowerCase()) return i + 1;
  }
  return -1;
}

/**
 * Locate the first table header row inside the region between `from`
 * and the next `## ` heading (or EOF). Returns { headerLine, headerCells }.
 */
function findTableHeader(ledger, fromLine) {
  const lines = ledger.split(/\r?\n/);
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    if (line.trim().startsWith('|')) {
      return { headerLine: i + 1, headerCells: splitRow(line) };
    }
  }
  return { headerLine: -1, headerCells: null };
}

function headerMatches(actual, expected) {
  if (!actual || actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if ((actual[i] || '').toLowerCase() !== expected[i].toLowerCase()) return false;
  }
  return true;
}

/**
 * Lint a ledger. Returns { ledgerPath, schema, findings }.
 */
function lintLedger(opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();
  const ledgerPath = opts.ledgerPath || path.join(cwd, '.plan-enforcer', 'ledger.md');

  const findings = [];

  if (!fs.existsSync(ledgerPath)) {
    addFinding(findings, 'NO_LEDGER', `Ledger not found at ${ledgerPath}`);
    return { ledgerPath, schema: 'unknown', findings };
  }

  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const meta = parseMetadata(ledger);
  const schema = meta.schema;
  const enforcerDir = path.dirname(ledgerPath);

  // 1. Schema comment must exist
  if (!/<!-- schema: v[12] -->/.test(ledger)) {
    addFinding(findings, 'MISSING_SCHEMA_COMMENT', 'Ledger lacks a `<!-- schema: vN -->` comment. Add one on line 2.');
  }
  if (!/<!-- source:\s*\S/.test(ledger)) {
    addFinding(findings, 'MISSING_SOURCE', 'Ledger lacks a `<!-- source: ... -->` metadata comment.');
  }
  if (!/<!-- tier:\s*\S/.test(ledger)) {
    addFinding(findings, 'MISSING_TIER', 'Ledger lacks a `<!-- tier: ... -->` metadata comment.');
  }

  // 2. Required sections exist
  const requiredSections = ['## Scoreboard', '## Task Ledger', '## Decision Log'];
  const sectionLines = {};
  for (const s of requiredSections) {
    const n = sectionLine(ledger, s);
    sectionLines[s] = n;
    if (n < 0) addFinding(findings, 'MISSING_SECTION', `Missing required section "${s}"`);
  }

  // 3. Task Ledger header shape
  if (sectionLines['## Task Ledger'] > 0) {
    const { headerLine, headerCells } = findTableHeader(ledger, sectionLines['## Task Ledger']);
    const expected = schema === 'v2' ? V2_TASK_HEADER : V1_TASK_HEADER;
    if (headerLine < 0) {
      addFinding(findings, 'TASK_TABLE_MISSING', 'No task table found after "## Task Ledger" heading');
    } else if (!headerMatches(headerCells, expected)) {
      addFinding(findings, 'TASK_HEADER_MISMATCH',
        `Task Ledger header row does not match schema ${schema}. Expected [${expected.join(' | ')}], got [${(headerCells || []).join(' | ')}]`,
        headerLine);
    }
  }

  // 4. Decision Log header shape
  if (sectionLines['## Decision Log'] > 0) {
    const { headerLine, headerCells } = findTableHeader(ledger, sectionLines['## Decision Log']);
    const expected = schema === 'v2' ? V2_D_HEADER : V1_D_HEADER;
    if (headerLine < 0) {
      addFinding(findings, 'D_TABLE_MISSING', 'No decision table found after "## Decision Log" heading');
    } else if (!headerMatches(headerCells, expected)) {
      addFinding(findings, 'D_HEADER_MISMATCH',
        `Decision Log header row does not match schema ${schema}. Expected [${expected.join(' | ')}], got [${(headerCells || []).join(' | ')}]`,
        headerLine);
    }
  }

  // 5. Every T-row has the right cell count for the schema
  const expectedTaskCells = schema === 'v2' ? 6 : 5;
  const taskLines = ledger.split(/\r?\n/);
  for (let i = 0; i < taskLines.length; i++) {
    const line = taskLines[i];
    if (/^\|\s*T\d+[A-Za-z0-9]*\s*\|/.test(line)) {
      const cells = splitRow(line);
      if (cells.length !== expectedTaskCells) {
        addFinding(findings, 'TASK_ROW_CELL_COUNT',
          `Task row ${cells[0]} has ${cells.length} cells, expected ${expectedTaskCells} for schema ${schema}`,
          i + 1);
      }
    }
  }

  // 6. Every D-row has the right cell count
  const expectedDCells = schema === 'v2' ? 5 : 4;
  for (let i = 0; i < taskLines.length; i++) {
    const line = taskLines[i];
    if (/^\|\s*D\d+\s*\|/.test(line)) {
      const cells = splitRow(line);
      if (cells.length !== expectedDCells) {
        addFinding(findings, 'D_ROW_CELL_COUNT',
          `Decision row ${cells[0]} has ${cells.length} cells, expected ${expectedDCells} for schema ${schema}`,
          i + 1);
      }
    }
  }

  const awarenessState = readAwareness(path.join(enforcerDir, 'awareness.md'));
  for (const issue of assessAwarenessQuoteVerification(awarenessState, { projectRoot: cwd }).issues) {
    addFinding(findings, issue.code, issue.message);
  }

  return { ledgerPath, schema, findings };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') args.ledger = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: plan-enforcer-lint [--ledger <path>] [--cwd <path>] [--json]',
    '',
    'Validates ledger shape: schema comment + metadata, required',
    'sections (Scoreboard / Task Ledger / Decision Log), table header',
    'rows match the schema version, every T-row and D-row has the',
    'expected cell count.',
    '',
    'Complements plan-enforcer-audit (which checks semantics). A ledger',
    'that lints is well-formed; one that audits is self-consistent.',
    '',
    'Exit 0 when clean, 1 on any lint finding, 2 on config error.'
  ].join('\n');
}

function renderText(result) {
  const lines = [];
  lines.push(`Plan Enforcer Lint — ${result.ledgerPath} (schema ${result.schema})`);
  lines.push(`  ${result.findings.length} finding(s)`);
  lines.push('');
  if (result.findings.length === 0) {
    lines.push('Clean. Ledger shape is well-formed.');
    return lines.join('\n');
  }
  for (const f of result.findings) {
    const loc = f.line ? `L${f.line} ` : '';
    lines.push(`  [${f.code}] ${loc}${f.message}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }

  const result = lintLedger({ ledgerPath: args.ledger, cwd: args.cwd });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }

  if (result.findings.some((f) => f.code === 'NO_LEDGER')) return 2;
  return result.findings.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, lintLedger, parseArgs, usage, renderText };

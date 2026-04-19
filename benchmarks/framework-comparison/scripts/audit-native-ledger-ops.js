#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const resultsRoot = path.join(repoRoot, 'results');

const sizes = ['small', 'medium', 'large'];
const scenarios = ['execute-frozen-plan', 'crash-continuity', 'multi-session'];

function readJsonLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizePathish(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function collectPaths(value, paths = []) {
  if (value == null) return paths;
  if (typeof value === 'string') {
    const normalized = normalizePathish(value);
    if (
      normalized.includes('/') ||
      normalized.includes('.ts') ||
      normalized.includes('.js') ||
      normalized.includes('.json') ||
      normalized.includes('.md')
    ) {
      paths.push(normalized);
    }
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPaths(item, paths));
    return paths;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (/path|file/i.test(key)) {
        collectPaths(nested, paths);
      } else if (typeof nested === 'object') {
        collectPaths(nested, paths);
      }
    }
  }
  return paths;
}

function getRecordPaths(record) {
  return collectPaths(record, []);
}

function isLedgerPath(pathish) {
  return pathish.includes('/.plan-enforcer/ledger.md');
}

function isEnforcerPath(pathish) {
  return pathish.includes('/.plan-enforcer/');
}

function isCodePath(pathish) {
  if (isEnforcerPath(pathish)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(pathish);
}

function isMutationTool(tool) {
  return ['Edit', 'Write', 'MultiEdit'].includes(tool);
}

function summarizeLog(filePath) {
  const records = readJsonLines(filePath);
  const summary = {
    file: filePath,
    session: path.basename(filePath, '.jsonl'),
    total_tool_calls: records.length,
    ledger_ops: 0,
    src_ops: 0,
    code_write_ops: 0,
    bash_glob_grep_ops: 0
  };

  for (const record of records) {
    const tool = record.tool || '';
    const paths = getRecordPaths(record);
    const touchesLedger = paths.some(isLedgerPath);
    const touchesCode = paths.some(isCodePath);

    if (touchesLedger && ['Read', 'Edit', 'Write', 'MultiEdit'].includes(tool)) {
      summary.ledger_ops += 1;
    }

    if (touchesCode && ['Read', 'Edit', 'Write', 'MultiEdit'].includes(tool)) {
      summary.src_ops += 1;
    }

    if (touchesCode && isMutationTool(tool)) {
      summary.code_write_ops += 1;
    }

    if (['Bash', 'Glob', 'Grep'].includes(tool)) {
      summary.bash_glob_grep_ops += 1;
    }
  }

  summary.ledger_ratio = summary.total_tool_calls === 0
    ? null
    : summary.ledger_ops / summary.total_tool_calls;
  return summary;
}

function formatRatio(value) {
  if (value == null) return 'missing';
  return `${Math.round(value * 100)}%`;
}

function formatCount(value) {
  return value == null ? 'missing' : String(value);
}

function summarizeCell(size, scenario) {
  const logDir = path.join(resultsRoot, size, scenario, 'native', 'session-logs');
  if (!fs.existsSync(logDir)) {
    return { size, scenario, status: 'missing', sessions: [] };
  }

  const files = fs.readdirSync(logDir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) {
    return { size, scenario, status: 'missing', sessions: [] };
  }

  const sessions = files.map((name) => summarizeLog(path.join(logDir, name)));
  const totals = sessions.reduce((acc, session) => {
    acc.total_tool_calls += session.total_tool_calls;
    acc.ledger_ops += session.ledger_ops;
    acc.src_ops += session.src_ops;
    acc.code_write_ops += session.code_write_ops;
    acc.bash_glob_grep_ops += session.bash_glob_grep_ops;
    return acc;
  }, {
    total_tool_calls: 0,
    ledger_ops: 0,
    src_ops: 0,
    code_write_ops: 0,
    bash_glob_grep_ops: 0
  });

  totals.ledger_ratio = totals.total_tool_calls === 0 ? null : totals.ledger_ops / totals.total_tool_calls;

  return {
    size,
    scenario,
    status: 'ok',
    totals,
    sessions
  };
}

function summarizeLogsForDir(logDir) {
  if (!fs.existsSync(logDir)) return null;
  const files = fs.readdirSync(logDir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) return null;
  const sessions = files.map((name) => summarizeLog(path.join(logDir, name)));
  const totals = sessions.reduce((acc, session) => {
    acc.total_tool_calls += session.total_tool_calls;
    acc.ledger_ops += session.ledger_ops;
    acc.src_ops += session.src_ops;
    acc.code_write_ops += session.code_write_ops;
    acc.bash_glob_grep_ops += session.bash_glob_grep_ops;
    return acc;
  }, {
    total_tool_calls: 0,
    ledger_ops: 0,
    src_ops: 0,
    code_write_ops: 0,
    bash_glob_grep_ops: 0
  });
  totals.ledger_ratio = totals.total_tool_calls === 0
    ? null
    : totals.ledger_ops / totals.total_tool_calls;
  return { sessions, totals };
}

module.exports = { summarizeLog, summarizeCell, summarizeLogsForDir };

if (require.main !== module) {
  return;
}

const cellSummaries = [];
for (const size of sizes) {
  for (const scenario of scenarios) {
    cellSummaries.push(summarizeCell(size, scenario));
  }
}

console.log('Cell Matrix');
console.log('| size | scenario | logs | ledger_ops/total | src_ops | code_writes | bash_glob_grep |');
console.log('|---|---|---:|---:|---:|---:|---:|');
for (const cell of cellSummaries) {
  if (cell.status !== 'ok') {
    console.log(`| ${cell.size} | ${cell.scenario} | 0 | missing | missing | missing | missing |`);
    continue;
  }
  console.log(
    `| ${cell.size} | ${cell.scenario} | ${cell.sessions.length} | ${cell.totals.ledger_ops}/${cell.totals.total_tool_calls} (${formatRatio(cell.totals.ledger_ratio)}) | ${cell.totals.src_ops} | ${cell.totals.code_write_ops} | ${cell.totals.bash_glob_grep_ops} |`
  );
}

console.log('\nSession Breakdown');
console.log('| size | scenario | session | ledger_ops/total | src_ops | code_writes | bash_glob_grep |');
console.log('|---|---|---|---:|---:|---:|---:|');
for (const cell of cellSummaries) {
  if (cell.status !== 'ok') continue;
  for (const session of cell.sessions) {
    console.log(
      `| ${cell.size} | ${cell.scenario} | ${session.session} | ${session.ledger_ops}/${session.total_tool_calls} (${formatRatio(session.ledger_ratio)}) | ${formatCount(session.src_ops)} | ${formatCount(session.code_write_ops)} | ${formatCount(session.bash_glob_grep_ops)} |`
    );
  }
}
